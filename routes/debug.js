const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect } = require('../middleware/auth');

// GET /api/debug/ranking-raw?agente=NAME&fecha=YYYY-MM-DD&skipDate=1
// Devuelve documentos crudos para el agente en todas las colecciones costumers*
router.get('/ranking-raw', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });
    const agente = req.query.agente;
    const fecha = req.query.fecha; // optional
    const skipDate = String(req.query.skipDate) === '1';
    if (!agente) return res.status(400).json({ success: false, message: 'Missing agente param' });

    const collInfos = await db.listCollections().toArray();
    const targetColls = collInfos.map(c => c.name).filter(n => /^costumers(_|$)/i.test(n) || /^costumers_/i.test(n) || /^costumers$/i.test(n));
    if (!targetColls.includes('costumers')) targetColls.unshift('costumers');

    const results = [];
    for (const col of targetColls) {
      const q = { $or: [ { agenteNombre: { $regex: agente, $options: 'i' } }, { agente: { $regex: agente, $options: 'i' } } ] };
      if (!skipDate && fecha) {
        const start = new Date(fecha + 'T00:00:00-06:00');
        const end = new Date(start); end.setDate(end.getDate() + 1);
        q.$or = q.$or.concat([ { dia_venta: { $regex: `^${fecha}` } }, { createdAt: { $gte: start, $lt: end } } ]);
      }
      const docs = await db.collection(col).find(q).limit(200).toArray();
      if (docs && docs.length) results.push({ collection: col, count: docs.length, docs });
    }

    res.json({ success: true, agente, results });
  } catch (err) {
    console.error('[DEBUG] ranking-raw error', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
