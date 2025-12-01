#!/usr/bin/env node
/*
  list_distinct_agenteIds.js

  Uso:
    node scripts/mongo/list_distinct_agenteIds.js --collection costumers_Alejandra_Melara

  Lista los valores distintos de `agenteId` en la colección indicada y muestra
  hasta 3 documentos de ejemplo por cada agenteId para ayudarte a identificar
  a qué ownerId corresponde.
*/

// load .env so scripts work when invoked directly with `node`
try { require('dotenv').config(); } catch (e) { }
const argv = require('minimist')(process.argv.slice(2));
const { connectToMongoDB, closeConnection } = require('../../config/db');

const COLLECTION = argv.collection || argv.c;

if (!COLLECTION) {
  console.error('Usage: node scripts/mongo/list_distinct_agenteIds.js --collection <collectionName>');
  process.exit(2);
}

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
  } catch (e) { return String(v||'').trim(); }
}

async function run() {
  if (!process.env.MONGODB_URI && !process.env.MONGODB_URI_LOCAL) {
    console.warn('[script] Warning: MONGODB_URI not set in environment or .env. connectToMongoDB will attempt fallback but this may fail.');
  }
  const db = await connectToMongoDB();
  if (!db) {
    console.error('No DB connection');
    process.exit(3);
  }

  const coll = db.collection(COLLECTION);
  const exists = await db.listCollections({ name: COLLECTION }).hasNext();
  if (!exists) {
    console.error('Collection not found:', COLLECTION);
    await closeConnection();
    process.exit(4);
  }

  console.log('Scanning collection:', COLLECTION);
  const distinct = await coll.distinct('agenteId');
  console.log('Distinct agenteId count:', distinct.length);

  for (const raw of distinct) {
    const norm = normalizeOwnerIdInput(raw || '');
    console.log('\n---');
    console.log('raw:', raw, '\nnormalized:', norm);
    const samples = await coll.find({ agenteId: raw }).limit(3).project({ agenteId:1, agente:1, agenteNombre:1, telefonoPrincipal:1 }).toArray();
    console.log('samples:', samples);
  }

  await closeConnection();
  console.log('\ndone');
}

run().catch(err=>{ console.error(err); process.exit(10); });
