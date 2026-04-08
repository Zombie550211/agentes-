const express = require('express');
const router  = express.Router();
const { getDb }  = require('../config/db');
const { protect } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

function broadcast(action, coleccion, doc) {
  if (global.io) {
    global.io.emit('premios-update', { action, coleccion, doc, ts: new Date().toISOString() });
  }
}

/* ── GET /api/premios/activos ── */
router.get('/activos', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const items = await db.collection('premios_activos').find({}).sort({ createdAt: 1 }).toArray();
    const data = items.map(d => ({ ...d, _id: d._id.toString() }));
    res.json({ success: true, data });
  } catch (e) {
    console.error('[PREMIOS] GET activos:', e);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/* ── POST /api/premios/activos ── */
router.post('/activos', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const { tipo, titulo, descripcion, categoria, monto } = req.body || {};
    const TIPOS = ['first','second','third','special','team','bonus'];
    if (!TIPOS.includes(tipo) || !titulo || !descripcion || !categoria) {
      return res.status(400).json({ success: false, message: 'Datos incompletos' });
    }

    const doc = {
      tipo,
      titulo:      String(titulo).trim(),
      descripcion: String(descripcion).trim(),
      categoria:   String(categoria).trim(),
      monto:       Number(monto) || 0,
      creadoPor:   req.user?.username || req.user?.name || 'usuario',
      createdAt:   new Date()
    };

    const result = await db.collection('premios_activos').insertOne(doc);
    doc._id = result.insertedId.toString();

    broadcast('add', 'activos', doc);
    res.json({ success: true, data: doc });
  } catch (e) {
    console.error('[PREMIOS] POST activos:', e);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/* ── DELETE /api/premios/activos/:id ── */
router.delete('/activos/:id', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const id = req.params.id;
    let filter;
    try { filter = { _id: new ObjectId(id) }; } catch (_) { filter = { _id: id }; }

    const deleted = await db.collection('premios_activos').findOneAndDelete(filter);
    if (!deleted) return res.status(404).json({ success: false, message: 'No encontrado' });

    broadcast('delete', 'activos', { _id: id });
    res.json({ success: true });
  } catch (e) {
    console.error('[PREMIOS] DELETE activos:', e);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/* ── GET /api/premios/ganadores ── */
router.get('/ganadores', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const items = await db.collection('premios_ganadores').find({}).sort({ createdAt: 1 }).toArray();
    const data = items.map(d => ({ ...d, _id: d._id.toString() }));
    res.json({ success: true, data });
  } catch (e) {
    console.error('[PREMIOS] GET ganadores:', e);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/* ── POST /api/premios/ganadores ── */
router.post('/ganadores', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const { tipo, nombre, iniciales, monto, categoria, fecha, status } = req.body || {};
    if (!nombre || !iniciales) {
      return res.status(400).json({ success: false, message: 'Nombre e iniciales requeridos' });
    }

    const doc = {
      tipo:       tipo || 'second',
      nombre:     String(nombre).trim(),
      iniciales:  String(iniciales).trim().toUpperCase(),
      monto:      Number(monto) || 0,
      categoria:  String(categoria || '').trim(),
      fecha:      fecha || new Date().toISOString().slice(0, 10),
      status:     status === 'pendiente' ? 'pendiente' : 'asignado',
      creadoPor:  req.user?.username || req.user?.name || 'usuario',
      createdAt:  new Date()
    };

    const result = await db.collection('premios_ganadores').insertOne(doc);
    doc._id = result.insertedId.toString();

    broadcast('add', 'ganadores', doc);
    res.json({ success: true, data: doc });
  } catch (e) {
    console.error('[PREMIOS] POST ganadores:', e);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/* ── DELETE /api/premios/ganadores/:id ── */
router.delete('/ganadores/:id', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const id = req.params.id;
    let filter;
    try { filter = { _id: new ObjectId(id) }; } catch (_) { filter = { _id: id }; }

    const deleted = await db.collection('premios_ganadores').findOneAndDelete(filter);
    if (!deleted) return res.status(404).json({ success: false, message: 'No encontrado' });

    broadcast('delete', 'ganadores', { _id: id });
    res.json({ success: true });
  } catch (e) {
    console.error('[PREMIOS] DELETE ganadores:', e);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

module.exports = router;
