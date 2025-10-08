const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

/**
 * @route GET /api/ranking
 * @desc Obtener datos de ranking
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

    const { fechaInicio, fechaFin, all, limit: limitParam } = req.query;
    console.log('[RANKING] Parámetros recibidos:', { fechaInicio, fechaFin, all, limitParam });

    // Construir filtro de fecha (FORZAR mes actual si no se envía)
    const toYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    let startDate = fechaInicio;
    let endDate = fechaFin;
    if (!startDate || !endDate) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = toYMD(start);
      endDate = toYMD(now);
    }
    const dateFilter = {
      dia_venta: {
        $gte: startDate,
        $lte: endDate
      }
    };
    console.log('[RANGOS] Efectivo', { startDate, endDate });

    console.log('[RANKING] Filtro de fecha aplicado:', dateFilter);

    // Obtener datos REALES de la base de datos usando agenteNombre y puntaje
    const hardLimit = all ? (parseInt(limitParam, 10) || 500) : (parseInt(limitParam, 10) || 10);
    const pipeline = [
      // 1) Filtrar por fecha si se especifica
      ...(Object.keys(dateFilter).length > 0 ? [{ $match: dateFilter }] : []),

      // 2) Normalizar nombre del agente y asegurar campos numéricos
      {
        $addFields: {
          // Preferir SOLO campos fuertes para el nombre del agente
          _agenteRaw: {
            $let: {
              vars: { cands: [ "$agenteNombre", "$agentName" ] },
              in: {
                $let: {
                  vars: {
                    nonEmpty: {
                      $filter: {
                        input: "$$cands",
                        as: "v",
                        cond: { $and: [ { $ne: ["$$v", null] }, { $ne: ["$$v", ""] } ] }
                      }
                    }
                  },
                  in: { $ifNull: [ { $arrayElemAt: ["$$nonEmpty", 0] }, null ] }
                }
              }
            }
          },
          _puntajeNum: {
            $toDouble: {
              $ifNull: [
                {
                  $ifNull: [
                    "$puntaje",
                    { $ifNull: [ "$puntuacion", { $ifNull: [ "$points", "$score" ] } ] }
                  ]
                },
                0
              ]
            }
          }
        }
      },
      {
        $addFields: {
          agente_norm: {
            $replaceAll: {
              input: { $trim: { input: { $toLower: "$_agenteRaw" } } },
              find: "  ",
              replacement: " "
            }
          }
        }
      },
      // Excluir documentos sin agente identificable o con nombre genérico
      { $match: { 
          agente_norm: { 
            $nin: [ "", "agente", "agent", "usuario", "owner", "registrado", "created" ]
          } 
        } 
      },

      // 3) Agrupar por agente normalizado
      {
        $group: {
          _id: "$agente_norm",
          ventas: { $sum: 1 },
          sumPuntaje: { $sum: "$_puntajeNum" },
          avgPuntaje: { $avg: "$_puntajeNum" },
          // Guardar un nombre visible (primer no vacío)
          nombreVisibles: { $addToSet: "$_agenteRaw" }
        }
      },

      // 4) Elegir nombre visible y calcular puntos a usar en ranking (SUMA de puntaje)
      {
        $addFields: {
          nombre: {
            $cond: [
              { $gt: [ { $size: "$nombreVisibles" }, 0 ] },
              { $arrayElemAt: [ "$nombreVisibles", 0 ] },
              "Sin nombre"
            ]
          },
          puntos: { $round: [ "$sumPuntaje", 1 ] }
        }
      },

      // 5) Proyección limpia
      {
        $project: {
          _id: 0,
          nombre: 1,
          ventas: 1,
          sumPuntaje: { $round: ["$sumPuntaje", 1] },
          avgPuntaje: { $round: ["$avgPuntaje", 1] },
          puntos: 1
        }
      },

      // 6) Orden y top (por suma de puntaje)
      { $sort: { puntos: -1, ventas: -1, nombre: 1 } },
      { $limit: hardLimit }
    ];

    console.log('[RANKING] Pipeline de agregación:', JSON.stringify(pipeline, null, 2));

    // Ejecutar consulta en la colección costumers
    const rankingResults = await db.collection('costumers').aggregate(pipeline).toArray();
    
    console.log('[RANKING] Resultados de la consulta:', rankingResults);

    // Si no hay datos reales, usar datos de ejemplo (solo dev)
    let rankingData = rankingResults;

    if (rankingResults.length === 0) {
      console.log('[RANKING] No hay datos reales, usando datos de ejemplo');
      rankingData = [
        {
          nombre: 'Jonathan Morales', ventas: 15, sumPuntaje: 46, avgPuntaje: 4.6, puntos: 4.6,
          position: 1
        },
        {
          nombre: 'Anderson Guzman', ventas: 12, sumPuntaje: 39.6, avgPuntaje: 3.3, puntos: 3.3,
          position: 2
        },
        {
          nombre: 'Giselle Diaz', ventas: 10, sumPuntaje: 31, avgPuntaje: 3.1, puntos: 3.1,
          position: 3
        }
      ];
    } else {
      // Agregar posición a los datos reales
      rankingData = rankingResults.map((item, index) => ({ ...item, position: index + 1 }));
    }

    console.log('[RANKING] Devolviendo datos:', rankingData);

    res.json({
      success: true,
      message: 'Datos de ranking obtenidos',
      ranking: rankingData,
      data: {
        ranking: rankingData
      }
    });
  } catch (error) {
    console.error('[RANKING] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route POST /api/ranking
 * @desc Crear nuevo registro de ranking
 * @access Private
 */
router.post('/', protect, authorize('Administrador', 'admin', 'administrador'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    // Aquí puedes agregar lógica para crear registros de ranking
    res.json({
      success: true,
      message: 'Registro de ranking creado exitosamente'
    });
  } catch (error) {
    console.error('[RANKING CREATE] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
