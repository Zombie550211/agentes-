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
      agentes = await usersCol.find({ $or: [ { supervisorId: supUser._id.toString() }, { supervisorId: supUser._id }, { supervisor: { $regex: supUser.username || supUser.name || '', $options: 'i' } } ] }).toArray();
    } else {
      // Fallback: match by supervisor name (case-insensitive)
      agentes = await usersCol.find({ $or: [ { supervisor: { $regex: supervisor, $options: 'i' } }, { supervisorName: { $regex: supervisor, $options: 'i' } } ] }).toArray();
    }

    const out = (agentes || []).map(a => ({ id: a._id && a._id.toString ? a._id.toString() : String(a._id||''), username: a.username, name: a.name || a.nombre, role: a.role }));
    return res.json({ success: true, count: out.length, data: out });
  } catch (e) {
    console.error('[TEAMS ROUTE] error', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
