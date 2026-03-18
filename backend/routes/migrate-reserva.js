/**
 * Endpoint temporal para migrar ventas con status='reserva' a was_reserva=true
 * Este endpoint debe ser llamado una sola vez y luego eliminado
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

router.post('/populate-was-reserva', protect, authorize('Administrador', 'admin'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'No hay conexión a la base de datos' });
    }

    const collections = ['costumers_unified', 'costumers'];
    const results = {};

    for (const collectionName of collections) {
      try {
        const collection = db.collection(collectionName);
        
        // Buscar documentos con status='reserva' (case insensitive) sin was_reserva=true
        const filter = {
          $or: [
            { status: { $regex: /^reserva$/i } },
            { estado: { $regex: /^reserva$/i } }
          ],
          $or: [
            { was_reserva: { $exists: false } },
            { was_reserva: null },
            { was_reserva: false },
            { was_reserva: 'false' },
            { was_reserva: 0 }
          ]
        };
        
        // Contar documentos a actualizar
        const count = await collection.countDocuments(filter);
        
        if (count === 0) {
          results[collectionName] = { matched: 0, modified: 0, message: 'No hay documentos para actualizar' };
          continue;
        }
        
        // Actualizar todos los documentos
        const result = await collection.updateMany(
          filter,
          { $set: { was_reserva: true } }
        );
        
        results[collectionName] = {
          matched: result.matchedCount,
          modified: result.modifiedCount,
          message: `Actualizados ${result.modifiedCount} de ${result.matchedCount} documentos`
        };
        
      } catch (error) {
        results[collectionName] = { error: error.message };
      }
    }

    res.json({
      success: true,
      message: 'Migración completada',
      results
    });

  } catch (error) {
    console.error('[MIGRATE] Error:', error);
    res.status(500).json({ success: false, message: 'Error en la migración', error: error.message });
  }
});

module.exports = router;
