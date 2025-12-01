#!/usr/bin/env node
/*
  backfill_normalize_collections.js

  - Dry-run by default: reports what would be changed.
  - Use --apply to actually perform updates (id normalization and user_collections upserts).

  What it does:
  1) Connects to DB via config/db.js
  2) Lists collections starting with 'costumers_'
  3) For each collection, scans documents in chunks and normalizes `agenteId` where the stored value differs from a canonical normalized value.
  4) Upserts `user_collections` mapping ownerId -> collectionName when a clear ownerId is found.
  5) Reports possible collection groups that share same shortId (candidates for manual merge).

  Run:
    # dry-run
    node scripts/mongo/backfill_normalize_collections.js

    # apply changes
    node scripts/mongo/backfill_normalize_collections.js --apply
*/

const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const apply = !!argv.apply;
const BATCH = 500;

// Load environment from .env (so MONGODB_URI is available)
try { require('dotenv').config(); } catch (e) { /* ignore if dotenv not installed globally */ }
const { connectToMongoDB, closeConnection, getDb } = require('../../config/db');

function normalizeOwnerIdInput(v) {
  try {
    if (!v) return '';
    if (typeof v === 'object') {
      if (v.$oid) return String(v.$oid);
      if (v.toHexString && typeof v.toHexString === 'function') return String(v.toHexString());
      const s = String(v);
      const m = s.match(/([a-fA-F0-9]{24})/);
      if (m) return m[1];
      return s.trim();
    }
    const s = String(v).trim();
    const m1 = s.match(/^ObjectId\('([a-fA-F0-9]{24})'\)$/);
    if (m1) return m1[1];
    const m2 = s.match(/^([a-fA-F0-9]{24})$/);
    if (m2) return m2[1];
    return s;
  } catch (e) {
    return String(v || '').trim();
  }
}

function compactName(s) {
  try {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch (e) { return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
}

async function run() {
  console.log('[backfill] connectToMongoDB...');
  const db = await connectToMongoDB();
  if (!db) {
    console.error('[backfill] No DB connection. Aborting.');
    process.exit(1);
  }

  const allCols = await db.listCollections().toArray();
  const costCols = allCols.map(c=>c.name).filter(n=>/^costumers_/i.test(n));
  console.log('[backfill] Found costumers collections:', costCols.length);

  // Load existing user_collections
  const mappings = {};
  try {
    const rows = await db.collection('user_collections').find({}).toArray();
    for (const r of rows) {
      const oid = normalizeOwnerIdInput(r.ownerId || r.owner || r.ownerIdStr || '');
      if (oid) mappings[oid] = r.collectionName;
    }
    console.log('[backfill] Loaded user_collections mappings:', Object.keys(mappings).length);
  } catch (e) {
    console.warn('[backfill] Could not read user_collections:', e.message);
  }

  const mergeCandidates = {}; // shortId -> [cols]

  for (const colName of costCols) {
    console.log('\n[collection] ', colName);
    const short = colName.replace(/^costumers_/i,'').split('_').pop();
    if (!mergeCandidates[short]) mergeCandidates[short]=[];
    mergeCandidates[short].push(colName);

    const coll = db.collection(colName);
    // Count documents
    const total = await coll.countDocuments();
    console.log('  total documents:', total);
    if (total === 0) continue;

    // Scan documents in batches and normalize agenteId
    const cursor = coll.find({}, { projection: { agenteId:1, agente:1, agenteNombre:1 } }).batchSize(BATCH);
    let idx = 0;
    let updates = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      idx++;
      const id = doc._id;
      const raw = doc.agenteId;
      const norm = normalizeOwnerIdInput(raw || '');
      if (!norm) continue; // nothing to normalize
      // If stored value differs from normalized, update
      if (String(raw || '') !== String(norm)) {
        updates++;
        console.log(`    [fix] doc ${id}: agenteId '${raw}' -> '${norm}'`);
        if (apply) {
          try {
            await coll.updateOne({ _id: id }, { $set: { agenteId: norm } });
          } catch (e) { console.warn('      update failed:', e.message); }
        }
        // ensure mapping exists
        if (mappings[norm] && mappings[norm] !== colName) {
          console.log(`    [mapping] existing mapping for ${norm} -> ${mappings[norm]} (this collection ${colName})`);
        } else if (!mappings[norm]) {
          console.log(`    [mapping] would upsert mapping ${norm} -> ${colName}`);
          if (apply) {
            try {
              await db.collection('user_collections').updateOne({ ownerId: norm }, { $set: { ownerId: norm, collectionName: colName, updatedAt: new Date() } }, { upsert: true });
              mappings[norm]=colName;
            } catch (e) { console.warn('      mapping upsert failed:', e.message); }
          }
        }
      }
      if (idx % 1000 === 0) console.log('    scanned', idx);
    }
    console.log(`  done scanned ${idx}. updates proposed: ${updates}`);
  }

  // Report merge candidates where multiple collections share same shortId
  console.log('\n[merge-candidates] Collections grouped by shortId (suffix)');
  for (const short of Object.keys(mergeCandidates)) {
    const arr = mergeCandidates[short];
    if (arr.length > 1) {
      console.log('  shortId=', short, ' -> ', arr.join(', '));
    }
  }

  console.log('\nSummary:');
  console.log('  collections scanned:', costCols.length);
  console.log('  mappings known:', Object.keys(mappings).length);
  console.log('\nDry-run mode =', !apply);

  await closeConnection();
  console.log('[backfill] done');
}

run().catch(err=>{
  console.error('[backfill] error', err);
  process.exit(2);
});
