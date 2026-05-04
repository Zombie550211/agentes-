const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');

// GET /api/teams/agents?supervisor=NAME_OR_ID
router.get('/agents', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const supervisor = (req.query.supervisor || '').toString().trim();
    if (!supervisor) return res.status(400).json({ success: false, message: 'Missing supervisor parameter' });

    const usersCol = db.collection('users');
    let supUser = null;
    // Try as ObjectId
    if (/^[a-fA-F0-9]{24}$/.test(supervisor)) {
      try { supUser = await usersCol.findOne({ _id: ObjectId(supervisor) }); } catch(_) { supUser = null; }
    }
    if (!supUser) {
      supUser = await usersCol.findOne({ $or: [ { username: supervisor }, { name: supervisor }, { nombre: supervisor }, { email: supervisor } ] });
    }

    let agentes = [];
    if (supUser && supUser._id) {
      // Prefer supervisorId mapping
      const supName = (supUser.username || supUser.name || supUser.nombre || '').toString();
      const or = [
        { supervisorId: supUser._id.toString() },
        { supervisorId: supUser._id },
        ...(supName ? [{ supervisor: { $regex: supName, $options: 'i' } }] : []),
        ...(supName ? [{ supervisorName: { $regex: supName, $options: 'i' } }] : []),
        ...(supUser.team ? [{ team: supUser.team }] : [])
      ];

      agentes = await usersCol.find({
        $and: [
          { $or: or },
          { _id: { $ne: supUser._id } },
          { role: { $not: /supervisor/i } }
        ]
      }).toArray();
    } else {
      // Fallback: match by supervisor name (case-insensitive)
      agentes = await usersCol.find({
        $and: [
          { $or: [ { supervisor: { $regex: supervisor, $options: 'i' } }, { supervisorName: { $regex: supervisor, $options: 'i' } } ] },
          { role: { $not: /supervisor/i } }
        ]
      }).toArray();
    }

    // Ensure supervisors are not returned as agents (defensive filter)
    agentes = (agentes || []).filter(a => { const r = String(a.role || '').toLowerCase(); return !/supervisor/i.test(r); });

    const out = agentes.map(a => ({ id: a._id && a._id.toString ? a._id.toString() : String(a._id||''), username: a.username, name: a.name || a.nombre, role: a.role }));
    return res.json({ success: true, count: out.length, data: out });
  } catch (e) {
    console.error('[TEAMS ROUTE] error', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/supervisors-list
// Devuelve lista de todos los supervisores del sistema
router.get('/supervisors-list', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB not connected' });

    const usersCol = db.collection('users');
    console.log('[SUPERVISORS LIST] Buscando usuarios con rol supervisor...');

    // 1. Buscar supervisores en la base de datos
    const supervisors = await usersCol.find({
      $or: [
        { role: { $regex: /supervisor/i } },
        { role: 'Supervisor' },
        { role: 'supervisor' }
      ]
    }).project({
      username: 1,
      name: 1,
      nombre: 1,
      fullName: 1,
      team: 1,
      role: 1,
      supervisor: 1,
      supervisorName: 1
    }).toArray();

    console.log('[SUPERVISORS LIST] Supervisores encontrados en DB:', supervisors.length);

    // Normalizar nombres y crear formato esperado por el frontend
    const normalized = supervisors.map(s => {
      const name = s.name || s.nombre || s.fullName || s.username || '';
      const key = name
        .toString()
        .toUpperCase()
        .split(/\s+/)
        .map(w => w.charAt(0))
        .join('')
        || s.username.toUpperCase();

      return {
        key: key,
        name: name,
        username: s.username || '',
        team: s.team || ''
      };
    });

    // 2. Merge con lista completa de teamsServer.js para no perder ninguno
    try {
      const teamsServer = require('../utils/teamsServer');
      const allKnown = (typeof teamsServer.getSupervisors === 'function') ? teamsServer.getSupervisors() : [];
      const seenKeys = new Set(normalized.map(n => n.key));
      allKnown.forEach(function(known) {
        if (!seenKeys.has(known.key)) {
          normalized.push({
            key: known.key,
            name: known.name,
            username: known.username || '',
            team: known.team || ''
          });
        }
      });
    } catch (e) { /* no-op: teamsServer no disponible */ }

    console.log('[SUPERVISORS LIST] Total supervisores devueltos:', normalized.length);
    return res.json({ success: true, supervisors: normalized });
  } catch (e) {
    console.error('[SUPERVISORS LIST] error', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
