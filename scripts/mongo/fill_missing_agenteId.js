#!/usr/bin/env node
/*
  fill_missing_agenteId.js

  Busca documentos en colecciones `costumers_*` donde `agenteId` está ausente
  y `agenteNombre` coincide (búsqueda suelta) con el nombre provisto, y propone
  o aplica asignarles el `ownerId` indicado.

  Uso:
    # dry-run (no modifica)
    node scripts/mongo/fill_missing_agenteId.js --name "Alejandra Melara" --ownerId 68e976e7bb7e9fa2bb73f483

    # aplicar cambios
    node scripts/mongo/fill_missing_agenteId.js --name "Alejandra Melara" --ownerId 68e976e7bb7e9fa2bb73f483 --apply

*/

try { require('dotenv').config(); } catch (e) {}
const argv = require('minimist')(process.argv.slice(2));
const { connectToMongoDB, closeConnection } = require('../../config/db');

const NAME = argv.name || argv.n;
const OWNER = argv.ownerId || argv.o;
const APPLY = !!argv.apply;

if (!NAME || !OWNER) {
  console.error('Usage: node scripts/mongo/fill_missing_agenteId.js --name "Alejandra Melara" --ownerId <ownerId> [--apply]');
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

function compactName(s) {
  try {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch (e) { return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
}

function makeLoosePattern(compact) {
  const parts = compact.split('');
  const pat = parts.map(ch => ch.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('[^\\p{L}\\p{N}]*');
  return new RegExp(pat, 'iu');
}

async function run() {
  const ownerNorm = normalizeOwnerIdInput(OWNER);
  const searchCompact = compactName(NAME);
  const looseRegex = makeLoosePattern(searchCompact);

  console.log('[fill] owner:', ownerNorm, ' name:', NAME, ' apply=', APPLY);
  const db = await connectToMongoDB();
  if (!db) {
    console.error('[fill] No DB connection');
    process.exit(3);
  }

  const allCols = await db.listCollections().toArray();
  const costCols = allCols.map(c=>c.name).filter(n=>/^costumers_/i.test(n));

  let totalProposed = 0;
  for (const col of costCols) {
    const coll = db.collection(col);
    // find docs where agenteId is missing/empty and agenteNombre exists
    const cursor = coll.find({ $or: [ { agenteId: { $exists: false } }, { agenteId: null }, { agenteId: '' } ], agenteNombre: { $exists: true, $ne: '' } }, { projection: { agenteNombre:1 } }).batchSize(500);
    let idx = 0;
    const toUpdate = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      idx++;
      const cname = compactName(doc.agenteNombre || '');
      let matched = false;
      if (cname === searchCompact) matched = true;
      else {
        try { if (looseRegex && looseRegex.test(doc.agenteNombre || '')) matched = true; } catch(e){}
      }
      if (matched) {
        toUpdate.push(doc._id);
      }
    }

    if (toUpdate.length > 0) {
      console.log(`[fill] collection=${col} proposed=${toUpdate.length}`);
      totalProposed += toUpdate.length;
      if (APPLY) {
        for (const id of toUpdate) {
          try {
            await coll.updateOne({ _id: id }, { $set: { agenteId: ownerNorm } });
          } catch (e) { console.warn('  update failed for', id, e.message); }
        }
        console.log(`  applied ${toUpdate.length} updates in ${col}`);
      } else {
        // list sample ids
        console.log('  sample ids:', toUpdate.slice(0,10));
      }
    }
  }

  console.log('[fill] total proposed updates:', totalProposed, ' applied=', APPLY);
  await closeConnection();
}

run().catch(err=>{ console.error(err); process.exit(10); });
