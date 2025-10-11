const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect } = require('../middleware/auth');

/**
 * @route GET /api/ranking-test
 * @desc Endpoint de prueba para validar datos de ranking
 * @access Private
 */
router.get('/', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    console.log('[RANKING-TEST] Iniciando prueba directa...');

    // Rango del mes actual
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    console.log('[RANKING-TEST] Rango:', { startDate, endDate });

    // Pipeline simplificado para probar
    const testPipeline = [
      // 1. Filtrar por fecha del mes actual
      {
        $match: {
          dia_venta: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      // 2. Solo documentos con agenteNombre válido
      {
        $match: {
          agenteNombre: { $exists: true, $ne: "", $ne: null }
        }
      },
      // 3. Agrupar por agente y sumar
      {
        $group: {
          _id: "$agenteNombre",
          ventas: { $sum: 1 },
          sumPuntaje: { $sum: "$puntaje" },
          avgPuntaje: { $avg: "$puntaje" },
          puntajes: { $push: "$puntaje" } // Para debug
        }
      },
      // 4. Ordenar por suma de puntaje
      {
        $sort: { sumPuntaje: -1, ventas: -1 }
      },
      // 5. Limitar a top 20
      {
        $limit: 20
      },
      // 6. Formato final
      {
        $project: {
          _id: 0,
          nombre: "$_id",
          ventas: 1,
          sumPuntaje: { $round: ["$sumPuntaje", 2] },
          avgPuntaje: { $round: ["$avgPuntaje", 2] },
          puntajes: 1
        }
      }
    ];

    console.log('[RANKING-TEST] Ejecutando pipeline en costumers...');
    const results = await db.collection('costumers').aggregate(testPipeline).toArray();
    
    console.log('[RANKING-TEST] Resultados:', results.length);
    
    // También obtener una muestra de documentos para verificar estructura
    const sampleDocs = await db.collection('costumers').find({
      dia_venta: { $gte: startDate, $lte: endDate },
      agenteNombre: { $exists: true, $ne: "" }
    }).limit(3).toArray();

    console.log('[RANKING-TEST] Muestra de documentos:', sampleDocs.length);

    res.json({
      success: true,
      message: 'Prueba de ranking completada',
      dateRange: { startDate, endDate },
      ranking: results,
      sampleDocs: sampleDocs.map(doc => ({
        agenteNombre: doc.agenteNombre,
        dia_venta: doc.dia_venta,
        puntaje: doc.puntaje,
        puntajeType: typeof doc.puntaje
      })),
      meta: {
        totalResults: results.length,
        sampleCount: sampleDocs.length
      }
    });

  } catch (error) {
    console.error('[RANKING-TEST] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error en prueba de ranking',
      error: error.message
    });
  }
});

module.exports = router;
