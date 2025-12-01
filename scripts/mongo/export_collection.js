#!/usr/bin/env node
/*
  export_collection.js

  Exporta una colección Mongo a un archivo JSON (JSON Lines).

  Uso:
    node scripts/mongo/export_collection.js --collection costumers_Alejandra_Melara --out ./exports/alejandra.jsonl

  Nota: este script usa la conexión definida en .env (MONGODB_URI).
*/

try { require('dotenv').config(); } catch (e) {}
const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const { connectToMongoDB, closeConnection } = require('../../config/db');

const COLLECTION = argv.collection || argv.c;
const OUT = argv.out || argv.o || `./exports/${COLLECTION || 'export'}.jsonl`;

if (!COLLECTION) {
  console.error('Usage: node scripts/mongo/export_collection.js --collection <collectionName> [--out <file>]');
  process.exit(2);
}

function normalizeDoc(doc) {
  // Recursively convert ObjectId and Date to strings for JSON export
  if (doc === null || doc === undefined) return doc;
  if (Array.isArray(doc)) return doc.map(normalizeDoc);
  if (typeof doc === 'object') {
    // Detect ObjectId-like
    if (doc && typeof doc.toHexString === 'function') return doc.toHexString();
    if (doc instanceof Date) return doc.toISOString();
    const out = {};
    for (const k of Object.keys(doc)) {
      try { out[k] = normalizeDoc(doc[k]); } catch (e) { out[k] = String(doc[k]); }
    }
    return out;
  }
  return doc;
}

async function run() {
  console.log('[export] connecting to DB...');
  const db = await connectToMongoDB();
  if (!db) {
    console.error('[export] No DB connection');
    process.exit(3);
  }

  const coll = db.collection(COLLECTION);
  const total = await coll.countDocuments();
  console.log(`[export] collection=${COLLECTION} totalDocs=${total}`);

  const outDir = path.dirname(OUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const w = fs.createWriteStream(OUT, { flags: 'w', encoding: 'utf8' });
  const cursor = coll.find({}).batchSize(1000);
  let exported = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const norm = normalizeDoc(doc);
    w.write(JSON.stringify(norm) + '\n');
    exported++;
    if (exported % 1000 === 0) console.log('[export] exported', exported);
  }
  w.end();
  console.log('[export] finished exported', exported, '->', OUT);
  await closeConnection();
}

run().catch(err=>{ console.error('[export] error', err); process.exit(10); });
