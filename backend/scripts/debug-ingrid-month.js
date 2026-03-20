require('dotenv').config();
const { connectToMongoDB, getDb, closeConnection } = require('../config/db');

function parseNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  var s = String(value).trim().replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDateFlexible(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  // ISO YYYY-MM-DD or ISO full
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  // D/M/YYYY or DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/').map(p => parseInt(p,10));
    // assume d/m/y
    const d = new Date(parts[2], parts[1]-1, parts[0]);
    if (!isNaN(d)) return d;
  }
  // Month name (e.g., Mar 3 2026) or other parseable
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2;
  return null;
}

(async function(){
  await connectToMongoDB();
  const db = getDb();
  if (!db) {
    console.error('No DB connection');
    process.exit(1);
  }

  const col = db.collection('costumers_unified');
  console.log('Querying costumers_unified for Ingrid variants...');
  const regex = /ingrid/i;
  const cursor = col.find({ $or: [ { agente: regex }, { agenteNombre: regex }, { createdBy: regex }, { vendedor: regex }, { registeredBy: regex }, { nombre: regex } ] });
  const docs = await cursor.toArray();
  console.log('Total docs matched (any date):', docs.length);

  const start = new Date(2026, 2, 1); // March 1 2026
  const end   = new Date(2026, 3, 1); // April 1 2026

  let inMonth = 0;
  let sumPuntos = 0;
  const rows = [];

  for (const d of docs) {
    let dt = null;
    // try common fields
    dt = dt || parseDateFlexible(d.dia_venta);
    dt = dt || parseDateFlexible(d.createdAt);
    dt = dt || parseDateFlexible(d.created_at);
    dt = dt || parseDateFlexible(d.fecha_contratacion);

    if (!dt) {
      // skip if no date parsed
      continue;
    }

    if (dt >= start && dt < end) {
      inMonth++;
      const p = parseNumber(d.puntaje || d.Puntaje || d.points || d.score || 0);
      sumPuntos += p;
      rows.push({ id: String(d._id || ''), agente: d.agente || d.agenteNombre || d.createdBy || '', dia_venta: d.dia_venta, createdAt: d.createdAt, puntaje: p });
    }
  }

  console.log('\n=== Ingrid summary for 2026-03 ===');
  console.log('count:', inMonth);
  console.log('sumPuntos:', Number(sumPuntos.toFixed(4)));
  console.log('rows (first 50):', rows.slice(0,50));

  await closeConnection();
  process.exit(0);
})();
