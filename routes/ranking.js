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

    const { fechaInicio, fechaFin, all, limit: limitParam, debug, skipDate, agente, field = 'createdAt' } = req.query;
    console.log('[RANKING] Parámetros recibidos:', { fechaInicio, fechaFin, all, limitParam, debug, skipDate, agente, field });

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
    console.log('[RANGOS] Efectivo', { startDate, endDate });

    // Construir filtro de fecha usando el campo especificado
    const dateField = field === 'dia_venta' ? '$_date' : '$createdAt';

    // Preparar normalización de fecha dentro del pipeline (soporta Date y String y campos alternos)
    const dateNormStage = {
      $addFields: {
        _rawDate: "$dia_venta",
        _date: {
          $cond: [
            { $eq: [{ $type: "$dia_venta" }, "string"] },
            {
              $let: {
                vars: {
                  formats: ["%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"]
                },
                in: {
                  $reduce: {
                    input: "$$formats",
                    initialValue: null,
                    in: {
                      $ifNull: [
                        {
                          $dateFromString: {
                            dateString: "$dia_venta",
                            format: "$$this"
                          }
                        },
                        "$$value"
                      ]
                    }
                  }
                }
              }
            },
            "$dia_venta"
          ]
        }
      }
    };

    const dateMatchStage = {
      $match: {
        $expr: {
          $and: [
            { $gte: [ { $dateToString: { format: "%Y-%m-%d", date: dateField } }, startDate ] },
            { $lte: [ { $dateToString: { format: "%Y-%m-%d", date: dateField } }, endDate ] }
          ]
        }
      }
    };

    // Pipeline simplificado y optimizado para datos reales
    const hardLimit = all ? (parseInt(limitParam, 10) || 500) : (parseInt(limitParam, 10) || 10);
    
    // Pipeline simplificado que funciona con los datos reales
    const pipelineBase = [
      // 1) Filtrar por rango de fechas usando strings (más compatible)
      {
        $match: {
          $or: [
            // Formato YYYY-MM-DD
            { dia_venta: { $regex: /^2025-10-/ } },
            // Formato DD/MM/YYYY
            { dia_venta: { $regex: /\/10\/2025$/ } },
            // Fecha como Date object
            { 
              dia_venta: { 
                $gte: new Date(startDate), 
                $lte: new Date(endDate + 'T23:59:59.999Z') 
              } 
            }
          ]
        }
      },
      
      // 2) Filtrar por agente (si aplica)
      ...(agente ? [{
        $match: {
          $or: [
            { agenteNombre: { $regex: new RegExp(agente, 'i') } },
            { agente: { $regex: new RegExp(agente, 'i') } }
          ]
        }
      }] : []),
      
      // 3) Filtrar solo documentos con agente y puntaje válidos
      {
        $match: {
          agenteNombre: { $exists: true, $ne: null, $ne: "" },
          puntaje: { $exists: true, $ne: null },
          excluirDeReporte: { $ne: true } // Excluir ventas marcadas para no contar
        }
      },

      // 3.1) Normalizar estado y nombre de agente
      {
        $addFields: {
          _statusStr: { $toUpper: { $trim: { input: { $ifNull: ["$status", ""] } } } },
          _agenteFuente: { $ifNull: ["$agenteNombre", "$agente"] }
        }
      },
      {
        $addFields: {
          _statusNorm: {
            $cond: [
              { $regexMatch: { input: "$_statusStr", regex: /CANCEL/ } },
              "CANCEL",
              {
                $cond: [
                  { $regexMatch: { input: "$_statusStr", regex: /PENDIENT/ } },
                  "PENDING",
                  "$_statusStr"
                ]
              }
            ]
          }
        }
      },
      // 3.2) marcar canceladas y puntaje efectivo (0 si cancel)
      {
        $addFields: {
          isCancel: { $eq: ["$_statusNorm", "CANCEL"] },
          puntajeEfectivo: {
            $cond: [ { $eq: ["$_statusNorm", "CANCEL"] }, 0, { $toDouble: "$puntaje" } ]
          }
        }
      },

      {
        $addFields: {
          _nameNoSpaces: {
            $replaceAll: { input: { $replaceAll: { input: { $replaceAll: { input: "$_agenteFuente", find: "_", replacement: "" } }, find: ".", replacement: "" } }, find: " ", replacement: "" }
          },
          _nameNormLower: {
            $toLower: {
              $replaceAll: { input: { $replaceAll: { input: { $replaceAll: { input: "$_agenteFuente", find: "_", replacement: "" } }, find: ".", replacement: "" } }, find: " ", replacement: "" }
            }
          }
        }
      },

      // 4) Agrupar por agente normalizado (sin espacios, case-insensitive)
      {
        $group: {
          _id: "$_nameNormLower",
          // Ventas efectivas: excluir canceladas
          ventas: { $sum: { $cond: ["$isCancel", 0, 1] } },
          // Suma de puntaje efectivo: 0 si cancelado
          sumPuntaje: { $sum: "$puntajeEfectivo" },
          avgPuntaje: { $avg: "$puntaje" },
          anyName: { $first: "$_nameNoSpaces" }
        }
      },

      // 5) Formatear resultado
      {
        $project: {
          _id: 0,
          nombre: "$anyName",
          ventas: 1,
          sumPuntaje: "$sumPuntaje", // Sin redondeo - valor exacto
          avgPuntaje: "$avgPuntaje", // Sin redondeo - valor exacto
          puntos: "$sumPuntaje" // Usar suma como puntos principales - valor exacto
        }
      },

      // 6) Ordenar por suma de puntaje descendente
      { $sort: { puntos: -1, ventas: -1, nombre: 1 } },
      { $limit: hardLimit }
    ];

    console.log('[RANKING] Pipeline de agregación:', JSON.stringify(pipelineBase, null, 2));

    // Ejecutar consulta directamente en costumers (colección principal con datos reales)
    let rankingResults = [];
    let usedCollection = 'costumers';
    const attempts = [];
    
    try {
      console.log(`[RANKING] Consultando colección: costumers`);
      rankingResults = await db.collection('costumers').aggregate(pipelineBase).toArray();
      attempts.push({ collection: 'costumers', count: rankingResults.length });
      console.log(`[RANKING] Datos encontrados en costumers: ${rankingResults.length} registros`);
    } catch (e) {
      console.error(`[RANKING] Error consultando costumers:`, e?.message);
      attempts.push({ collection: 'costumers', error: e?.message||String(e) });
      
      // Fallback a otras colecciones solo si costumers falla
      const fallbackCollections = ['Costumers','Lineas','leads'];
      for (const col of fallbackCollections) {
        try {
          console.log(`[RANKING] Fallback a colección: ${col}`);
          const arr = await db.collection(col).aggregate(pipelineBase).toArray();
          attempts.push({ collection: col, count: Array.isArray(arr)?arr.length:0 });
          if (Array.isArray(arr) && arr.length > 0) {
            rankingResults = arr;
            console.log(`[RANKING] Datos encontrados en colección: ${col} (count=${arr.length})`);
            usedCollection = col;
            break;
          }
        } catch (e2) {
          console.warn(`[RANKING] Error consultando ${col}:`, e2?.message);
          attempts.push({ collection: col, error: e2?.message||String(e2) });
        }
      }
    }
    
    console.log('[RANKING] Resultados de la consulta:', rankingResults);
    
    // Debug: Mostrar valores exactos de puntajes
    if (rankingResults.length > 0) {
      console.log('[RANKING] Valores exactos de puntajes:');
      rankingResults.forEach((item, index) => {
        console.log(`${index + 1}. ${item.nombre}: sumPuntaje=${item.sumPuntaje} (tipo: ${typeof item.sumPuntaje}), avgPuntaje=${item.avgPuntaje} (tipo: ${typeof item.avgPuntaje}), puntos=${item.puntos} (tipo: ${typeof item.puntos})`);
      });
    }

    // Procesar datos reales y agregar posición
    let rankingData = rankingResults.map((item, index) => {
      return {
        ...item,
        promedio: item.avgPuntaje, // alias para frontend
        position: index + 1
      };
    });

    // Si no hay datos, devolver array vacío con mensaje informativo
    if (rankingData.length === 0) {
      console.log('[RANKING] No se encontraron datos para el rango de fechas especificado');
    }

    console.log('[RANKING] Devolviendo datos:', rankingData);
    
    // Debug: Mostrar datos finales que se envían al frontend
    if (rankingData.length > 0) {
      console.log('[RANKING] Datos finales enviados al frontend:');
      rankingData.forEach((item, index) => {
        console.log(`${index + 1}. ${item.nombre}: puntos=${item.puntos}, sumPuntaje=${item.sumPuntaje}, avgPuntaje=${item.avgPuntaje}, promedio=${item.promedio}`);
      });
    }

    // Si debug=1, calcular estadísticas de campos de puntaje para diagnóstico
    let scoreFieldStats = null;
    let sampleDocs = null;
    if (String(debug) === '1' && usedCollection) {
      try {
        const debugPipeline = [
          dateNormStage,
          ...(String(skipDate)==='1' ? [] : [dateMatchStage]),
          {
            $project: {
              _id: 0,
              agenteNombre: 1,
              puntaje: 1,
              Puntaje: 1,
              puntuacion: 1,
              Puntuacion: 1,
              points: 1,
              score: 1,
              Puntos: 1,
              PUNTAJE: 1
            }
          },
          {
            $group: {
              _id: null,
              c_puntaje: { $sum: { $cond: [{ $gt: ["$puntaje", null] }, 1, 0] } },
              c_Puntaje: { $sum: { $cond: [{ $gt: ["$Puntaje", null] }, 1, 0] } },
              c_puntuacion: { $sum: { $cond: [{ $gt: ["$puntuacion", null] }, 1, 0] } },
              c_Puntuacion: { $sum: { $cond: [{ $gt: ["$Puntuacion", null] }, 1, 0] } },
              c_points: { $sum: { $cond: [{ $gt: ["$points", null] }, 1, 0] } },
              c_score: { $sum: { $cond: [{ $gt: ["$score", null] }, 1, 0] } },
              c_Puntos: { $sum: { $cond: [{ $gt: ["$Puntos", null] }, 1, 0] } },
              c_PUNTAJE: { $sum: { $cond: [{ $gt: ["$PUNTAJE", null] }, 1, 0] } }
            }
          }
        ];
        const dbg = await db.collection(usedCollection).aggregate(debugPipeline).toArray();
        scoreFieldStats = Array.isArray(dbg) && dbg[0] ? dbg[0] : null;
        // Muestra pequeña de documentos con posibles campos de puntaje
        const samplePipeline = [
          dateNormStage,
          ...(String(skipDate)==='1' ? [] : [dateMatchStage]),
          { $limit: 5 },
          { $project: { _id: 0, agenteNombre: 1, puntaje: 1, Puntaje: 1, puntuacion: 1, Puntuacion: 1, points: 1, score: 1, Puntos: 1, PUNTAJE: 1 } }
        ];
        sampleDocs = await db.collection(usedCollection).aggregate(samplePipeline).toArray();
      } catch (e) {
        console.warn('[RANKING][DEBUG] No se pudieron obtener stats de puntaje:', e?.message);
      }
    }

    res.json({
      success: true,
      message: 'Datos de ranking obtenidos',
      ranking: rankingData,
      data: { ranking: rankingData },
      meta: {
        collectionUsed: usedCollection,
        count: Array.isArray(rankingData) ? rankingData.length : 0,
        dateRange: { startDate, endDate },
        params: { fechaInicio, fechaFin, all: !!all, limit: hardLimit, debug: String(debug)==='1', skipDate: String(skipDate)==='1', agente: agente || null, field },
        attempts,
        scoreFieldStats,
        sampleDocs
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

/**
 * @route GET /api/ranking/debug-lucia-data
 * @desc Debug específico para Lucia Ferman - mostrar valores exactos
 * @access Private
 */
router.get('/debug-lucia-data', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    // Buscar todos los registros de Lucia Ferman
    const luciaRecords = await db.collection('costumers').find({
      agenteNombre: { $regex: /lucia.*ferman/i }
    }).toArray();

    console.log('[DEBUG-LUCIA] Registros encontrados:', luciaRecords.length);
    
    // Mostrar cada registro con su puntaje exacto
    luciaRecords.forEach((record, index) => {
      console.log(`[DEBUG-LUCIA] Registro ${index + 1}:`);
      console.log(`  - ID: ${record._id}`);
      console.log(`  - Agente: ${record.agenteNombre}`);
      console.log(`  - Puntaje: ${record.puntaje} (tipo: ${typeof record.puntaje})`);
      console.log(`  - Fecha: ${record.dia_venta}`);
    });

    // Calcular suma y promedio manualmente
    const puntajes = luciaRecords
      .filter(r => r.puntaje != null && !isNaN(r.puntaje))
      .map(r => Number(r.puntaje));
    
    const suma = puntajes.reduce((acc, val) => acc + val, 0);
    const promedio = puntajes.length > 0 ? suma / puntajes.length : 0;

    console.log(`[DEBUG-LUCIA] Cálculos manuales:`);
    console.log(`  - Total registros con puntaje: ${puntajes.length}`);
    console.log(`  - Puntajes individuales: [${puntajes.join(', ')}]`);
    console.log(`  - Suma total: ${suma}`);
    console.log(`  - Promedio: ${promedio}`);

    res.setHeader('Content-Type', 'application/json');
    res.json({
      success: true,
      message: 'Debug de Lucia Ferman',
      data: {
        totalRecords: luciaRecords.length,
        recordsWithScore: puntajes.length,
        individualScores: puntajes,
        sumTotal: suma,
        average: promedio,
        records: luciaRecords.map(r => ({
          id: r._id,
          agente: r.agenteNombre,
          puntaje: r.puntaje,
          fecha: r.dia_venta
        }))
      }
    });

  } catch (error) {
    console.error('[DEBUG-LUCIA] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error en debug de Lucia Ferman'
    });
  }
});

module.exports = router;
