#!/usr/bin/env node
/**
 * Backfill de campos de agente a partir de nombre/usuario en la colección costumers
 * Pobla: agenteId (string), agentId (ObjectId), createdBy (string), ownerId (string), creadoPor (string), registeredById (ObjectId), agenteNombre (string si faltaba)
 * 
 * Modo de uso:
 *   - Dry run (recomendado primero):
 *       node scripts/backfill_agenteId_from_nombre.js --dry-run [--limit 500]
 *   - Commit (aplica cambios):
 *       node scripts/backfill_agenteId_from_nombre.js --commit [--limit 500]
 */

const { ObjectId } = require('mongodb');
const { connectToMongoDB, getDb, closeConnection } = require('../config/db');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    commit: args.includes('--commit'),
    dryRun: args.includes('--dry-run') || !args.includes('--commit'),
    limit: (() => {
      const i = args.findIndex(a => a === '--limit');
      if (i >= 0 && args[i+1]) {
        const n = parseInt(args[i+1], 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    })()
  };
}

function normalizeName(s) {
  return (s || '').toString().replace(/\s+/g, ' ').trim();
}

async function main() {
  const { dryRun, commit, limit } = parseArgs();
  console.log(`[BACKFILL] Iniciando backfill de campos de agente | dryRun=${dryRun} commit=${commit} limit=${limit ?? 'N/A'}`);

  try {
    const db = await connectToMongoDB();
    const costumers = db.collection('costumers');
    const users = db.collection('users');

    // Buscar candidatos: con algún nombre de agente y con al menos uno de los campos clave vacío/ausente
    const idFields = ['agenteId','createdBy','ownerId'];
    const idMissingOrEmpty = { $or: idFields.map(f => ({ $or: [ { [f]: { $exists: false } }, { [f]: null }, { [f]: '' } ] })) };
    const nameFields = ['agenteNombre','agente','agentName','agent'];
    const haveAnyName = { $or: nameFields.map(f => ({ [f]: { $type: 'string', $ne: '' } })) };
    const match = { $and: [ idMissingOrEmpty, haveAnyName ] };

    const projection = { projection: { _id: 1, agenteNombre: 1, agente: 1, agentName: 1, agent: 1 } };
    const cursor = costumers.find(match, projection).limit(limit ?? 0);

    let scanned = 0;
    let resolved = 0;
    let updated = 0;
    let notFound = 0;
    const ops = [];

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      scanned++;

      const nameRaw = doc.agenteNombre || doc.agente || doc.agentName || doc.agent || '';
      const name = normalizeName(nameRaw);
      if (!name) { notFound++; continue; }

      // Resolver usuario por múltiples campos (exact case-insensitive)
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`^${escaped}$`, 'i');
      const user = await users.findOne({
        $or: [
          { username: { $regex: rx } },
          { name: { $regex: rx } },
          { nombre: { $regex: rx } },
          { fullName: { $regex: rx } },
          { email: { $regex: rx } }
        ]
      }, { projection: { _id: 1, username: 1, name: 1, nombre: 1, fullName: 1, email: 1 } });

      if (!user) {
        console.log(`[NO_MATCH] costumer=${doc._id} agenteNombre='${nameRaw}' -> usuario no encontrado por username`);
        notFound++;
        continue;
      }

      resolved++;
      const updates = {
        // Guardar ambas variantes para máxima compatibilidad
        agenteId: user._id.toString(),
        agentId: user._id,
        createdBy: user._id.toString(),
        ownerId: user._id.toString(),
        creadoPor: user._id.toString(),
        registeredById: user._id,
      };
      // Completar agenteNombre si está vacío
      if (!doc.agenteNombre || doc.agenteNombre === '') {
        updates.agenteNombre = user.username || user.name || user.nombre || user.fullName || user.email || name;
      }

      console.log(`[MATCH] costumer=${doc._id} '${name}' -> user.username='${user.username}' _id=${user._id}`);
      if (dryRun) {
        continue;
      }

      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: updates } } });
      if (ops.length >= 500) {
        const res = await costumers.bulkWrite(ops, { ordered: false });
        updated += (res.modifiedCount || 0) + (res.upsertedCount || 0);
        ops.length = 0;
      }
    }

    if (!dryRun && ops.length) {
      const res = await costumers.bulkWrite(ops, { ordered: false });
      updated += (res.modifiedCount || 0) + (res.upsertedCount || 0);
    }

    console.log('[BACKFILL] Resumen');
    console.log('  Escaneados:', scanned);
    console.log('  Resueltos (usuario encontrado):', resolved);
    console.log('  Actualizados:', updated);
    console.log('  Sin usuario:', notFound);
    console.log('  Modo:', dryRun ? 'DRY-RUN' : 'COMMIT');
  } catch (err) {
    console.error('[BACKFILL] Error:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    try { await closeConnection(); } catch {}
  }
}

main();
