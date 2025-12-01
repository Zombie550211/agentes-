#!/usr/bin/env node
/*
  find_agent_clients.js

  Uso:
    node scripts/mongo/find_agent_clients.js --name "Alejandra Melara"
    node scripts/mongo/find_agent_clients.js --id "64a..."

  Escanea las colecciones `costumers_*` y muestra conteos y hasta 5 ejemplos
  de documentos que coinciden con el agentName (busqueda suelta) o ownerId.
*/

// load .env so scripts work when invoked directly with `node`
try { require('dotenv').config(); } catch (e) { }
const argv = require('minimist')(process.argv.slice(2));
const { connectToMongoDB, closeConnection } = require('../../config/db');

const NAME = argv.name || argv.n || '';
const ID = argv.id || argv.i || '';

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

function makeLoosePattern(compact) {
  // Build a pattern that allows non-alnum characters between letters
  const parts = compact.split('');
  const pat = parts.map(ch => ch.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('[^\\p{L}\\p{N}]*');
  return new RegExp(pat, 'iu');
}

async function run() {
  if (!NAME && !ID) {
    console.error('Provide --name or --id');
    process.exit(2);
  }

  if (!process.env.MONGODB_URI && !process.env.MONGODB_URI_LOCAL) {
    console.warn('[script] Warning: MONGODB_URI not set in environment or .env. connectToMongoDB will attempt fallback but this may fail.');
  }
  const db = await connectToMongoDB();
  if (!db) {
    console.error('No DB connection');
    process.exit(3);
  }

  const all = await db.listCollections().toArray();
  const costCols = all.map(c=>c.name).filter(n=>/^costumers_/i.test(n));
  console.log('Found costumers collections:', costCols.length);

  const searchCompact = NAME ? compactName(NAME) : '';
  const looseRegex = searchCompact ? makeLoosePattern(searchCompact) : null;
  const searchId = ID ? normalizeOwnerIdInput(ID) : '';

  // check user_collections mapping
  if (searchId) {
    const mapping = await db.collection('user_collections').findOne({ $or: [ { ownerId: searchId }, { ownerIdStr: searchId } ] });
    if (mapping) console.log('user_collections mapping:', mapping);
    else console.log('No mapping found in user_collections for', searchId);
  }

  for (const col of costCols) {
    const coll = db.collection(col);
    const total = await coll.countDocuments();
    if (total === 0) continue;

    let matches = 0;
    const samples = [];
    const cursor = coll.find({}, { projection: { agenteId:1, agente:1, agenteNombre:1, createdBy:1 } }).batchSize(1000);
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const rawId = normalizeOwnerIdInput(doc.agenteId || '');
      let matched = false;
      if (searchId && rawId && (String(rawId) === String(searchId))) matched = true;
      if (!matched && searchCompact) {
        const fields = [doc.agente, doc.agenteNombre, doc.createdBy];
        for (const f of fields) {
          if (!f) continue;
          const c = compactName(f);
          if (c === searchCompact) { matched = true; break; }
          // loose regex match
          try {
            if (looseRegex && looseRegex.test(String(f))) { matched = true; break; }
          } catch (e) { }
        }
      }
      if (matched) {
        matches++;
        if (samples.length < 5) samples.push({ _id: doc._id, agenteId: doc.agenteId, agente: doc.agente, agenteNombre: doc.agenteNombre });
      }
    }

    if (matches > 0) {
      console.log('\nCollection:', col, ' totalDocs=', total, ' matches=', matches);
      console.log(' samples:', samples);
    }
  }

  await closeConnection();
  console.log('\nDone');
}

run().catch(err=>{ console.error(err); process.exit(10); });
