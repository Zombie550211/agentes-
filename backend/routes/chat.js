const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { getDb } = require('../config/db');
const Message = require('../models/Message');

// GET /api/chat/users — lista todos los usuarios del CRM
router.get('/users', protect, async (req, res) => {
  try {
    const db = getDb();
    const users = await db.collection('users').find(
      { username: { $ne: req.user.username } },
      { projection: { username: 1, name: 1, role: 1, team: 1, avatarUrl: 1 } }
    ).toArray();
    res.json({ success: true, users });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/conversations — lista de conversaciones del usuario
router.get('/conversations', protect, async (req, res) => {
  try {
    const list = await Message.getConversationList(req.user.username);
    res.json({ success: true, conversations: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/messages/:username — mensajes con un usuario específico
router.get('/messages/:username', protect, async (req, res) => {
  try {
    const msgs = await Message.getConversation(req.user.username, req.params.username);
    // Marcar como leídos los mensajes recibidos
    const unreadIds = msgs.filter(m => m.to === req.user.username && !m.isRead).map(m => m._id.toString());
    if (unreadIds.length) await Message.markRead(unreadIds, req.user.username);
    res.json({ success: true, messages: msgs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/chat/messages — enviar mensaje
router.post('/messages', protect, async (req, res) => {
  try {
    const { to, toName, body, subject, type } = req.body;
    if (!to || !body) return res.status(400).json({ success: false, message: 'Faltan campos' });

    const msg = await Message.send({
      from: req.user.username,
      fromName: req.user.name || req.user.username,
      fromAvatar: req.user.avatarUrl || '',
      to, toName: toName || to,
      body, subject, type: type || 'chat'
    });

    // Emitir en tiempo real al destinatario
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${to}`).emit('chat:message', msg);
      io.to(`user:${req.user.username}`).emit('chat:message', msg);
    }

    res.json({ success: true, message: msg });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/inbox — todos los mensajes recibidos
router.get('/inbox', protect, async (req, res) => {
  try {
    const msgs = await Message.getInbox(req.user.username);
    res.json({ success: true, messages: msgs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/sent — mensajes enviados
router.get('/sent', protect, async (req, res) => {
  try {
    const msgs = await Message.getSent(req.user.username);
    res.json({ success: true, messages: msgs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/unread — mensajes no leídos
router.get('/unread', protect, async (req, res) => {
  try {
    const msgs = await Message.getUnread(req.user.username);
    res.json({ success: true, messages: msgs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/followup — mensajes en seguimiento
router.get('/followup', protect, async (req, res) => {
  try {
    const msgs = await Message.getFollowup(req.user.username);
    res.json({ success: true, messages: msgs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/chat/unread-count — contador de no leídos
router.get('/unread-count', protect, async (req, res) => {
  try {
    const count = await Message.unreadCount(req.user.username);
    res.json({ success: true, count });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/chat/messages/:id/read
router.patch('/messages/:id/read', protect, async (req, res) => {
  try {
    await Message.markRead([req.params.id], req.user.username);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/chat/messages/:id/followup
router.patch('/messages/:id/followup', protect, async (req, res) => {
  try {
    const state = await Message.toggleFollowup(req.params.id);
    const io = req.app.get('io');
    if (io) io.to(`user:${req.user.username}`).emit('chat:followup', { id: req.params.id, state });
    res.json({ success: true, followup: state });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
