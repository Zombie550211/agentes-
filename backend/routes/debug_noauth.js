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

// Ruta temporal NO autenticada para DEBUG local
// GET /api/debug-noauth/db-stats?team=TEAM%20GUADALUPE%20SANTANA
router.get('/db-stats', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const team = String(req.query.team || '').trim();
    const dbName = (db && (db.databaseName || (db.s && db.s.databaseName))) || '';

    const list = await db.listCollections().toArray();
    const names = list.map(c => c.name);
    const unifiedExists = names.includes('costumers_unified');
    const costumers = names.filter(n => /^costumers(_|$)/i.test(n));

    const out = {
      success: true,
      dbName,
      collections: {
        total: names.length,
        costumers_unified: unifiedExists,
        costumers_like: costumers.length
      },
      counts: {
        costumers_unified: null,
        costumers_sample: {},
        users_total: null,
        users_team: null
      }
    };

    if (unifiedExists) {
      try { out.counts.costumers_unified = await db.collection('costumers_unified').estimatedDocumentCount(); } catch (e) { out.counts.costumers_unified = { error: e.message }; }
    }

    for (const c of costumers.slice(0, 5)) {
      try { out.counts.costumers_sample[c] = await db.collection(c).estimatedDocumentCount(); } catch (e) { out.counts.costumers_sample[c] = { error: e.message }; }
    }

    if (names.includes('users')) {
      try { out.counts.users_total = await db.collection('users').estimatedDocumentCount(); } catch (e) { out.counts.users_total = { error: e.message }; }
      if (team) {
        try { out.counts.users_team = await db.collection('users').countDocuments({ team }); } catch (e) { out.counts.users_team = { error: e.message }; }
      }
    }

    return res.json(out);
  } catch (err) {
    console.error('[debug_noauth] db-stats error', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Ruta temporal NO autenticada para DEBUG local
// GET /api/debug-noauth/users-by-team?team=TEAM%20GUADALUPE%20SANTANA
router.get('/users-by-team', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const team = String(req.query.team || '').trim();
    if (!team) return res.status(400).json({ success: false, message: 'Missing team parameter' });

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 2000);
    const users = await db.collection('users')
      .find({ team }, { projection: { username: 1, name: 1, nombre: 1, role: 1, team: 1, supervisorId: 1 } })
      .limit(limit)
      .toArray();

    return res.json({ success: true, team, count: users.length, data: users });
  } catch (err) {
    console.error('[debug_noauth] users-by-team error', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Ruta temporal NO autenticada para DEBUG local
// GET /api/debug-noauth/users-by-supervisor?supervisorId=OBJECTID_OR_STRING
router.get('/users-by-supervisor', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const supervisorId = String(req.query.supervisorId || '').trim();
    if (!supervisorId) return res.status(400).json({ success: false, message: 'Missing supervisorId parameter' });

    const { ObjectId } = require('mongodb');
    let supOid = null;
    try { if (/^[a-fA-F0-9]{24}$/.test(supervisorId)) supOid = new ObjectId(supervisorId); } catch (_) { supOid = null; }

    const q = supOid
      ? { $or: [ { supervisorId }, { supervisorId: supOid } ] }
      : { supervisorId };

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 2000);
    const users = await db.collection('users')
      .find(q, { projection: { username: 1, name: 1, nombre: 1, role: 1, team: 1, supervisorId: 1 } })
      .limit(limit)
      .toArray();

    return res.json({ success: true, supervisorId, count: users.length, data: users });
  } catch (err) {
    console.error('[debug_noauth] users-by-supervisor error', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Ruta temporal NO autenticada para DEBUG local
// GET /api/debug-noauth/unified-team-values?limit=50
router.get('/unified-team-values', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const names = (await db.listCollections({ name: 'costumers_unified' }).toArray()).map(c => c.name);
    if (!names.includes('costumers_unified')) {
      return res.status(404).json({ success: false, message: 'costumers_unified not found' });
    }

    const pipeline = [
      { $group: { _id: '$team', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit }
    ];

    const rows = await db.collection('costumers_unified').aggregate(pipeline).toArray();
    return res.json({ success: true, limit, count: rows.length, data: rows.map(r => ({ team: r._id, count: r.count })) });
  } catch (err) {
    console.error('[debug_noauth] unified-team-values error', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Ruta temporal NO autenticada para DEBUG local
// GET /api/debug-noauth/unified-sample-by-team?team=JOHANA&limit=5
router.get('/unified-sample-by-team', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const team = String(req.query.team || '').trim();
    if (!team) return res.status(400).json({ success: false, message: 'Missing team parameter' });

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 50);
    const docs = await db.collection('costumers_unified')
      .find({ team }, { projection: { team: 1, agenteId: 1, agenteNombre: 1, agente: 1, createdBy: 1, creadoPor: 1, supervisorId: 1, supervisor: 1, supervisorName: 1, dia_venta: 1, createdAt: 1, status: 1 } })
      .limit(limit)
      .toArray();

    const sampleKeys = docs && docs.length ? Object.keys(docs[0]) : [];
    return res.json({ success: true, team, count: docs.length, sampleKeys, data: docs });
  } catch (err) {
    console.error('[debug_noauth] unified-sample-by-team error', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
