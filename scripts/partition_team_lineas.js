#!/usr/bin/env node
'use strict';

/*
  Partition "costumers" (or a specified collection) into DB TEAM_LINEAS with per-agent collections.
  - Source: DB from your existing env (MONGODB_URI) and collection (default: costumers)
  - Target DB: TEAM_LINEAS (cannot contain spaces)
  - Group by: supervisor (fallback to agenteNombre/agente)
  - Normalized collection name: uppercased, spaces -> underscore, accents removed, non-word removed
  - Upsert by _id if present, else by id

  Usage examples:
    node scripts/partition_team_lineas.js
    node scripts/partition_team_lineas.js --fromCollection=costumers --targetDb=TEAM_LINEAS
    node scripts/partition_team_lineas.js --filterTeam=lineas
*/

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function parseArgs(argv){
  const out = { fromCollection: 'costumers', targetDb: 'TEAM_LINEAS', batch: 1000, filterTeam: 'lineas', initCollections: '' };
  for (let i=2; i<argv.length; i++){
    const a = argv[i];
    if (!a) continue;
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m){
      const k = m[1]; const v = m[2];
      if (k === 'fromCollection') out.fromCollection = v;
      else if (k === 'targetDb') out.targetDb = v;
      else if (k === 'batch') out.batch = Number(v)||out.batch;
      else if (k === 'filterTeam') out.filterTeam = v;
      else if (k === 'initCollections') out.initCollections = v;
      continue;
    }
    if (a === '--fromCollection' && argv[i+1]) { out.fromCollection = argv[++i]; continue; }
    if (a === '--targetDb' && argv[i+1]) { out.targetDb = argv[++i]; continue; }
    if (a === '--batch' && argv[i+1]) { out.batch = Number(argv[++i])||out.batch; continue; }
    if (a === '--filterTeam' && argv[i+1]) { out.filterTeam = argv[++i]; continue; }
    if (a === '--initCollections' && argv[i+1]) { out.initCollections = argv[++i]; continue; }
  }
  return out;
}
const argv = parseArgs(process.argv);

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.DATABASE_URL;
if (!uri) {
  console.error('[partition_team_lineas] Missing MONGODB_URI in .env');
  process.exit(1);
}

function normalizeCollectionName(name) {
  if (!name) return 'UNKNOWN';
  try {
    return name
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toUpperCase()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'UNKNOWN';
  } catch {
    return String(name).toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '_') || 'UNKNOWN';
  }
}

function pickOwner(doc) {
  const sup = (doc.supervisor || '').toString().trim();
  const agt = (doc.agenteNombre || doc.nombreAgente || doc.agente || doc.agent || '').toString().trim();
  const owner = sup || agt || 'UNKNOWN';
  return { owner, normalized: normalizeCollectionName(owner) };
}

function matchesTeam(doc, rx) {
  const role = (doc.role || doc.rol || '').toString().toLowerCase();
  const team = (doc.team || '').toString().toLowerCase();
  const sup = (doc.supervisor || '').toString().toLowerCase();
  const agt = (doc.agenteNombre || doc.nombreAgente || doc.agente || '').toString().toLowerCase();
  return rx.test(role) || rx.test(team) || rx.test(sup) || rx.test(agt);
}

(async () => {
  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  const srcDb = client.db(); // default from URI
  const targetDb = client.db(argv.targetDb);
  const rxTeam = new RegExp(argv.filterTeam, 'i');

  console.log(`[partition_team_lineas] Source: ${srcDb.databaseName}.${argv.fromCollection}`);
  console.log(`[partition_team_lineas] Target: ${argv.targetDb} (per-agent collections)`);

  // Init mode: create empty collections and indexes
  if (argv.initCollections) {
    const raw = argv.initCollections.split(',').map(s=>s.trim()).filter(Boolean);
    if (!raw.length) {
      console.log('[partition_team_lineas] No collection names provided for init');
    } else {
      for (const name of raw) {
        const norm = normalizeCollectionName(name);
        try {
          const col = targetDb.collection(norm);
          // Force create by creating an index/document noop
          await col.createIndex({ createdAt: 1 }, { background: true });
          console.log(`[partition_team_lineas] Ready collection ${argv.targetDb}.${norm}`);
        } catch (e) {
          console.warn(`[partition_team_lineas] Init warn for ${norm}:`, e?.message);
        }
      }
    }
    await client.close();
    console.log('[partition_team_lineas] INIT mode complete');
    process.exit(0);
  }

  const srcCol = srcDb.collection(argv.fromCollection);

  const total = await srcCol.countDocuments({});
  console.log(`[partition_team_lineas] Total documents in source: ${total}`);

  const cursor = srcCol.find({}, { batchSize: argv.batch });
  let processed = 0, written = 0;

  // Cache for created indexes per collection
  const indexed = new Set();

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    processed++;

    // Optional team filter
    if (!matchesTeam(doc, rxTeam)) continue;

    const { owner, normalized } = pickOwner(doc);
    const col = targetDb.collection(normalized);

    if (!indexed.has(normalized)) {
      try {
        await Promise.all([
          col.createIndex({ id: 1 }, { background: true }),
          col.createIndex({ _id: 1 }, { background: true }),
          col.createIndex({ telefono_principal: 1 }, { background: true }),
          col.createIndex({ supervisor: 1 }, { background: true }),
          col.createIndex({ dia_venta: 1 }, { background: true })
        ]);
        indexed.add(normalized);
        console.log(`[partition_team_lineas] Indexed collection ${normalized}`);
      } catch (e) {
        console.warn(`[partition_team_lineas] Index warn for ${normalized}:`, e?.message);
      }
    }

    // Build selector for upsert
    const selector = doc._id ? { _id: doc._id } : (doc.id ? { id: doc.id } : { _id: doc._id });

    try {
      await col.updateOne(selector, { $set: doc }, { upsert: true });
      written++;
    } catch (e) {
      console.warn(`[partition_team_lineas] Upsert error in ${normalized}:`, e?.message);
    }

    if (processed % 1000 === 0) {
      console.log(`[partition_team_lineas] processed=${processed}, written=${written}`);
    }
  }

  console.log(`[partition_team_lineas] DONE processed=${processed}, written=${written}`);
  await cursor.close();
  await client.close();
})().catch(e => {
  console.error('[partition_team_lineas] Fatal:', e);
  process.exit(1);
});
