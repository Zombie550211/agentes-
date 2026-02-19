const express = require('express');
const router = express.Router();

const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

// Helpers
function toFechaKey(fecha) {
  try {
    if (!fecha) return '';
    const s = String(fecha).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) {
      const yy = parseInt(m[1], 10), mm = parseInt(m[2], 10), dd = parseInt(m[3], 10);
      return String(dd).padStart(2,'0') + '/' + String(mm).padStart(2,'0') + '/' + yy;
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = parseInt(m[3], 10);
      return String(dd).padStart(2,'0') + '/' + String(mm).padStart(2,'0') + '/' + yy;
    }
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

function ensureLen9(arr) {
  let a = Array.isArray(arr) ? arr.map(v => (v == null ? '' : String(v))) : [];
  while (a.length < 9) a.push('');
  if (a.length > 9) a.length = 9;
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

let __facturacionLineasIndexesReady = false;
async function getCollection() {
  const db = getDb();
  if (!db) {
    throw new Error('DB no inicializada');
  }
  const coll = db.collection('FacturacionLineas');
  if (!__facturacionLineasIndexesReady) {
    try {
      await coll.createIndex({ anio: 1, mes: 1, dia: 1 }, { unique: true, name: 'uniq_anio_mes_dia_lineas' });
      await coll.createIndex({ fecha: 1 }, { name: 'idx_fecha_lineas' });
      __facturacionLineasIndexesReady = true;
    } catch (_) {
      // ignorar errores de índices existentes
    }
  }
  return coll;
}

// GET /api/facturacion-lineas/:anio/:mes -> { ok, data: [{fecha, campos}] }
router.get('/:anio/:mes', protect, authorize('admin','Administrador','administrador','backoffice','Backoffice'), async (req, res) => {
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

    return res.json({ ok: true, data: docs.map(d => ({ fecha: d.fecha, campos: ensureLen9(d.campos) })) });
  } catch (e) {
    console.error('[FACT-LINEAS] GET mensual error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// GET /api/facturacion-lineas/anual/:anio -> { ok, totalesPorMes: [12] }
router.get('/anual/:anio', protect, authorize('admin','Administrador','administrador','backoffice','Backoffice'), async (req, res) => {
  try {
    const anio = Number(req.params.anio);
    if (!anio) return res.status(400).json({ ok: false, message: 'Año inválido' });

    const coll = await getCollection();
    const docs = await coll.find({ anio }).project({ _id: 0, mes: 1, campos: 1 }).toArray();

    const totales = Array(12).fill(0);
    for (const d of docs) {
      const mesIdx = (Number(d.mes) || 0) - 1;
      if (mesIdx < 0 || mesIdx > 11) continue;
      const arr = ensureLen9(d.campos);
      // campos[6] = Total del Día (TOTALES)
      const totalDia = toNumber(arr[6]);
      totales[mesIdx] += totalDia;
    }

    return res.json({ ok: true, totalesPorMes: totales });
  } catch (e) {
    console.error('[FACT-LINEAS] GET anual error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// POST /api/facturacion-lineas -> body { fecha, campos[9] }
router.post('/', protect, authorize('admin','Administrador','administrador','backoffice','Backoffice'), async (req, res) => {
  try {
    const { fecha, campos } = req.body || {};
    const parsed = parseFecha(fecha);
    if (!parsed) {
      return res.status(400).json({ ok: false, message: 'Fecha inválida' });
    }
    const campos9 = ensureLen9(campos);
    const coll = await getCollection();

    const now = new Date();
    const username = req.user?.username || null;

    const result = await coll.updateOne(
      { anio: parsed.anio, mes: parsed.mes, dia: parsed.dia },
      {
        $set: {
          fecha: parsed.key,
          campos: campos9,
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
    if (e && e.code === 11000) {
      return res.status(409).json({ ok: false, message: 'Conflicto de duplicado para la fecha' });
    }
    console.error('[FACT-LINEAS] POST guardar error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

module.exports = router;
