#!/usr/bin/env node
/*
  convert_agenteId_to_objectid.js

  Busca documentos en colecciones `costumers_*` donde `agenteId` es una cadena
  que contiene un hex de 24 caracteres y lo convierte a ObjectId BSON.

  Uso:
    # dry-run (no modifica)
    node scripts/mongo/convert_agenteId_to_objectid.js

    # aplicar cambios
    node scripts/mongo/convert_agenteId_to_objectid.js --apply
*/

try { require('dotenv').config(); } catch (e) {}
const argv = require('minimist')(process.argv.slice(2));
const APPLY = !!argv.apply;
const { ObjectId } = require('mongodb');
const { connectToMongoDB, closeConnection } = require('../../config/db');

function isHex24(s) {
  return typeof s === 'string' && /^[a-fA-F0-9]{24}$/.test(s);
}

async function run() {
  console.log('[convert] apply=', APPLY);
  const db = await connectToMongoDB();
  if (!db) {
    console.error('[convert] No DB connection');
    process.exit(2);
  }

  const allCols = await db.listCollections().toArray();
  const costCols = allCols.map(c=>c.name).filter(n=>/^costumers_/i.test(n));

  let total = 0;
  for (const col of costCols) {
    const coll = db.collection(col);
    // find docs where agenteId exists and is string hex24
    const cursor = coll.find({ agenteId: { $type: 'string' } }, { projection: { agenteId:1 } }).batchSize(500);
    const toUpdate = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (isHex24(doc.agenteId)) {
        toUpdate.push({ _id: doc._id, agenteId: doc.agenteId });
      }
    }

    if (toUpdate.length > 0) {
      console.log(`[convert] collection=${col} candidates=${toUpdate.length}`);
      total += toUpdate.length;
      if (APPLY) {
        for (const u of toUpdate) {
          try {
            await coll.updateOne({ _id: u._id }, { $set: { agenteId: new ObjectId(u.agenteId) } });
          } catch (e) {
            console.warn('  update failed for', u._id.toString(), e.message);
          }
        }
        console.log(`  applied ${toUpdate.length} updates in ${col}`);
      } else {
        console.log('  sample:', toUpdate.slice(0,10));
      }
    }
  }

  console.log('[convert] total candidates:', total, ' applied=', APPLY);
  await closeConnection();
}

run().catch(err=>{ console.error('[convert] error', err); process.exit(20); });
