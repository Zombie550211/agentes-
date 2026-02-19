const express = require('express');
const router = express.Router();

const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

let __indexesReady = false;
async function getCollection() {
  const db = getDb();
  if (!db) {
    throw new Error('DB no inicializada');
  }
  const coll = db.collection('LlamadasVentasLineas');
  if (!__indexesReady) {
    try {
      await coll.createIndex({ fecha: 1 }, { unique: true, name: 'uniq_fecha_lineas' });
      __indexesReady = true;
    } catch (_) {
      // ignorar errores de índices existentes
    }
  }
  return coll;
}

// GET /api/llamadas-ventas-lineas/:fecha -> { ok, data }
router.get('/:fecha', protect, authorize('admin','Administrador','administrador','backoffice','Backoffice'), async (req, res) => {
  try {
    const fecha = req.params.fecha;
    if (!fecha) {
      return res.status(400).json({ ok: false, message: 'Fecha requerida' });
    }
    
    const coll = await getCollection();
    const doc = await coll.findOne({ fecha });

    if (doc) {
      return res.json({ ok: true, data: doc });
    } else {
      return res.json({ ok: true, data: null });
    }
  } catch (e) {
    console.error('[LLAMADAS-VENTAS-LINEAS] GET error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// GET /api/llamadas-ventas-lineas/mes/:anio/:mes -> { ok, data: [] }
router.get('/mes/:anio/:mes', protect, authorize('admin','Administrador','administrador','backoffice','Backoffice'), async (req, res) => {
  try {
    const anio = Number(req.params.anio);
    const mes = Number(req.params.mes);
    
    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, message: 'Parámetros inválidos' });
    }
    
    const coll = await getCollection();
    // Buscar fechas que coincidan con el patrón YYYY-MM-*
    const regex = new RegExp(`^${anio}-${String(mes).padStart(2, '0')}-`);
    const docs = await coll.find({ fecha: { $regex: regex } }).sort({ fecha: 1 }).toArray();

    return res.json({ ok: true, data: docs });
  } catch (e) {
    console.error('[LLAMADAS-VENTAS-LINEAS] GET mes error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// POST /api/llamadas-ventas-lineas -> body { fecha, equipos }
router.post('/', protect, authorize('admin','Administrador','administrador','backoffice','Backoffice'), async (req, res) => {
  try {
    const { fecha, equipos } = req.body || {};
    
    if (!fecha) {
      return res.status(400).json({ ok: false, message: 'Fecha requerida' });
    }
    
    const coll = await getCollection();
    const now = new Date();
    const username = req.user?.username || null;

    const result = await coll.updateOne(
      { fecha },
      {
        $set: {
          equipos: equipos || {},
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
    console.error('[LLAMADAS-VENTAS-LINEAS] POST error:', e);
    res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

module.exports = router;
