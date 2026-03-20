const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect } = require('../middleware/auth');

/**
 * @route GET /api/debug/find-phone
 * @desc Buscar un número de teléfono en todas las colecciones
 * @access Private
 */
router.get('/find-phone', protect, async (req, res) => {
  try {
    const db = getDb();
    const phone = req.query.phone;
    
    if (!phone) {
      return res.status(400).json({ error: 'Se requiere parámetro phone' });
    }
    
    // Normalizar el número
    const normalized = phone.replace(/\D/g, '');
    
    console.log(`[DEBUG] Buscando número: ${phone} (normalizado: ${normalized})`);
    
    // Buscar en costumers_unified
    const unified = await db.collection('costumers_unified').findOne({
      $or: [
        { telefono: { $regex: normalized } },
        { telefono_alterno: { $regex: normalized } }
      ]
    });
    
    // Buscar en costumers (si existe)
    let costumers = null;
    try {
      const collections = await db.listCollections().toArray();
      const hasCostumers = collections.some(c => c.name === 'costumers');
      if (hasCostumers) {
        costumers = await db.collection('costumers').findOne({
          $or: [
            { telefono: { $regex: normalized } },
            { phone: { $regex: normalized } },
            { telefono_alterno: { $regex: normalized } }
          ]
        });
      }
    } catch (e) {
      console.log('Colección costumers no encontrada');
    }
    
    res.json({
      searchPhone: phone,
      normalized,
      foundInCostumersUnified: !!unified,
      foundInCostumers: !!costumers,
      unifiedData: unified ? {
        _id: unified._id,
        telefono: unified.telefono,
        telefono_alterno: unified.telefono_alterno,
        nombre: unified.nombre || unified.name
      } : null,
      costumersData: costumers ? {
        _id: costumers._id,
        telefono: costumers.telefono || costumers.phone,
        nombre: costumers.nombre || costumers.name
      } : null
    });
    
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
