#!/usr/bin/env node
/*
  upsert_user_collection_mapping.js

  Uso:
    node scripts/mongo/upsert_user_collection_mapping.js --ownerId <ownerId> --collection costumers_Alejandra_Melara

  Normaliza el ownerId y hace un upsert en la colección `user_collections`
  para apuntarlo a la colección indicada.
*/

// load .env so scripts work when invoked directly with `node`
try { require('dotenv').config(); } catch (e) { }
const argv = require('minimist')(process.argv.slice(2));
const { connectToMongoDB, closeConnection } = require('../../config/db');

const OWNER = argv.ownerId || argv.o;
const COLLECTION = argv.collection || argv.c;

if (!OWNER || !COLLECTION) {
  console.error('Usage: node scripts/mongo/upsert_user_collection_mapping.js --ownerId <ownerId> --collection <collectionName>');
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

  const norm = normalizeOwnerIdInput(OWNER);
  if (!norm) {
    console.error('Could not normalize ownerId:', OWNER);
    await closeConnection();
    process.exit(4);
  }

  try {
    const res = await db.collection('user_collections').updateOne({ ownerId: norm }, { $set: { ownerId: norm, collectionName: COLLECTION, updatedAt: new Date() } }, { upsert: true });
    console.log('Upsert result:', res.result || res);
    console.log(`Mapped ownerId ${norm} -> ${COLLECTION}`);
  } catch (e) {
    console.error('Upsert failed:', e.message);
  }

  await closeConnection();
}

run().catch(err=>{ console.error(err); process.exit(10); });
