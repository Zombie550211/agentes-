const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');

// Ruta temporal NO autenticada para DEBUG local
// GET /api/debug-noauth/leads?supervisor=NAME&limit=200
router.get('/leads', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const supervisor = (req.query.supervisor || '').toString().trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 5000);

    // Intentar replicar la lógica del servidor para agregación por supervisor:
    // 1) Resolver usuario supervisor por username/name/_id
    // 2) Buscar usuarios con supervisorId == supervisor._id
    // 3) Obtener sus colecciones mapeadas en user_collections
    // 4) Consultar esas colecciones y devolver documentos

    const out = [];
    try {
      let supUser = null;
      // Si parece un ObjectId hex, buscar por _id también
      const maybeId = /^[a-fA-F0-9]{24}$/.test(supervisor) ? supervisor : null;
      const usersCol = db.collection('users');
      if (maybeId) {
        try { supUser = await usersCol.findOne({ _id: require('mongodb').ObjectId(maybeId) }); } catch(_) { supUser = null; }
      }
      if (!supUser) {
        supUser = await usersCol.findOne({ $or: [ { username: supervisor }, { name: supervisor }, { nombre: supervisor }, { email: supervisor } ] });
      }

      let agentes = [];
      if (supUser && supUser._id) {
        agentes = await usersCol.find({ $or: [ { supervisorId: supUser._id.toString() }, { supervisorId: supUser._id } ] }).toArray();
      } else {
        // Si no encontramos usuario supervisor, intentar usar supervisor string para matching en users.supervisorName
        agentes = await usersCol.find({ $or: [ { supervisor: { $regex: supervisor, $options: 'i' } }, { supervisorName: { $regex: supervisor, $options: 'i' } } ] }).toArray();
      }

      console.log('[DEBUG_NOAUTH] Found agents count:', agentes.length);

      const uc = db.collection('user_collections');
      const allCollections = (await db.listCollections().toArray()).map(c => c.name).filter(n => /^costumers(_|$)/i.test(n) || n === 'costumers');
      const collSet = new Set();

      for (const a of agentes) {
        const agenteId = a._id && a._id.toString ? a._id.toString() : String(a._id || '');
        try {
          const mapping = await uc.findOne({ $or: [ { ownerId: agenteId }, { ownerId: a._id } ] });
          if (mapping && mapping.collectionName) {
            collSet.add(mapping.collectionName);
            continue;
          }
        } catch (e) { /* ignore */ }
        // Fallback: intentar convención costumers_<DisplayName>
      }

      // Si no encontramos mapeos, usar convención: todas las costumers_* (caerá sobrecolecciones y se filtrará luego)
      if (collSet.size === 0) {
        for (const c of allCollections) collSet.add(c);
      }

      // Consultar colecciones encontradas
      for (const col of Array.from(collSet)) {
        try {
          const docs = await db.collection(col).find({}).limit(limit).toArray();
          if (docs && docs.length) {
            out.push(...docs.map(d => ({ _id: d._id, agente: d.agente || d.agenteNombre || '', supervisor: d.supervisor || d.supervisorName || '', dia_venta: d.dia_venta || d.createdAt || null, raw: d })));
          }
        } catch (e) { console.warn('[debug_noauth] error reading collection', col, e.message); }
        if (out.length >= limit) break;
      }

      console.log(`[DEBUG_NOAUTH] Returning ${out.length} leads for supervisor='${supervisor}' (via agent collections)`);
      return res.json({ success: true, count: out.length, data: out.slice(0, limit) });
    } catch (e) {
      console.error('[DEBUG_NOAUTH] error main', e);
      return res.status(500).json({ success: false, message: e.message });
    }
  } catch (err) {
    console.error('[debug_noauth] error', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
