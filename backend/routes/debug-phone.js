const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect } = require('../middleware/auth');

/**
 * @route GET /api/debug/phone-formats
 * @desc Ver los formatos de teléfono en la base de datos
 * @access Private (solo admin)
 */
router.get('/phone-formats', protect, async (req, res) => {
  try {
    const db = getDb();
    const collection = db.collection('costumers_unified');
    
    // Obtener una muestra de leads con sus teléfonos
    const leads = await collection.find({
      $or: [
        { telefono: { $exists: true, $ne: null, $ne: '' } },
        { telefono_alterno: { $exists: true, $ne: null, $ne: '' } }
      ]
    }).limit(20).toArray();
    
    // Formatear la respuesta
    const phoneSamples = leads.map(lead => ({
      _id: lead._id,
      nombre: lead.nombre || lead.name || 'N/A',
      telefono: lead.telefono,
      telefono_alterno: lead.telefono_alterno,
      status: lead.status
    }));
    
    // Probar búsqueda con un número específico si se proporciona
    let searchResult = null;
    const testPhone = req.query.test;
    if (testPhone) {
      // Normalizar el número de prueba
      const normalized = testPhone.replace(/\D/g, '');
      
      // Intentar diferentes métodos de búsqueda
      const exactMatch = await collection.findOne({ telefono: testPhone });
      const regexMatch = await collection.findOne({ 
        telefono: { $regex: normalized.split('').join('[^\\d]*') } 
      });
      
      searchResult = {
        testPhone,
        normalized,
        regexPattern: normalized.split('').join('[^\\d]*'),
        exactMatch: exactMatch ? {
          _id: exactMatch._id,
          telefono: exactMatch.telefono,
          nombre: exactMatch.nombre
        } : null,
        regexMatch: regexMatch ? {
          _id: regexMatch._id,
          telefono: regexMatch.telefono,
          nombre: regexMatch.nombre
        } : null
      };
    }
    
    res.json({
      success: true,
      phoneSamples,
      searchResult,
      totalLeads: await collection.countDocuments()
    });
    
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
