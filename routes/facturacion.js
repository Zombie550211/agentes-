const express = require('express');
const router = express.Router();

<<<<<<< HEAD
const { getDb } = require('../config/db');
=======
const { connectToMongoDB } = require('../config/db');
>>>>>>> 91c5e88ddc9d503a25c594e988d748deea7ab2e4
const { protect, authorize } = require('../middleware/auth');

// Helpers
function toFechaKey(fecha) {
  try {
    if (!fecha) return '';
    const s = String(fecha).trim();
    // dd/mm/yyyy
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    // yyyy-mm-dd o yyyy/mm/dd o yyyy.mm.dd
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) {
      const yy = parseInt(m[1], 10), mm = parseInt(m[2], 10), dd = parseInt(m[3], 10);
      return String(dd).padStart(2,'0') + '/' + String(mm).padStart(2,'0') + '/' + yy;
    }
    // d/m/yyyy
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = parseInt(m[3], 10);
      return String(dd).padStart(2,'0') + '/' + String(mm).padStart(2,'0') + '/' + yy;
    }
    // Fallback Date parseable
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
    }
    return s;
  } catch {
    return String(fecha || '');
  }
}

function parseFecha(fecha) {
  const key = toFechaKey(fecha);
  const m = key.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yy = parseInt(m[3], 10);
  return { key, dia: dd, mes: mm, anio: yy };
}

function ensureLen14(arr) {
  const a = Array.isArray(arr) ? arr.map(v => (v == null ? '' : String(v))) : [];
  while (a.length < 14) a.push('');
  if (a.length > 14) a.length = 14;
  return a;
}

function toNumber(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const s = String(val);
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

<<<<<<< HEAD
let __facturacionIndexesReady = false;
function getCollection() {
  const db = getDb();
  if (!db) {
    throw new Error('DB no inicializada');
  }
  const coll = db.collection('Facturacion');
  if (!__facturacionIndexesReady) {
    coll.createIndex({ anio: 1, mes: 1, dia: 1 }, { unique: true, name: 'uniq_anio_mes_dia' })
      .then(() => coll.createIndex({ fecha: 1 }, { name: 'idx_fecha' }))
      .then(() => { __facturacionIndexesReady = true; })
      .catch(() => { /* ignorar errores de índices existentes */ });
  }
=======
async function getCollection() {
  const db = await connectToMongoDB();
  const coll = db.collection('Facturacion');
  // Crear índices una sola vez (no falla si existen)
  try {
    await coll.createIndex({ anio: 1, mes: 1, dia: 1 }, { unique: true, name: 'uniq_anio_mes_dia' });
    await coll.createIndex({ fecha: 1 }, { name: 'idx_fecha' });
  } catch (_) {}
>>>>>>> 91c5e88ddc9d503a25c594e988d748deea7ab2e4
  return coll;
}

// GET /api/facturacion/anual/:anio -> { ok, totalesPorMes: [12] }
// Suma la columna "TOTAL DEL DIA" (columna 10 -> índice 9 en campos)
router.get('/anual/:anio', protect, authorize('admin','Administrador','administrador'), async (req, res) => {
  try {
    const anio = Number(req.params.anio);
    if (!anio) return res.status(400).json({ ok: false, message: 'Año inválido' });

<<<<<<< HEAD
    const coll = getCollection();
=======
    const coll = await getCollection();
>>>>>>> 91c5e88ddc9d503a25c594e988d748deea7ab2e4
    const docs = await coll.find({ anio }).project({ _id: 0, mes: 1, campos: 1 }).toArray();

    const totales = Array(12).fill(0);
    for (const d of docs) {
      const mesIdx = (Number(d.mes) || 0) - 1;
      if (mesIdx < 0 || mesIdx > 11) continue;
      const arr = ensureLen14(d.campos);
      const totalDia = toNumber(arr[9]); // índice 9 = columna 10 (TOTAL DEL DIA)
      totales[mesIdx] += totalDia;
    }

    return res.json({ ok: true, totalesPorMes: totales });
  } catch (e) {
    console.error('[FACT] GET anual error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// GET /api/facturacion/:anio/:mes -> { ok, data: [{fecha, campos}] }
router.get('/:anio/:mes', protect, authorize('admin','Administrador','administrador'), async (req, res) => {
  try {
    const anio = Number(req.params.anio);
    const mes = Number(req.params.mes);
    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, message: 'Parámetros inválidos' });
    }
    const coll = await getCollection();
    const docs = await coll
      .find({ anio, mes })
      .project({ _id: 0, fecha: 1, campos: 1, dia: 1 })
      .sort({ dia: 1 })
      .toArray();

    return res.json({ ok: true, data: docs.map(d => ({ fecha: d.fecha, campos: ensureLen14(d.campos) })) });
  } catch (e) {
    console.error('[FACT] GET mensual error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// POST /api/facturacion -> body { fecha, campos[14] }
router.post('/', protect, authorize('admin','Administrador','administrador'), async (req, res) => {
  try {
    const { fecha, campos } = req.body || {};
    const parsed = parseFecha(fecha);
    if (!parsed) {
      return res.status(400).json({ ok: false, message: 'Fecha inválida' });
    }
    const campos14 = ensureLen14(campos);
    const coll = await getCollection();

    const now = new Date();
    const username = req.user?.username || null;

    const result = await coll.updateOne(
      { anio: parsed.anio, mes: parsed.mes, dia: parsed.dia },
      {
        $set: {
          fecha: parsed.key,
          campos: campos14,
          updatedAt: now,
          updatedBy: username,
        },
        $setOnInsert: {
          createdAt: now,
          createdBy: username,
        }
      },
      { upsert: true }
    );

    return res.json({ ok: true, upserted: !!result.upsertedId, modifiedCount: result.modifiedCount });
  } catch (e) {
    // Manejo de conflictos de índice único
    if (e && e.code === 11000) {
      return res.status(409).json({ ok: false, message: 'Conflicto de duplicado para la fecha' });
    }
    console.error('[FACT] POST guardar error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});


module.exports = router;
