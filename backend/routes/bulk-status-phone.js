// backend/routes/bulk-status-phone.js
// POST /api/leads/bulk-status-by-phone  — Cambio masivo de status por teléfono
// POST /api/leads/bulk-status-by-name   — Cambio masivo de status por nombre
// Acceso: Administrador, Backoffice únicamente

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb, isConnected } = require('../config/db');
const { protect }            = require('../middleware/auth');

// ── HELPERS ───────────────────────────────────────────────────

// Últimos 10 dígitos del teléfono
function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Roles con acceso — debe coincidir con server.js
function canUseRole(req) {
  const r = String(req.user?.role || '').toLowerCase().trim();
  return [
    'admin', 'administrador', 'administrator', 'administrativo',
    'backoffice', 'back office', 'back_office', 'bo', 'b.o',
    'rol_icon', 'rol-icon', 'rol_bamo'
  ].some(v => r === v || r.includes(v));
}

// ── POST /bulk-status-by-phone ────────────────────────────────
router.post('/bulk-status-by-phone', protect, async (req, res) => {
  try {
    if (!canUseRole(req)) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }

    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'BD no disponible' });
    }

    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const { phones, newStatus } = req.body || {};

    if (!Array.isArray(phones) || !phones.length) {
      return res.status(400).json({ success: false, message: 'Se requiere array de teléfonos' });
    }
    if (!newStatus) {
      return res.status(400).json({ success: false, message: 'Se requiere newStatus' });
    }

    // Limpiar y deduplicar teléfonos de entrada
    const inputPhones = [...new Set(
      phones.map(normalizePhone).filter(p => p.length === 10)
    )];

    if (!inputPhones.length) {
      return res.status(400).json({ success: false, message: 'Sin números válidos de 10 dígitos' });
    }

    const coll = db.collection('costumers_unified');

    // Buscar directamente por los teléfonos en la BD — sin traer todo a memoria
    // Regex de sufijo para cubrir formatos con código de país (+1, etc.)
    const phoneRegexes = inputPhones.map(p => new RegExp(escapeRegex(p) + '$'));

    const query = {
      $or: [
        { telefono:           { $in: inputPhones } },
        { telefono_principal: { $in: inputPhones } },
        { telefono_alterno:   { $in: inputPhones } },
        { telefono:           { $in: phoneRegexes } },
        { telefono_principal: { $in: phoneRegexes } },
        { telefono_alterno:   { $in: phoneRegexes } },
      ]
    };

    const foundLeads = await coll
      .find(query)
      .project({ _id: 1, nombre_cliente: 1, telefono: 1, telefono_principal: 1, telefono_alterno: 1, status: 1 })
      .toArray();

    if (!foundLeads.length) {
      return res.json({
        success:        true,
        updated:        0,
        found:          0,
        notFound:       inputPhones.length,
        foundPhones:    [],
        notFoundPhones: inputPhones,
        updatedLeads:   [],
        message:        'No se encontraron leads con esos teléfonos'
      });
    }

    // Actualizar todos en una sola operación
    const leadIds      = foundLeads.map(l => l._id);
    const updateResult = await coll.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          status:    newStatus,
          updatedAt: new Date(),
          updatedBy: req.user?.username || 'Sistema'
        }
      }
    );

    // Construir resumen
    const foundPhonesSet = new Set();
    foundLeads.forEach(l => {
      const p = normalizePhone(l.telefono_principal || l.telefono || l.telefono_alterno || '');
      if (p) foundPhonesSet.add(p);
    });

    const notFoundPhones = inputPhones.filter(p => !foundPhonesSet.has(p));

    const updatedLeads = foundLeads.map(l => ({
      id:             String(l._id),
      nombre_cliente: String(l.nombre_cliente || '').trim(),
      telefono:       normalizePhone(l.telefono_principal || l.telefono || l.telefono_alterno || '')
    }));

    return res.json({
      success:        true,
      message:        `${updateResult.modifiedCount} lead(s) actualizados a "${newStatus}"`,
      updated:        updateResult.modifiedCount,
      found:          foundLeads.length,
      notFound:       notFoundPhones.length,
      foundPhones:    Array.from(foundPhonesSet),
      notFoundPhones,
      updatedLeads,
      totalPhones:    inputPhones.length
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error:   process.env.NODE_ENV !== 'production' ? e.message : undefined
    });
  }
});

// ── POST /bulk-status-by-name ─────────────────────────────────
router.post('/bulk-status-by-name', protect, async (req, res) => {
  try {
    if (!canUseRole(req)) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }

    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'BD no disponible' });
    }

    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const { names, newStatus } = req.body || {};

    if (!Array.isArray(names) || !names.length) {
      return res.status(400).json({ success: false, message: 'Se requiere array de nombres' });
    }
    if (!newStatus) {
      return res.status(400).json({ success: false, message: 'Se requiere newStatus' });
    }

    const normalizedNames = [...new Set(
      names.map(normalizeName).filter(n => n.length >= 3)
    )];

    if (!normalizedNames.length) {
      return res.status(400).json({ success: false, message: 'Sin nombres válidos (mínimo 3 caracteres)' });
    }

    const coll = db.collection('costumers_unified');

    const regexes = normalizedNames.slice(0, 300).map(n =>
      new RegExp('^' + escapeRegex(n) + '$', 'i')
    );

    const foundLeads = await coll
      .find({ nombre_cliente: { $in: regexes } })
      .project({ _id: 1, nombre_cliente: 1, telefono: 1, telefono_principal: 1, status: 1 })
      .toArray();

    if (!foundLeads.length) {
      return res.json({
        success:       true,
        updated:       0,
        found:         0,
        notFound:      normalizedNames.length,
        foundNames:    [],
        notFoundNames: normalizedNames,
        updatedLeads:  [],
        message:       'No se encontraron leads con esos nombres'
      });
    }

    const leadIds      = foundLeads.map(l => l._id);
    const updateResult = await coll.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          status:    newStatus,
          updatedAt: new Date(),
          updatedBy: req.user?.username || 'Sistema'
        }
      }
    );

    const foundNamesSet = new Set(foundLeads.map(l => normalizeName(l.nombre_cliente || '')));
    const notFoundNames = normalizedNames.filter(n => !foundNamesSet.has(n));

    const updatedLeads = foundLeads.map(l => ({
      id:             String(l._id),
      nombre_cliente: String(l.nombre_cliente || '').trim(),
      telefono:       normalizePhone(l.telefono_principal || l.telefono || '')
    }));

    return res.json({
      success:       true,
      message:       `${updateResult.modifiedCount} lead(s) actualizados a "${newStatus}"`,
      updated:       updateResult.modifiedCount,
      found:         foundNamesSet.size,
      notFound:      notFoundNames.length,
      foundNames:    Array.from(foundNamesSet),
      notFoundNames,
      updatedLeads,
      totalNames:    normalizedNames.length
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error:   process.env.NODE_ENV !== 'production' ? e.message : undefined
    });
  }
});

module.exports = router;