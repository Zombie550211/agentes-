#!/usr/bin/env node
/**
 * Backfill de dia_instalacion en la colección costumers
 * Estrategia de fuente (prioridad):
 *  1) fecha_instalacion2
 *  2) dia_venta
 *  3) creadoEn (solo si es una fecha válida)
 *
 * Uso:
 *   - Dry run (recomendado): node scripts/backfill_dia_instalacion.js --dry-run [--limit 1000]
 *   - Commit (aplica cambios): node scripts/backfill_dia_instalacion.js --commit [--limit 1000]
 */

const { connectToMongoDB, getDb, closeConnection } = require('../config/db');

function parseArgs() {
  const args = process.argv.slice(2);
  const getFlagVal = (flag) => {
    const i = args.findIndex(a => a === flag);
    if (i >= 0 && args[i+1]) return args[i+1];
    return null;
  };
  const limitStr = getFlagVal('--limit');
  const limit = limitStr ? parseInt(limitStr, 10) : null;
  return {
    commit: args.includes('--commit'),
    dryRun: args.includes('--dry-run') || !args.includes('--commit'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
  };
}

function toYmd(dateLike) {
  if (!dateLike) return null;
  try {
    if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
    const d = new Date(dateLike);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch { return null; }
}

function pickInstallDay(doc) {
  // Prioridades
  const v1 = toYmd(doc.fecha_instalacion);
  if (v1) return v1;
  const v2 = toYmd(doc.dia_venta);
  if (v2) return v2;
  const v3 = toYmd(doc.creadoEn);
  if (v3) return v3;
  return null;
}

async function main() {
  const { dryRun, commit, limit } = parseArgs();
  console.log(`[BACKFILL dia_instalacion] start | dryRun=${dryRun} commit=${commit} limit=${limit ?? 'N/A'}`);

  try {
    const db = await connectToMongoDB();
    const coll = db.collection('costumers');

    // Documentos candidatos: dia_instalacion ausente, vacío o "N/A"
    const match = {
      $or: [
        { dia_instalacion: { $exists: false } },
        { dia_instalacion: null },
        { dia_instalacion: '' },
        { dia_instalacion: 'N/A' }
      ]
    };

    const cursor = coll.find(match, {
      projection: { _id: 1, dia_instalacion: 1, fecha_instalacion: 1, dia_venta: 1, creadoEn: 1 }
    }).limit(limit ?? 0);

    let scanned = 0, updated = 0, resolvable = 0, skipped = 0;
    const ops = [];

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      scanned++;
      const value = pickInstallDay(doc);
      if (!value) { skipped++; continue; }
      resolvable++;

      if (dryRun) {
        console.log(`[DRY] _id=${doc._id} -> dia_instalacion='${value}' (from alt field)`);
        continue;
      }

      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { dia_instalacion: value } } } });
      if (ops.length >= 500) {
        const res = await coll.bulkWrite(ops, { ordered: false });
        updated += (res.modifiedCount || 0);
        ops.length = 0;
      }
    }

    if (!dryRun && ops.length) {
      const res = await coll.bulkWrite(ops, { ordered: false });
      updated += (res.modifiedCount || 0);
    }

    console.log('[BACKFILL dia_instalacion] resumen');
    console.log('  Escaneados:', scanned);
    console.log('  Resolvibles:', resolvable);
    console.log('  Actualizados:', updated);
    console.log('  Omitidos (sin fuente):', skipped);
    console.log('  Modo:', dryRun ? 'DRY-RUN' : 'COMMIT');
  } catch (err) {
    console.error('[BACKFILL dia_instalacion] Error:', err?.message || err);
    process.exitCode = 1;
  } finally {
    try { await closeConnection(); } catch {}
  }
}

main();
