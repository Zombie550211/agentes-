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
    
    // Preparar patrones y listas dinámicas por MES para strings de fecha
    // Importante: NO usar new Date('YYYY-MM-DD') porque interpreta en UTC y puede retroceder un mes en TZ -06:00.
    const [sY, sM] = String(startDate).split('-');
    const targetYear = parseInt(sY, 10);
    const targetMonthIndex = parseInt(sM, 10) - 1; // 0=Ene, 10=Nov
    const targetMonthPadded = String(targetMonthIndex + 1).padStart(2, '0');
    const targetMonthNoPad = String(targetMonthIndex + 1);
    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthAbbr = MONTH_ABBR[targetMonthIndex];
    const prevMonthIdx = (targetMonthIndex + 11) % 12;
    const nextMonthIdx = (targetMonthIndex + 1) % 12;
    const prevYear = targetMonthIndex === 0 ? (targetYear - 1) : targetYear;
    const nextYear = targetMonthIndex === 11 ? (targetYear + 1) : targetYear;
    const prevMonthPadded = String(prevMonthIdx + 1).padStart(2, '0');
    const nextMonthPadded = String(nextMonthIdx + 1).padStart(2, '0');
    const prevAbbr = MONTH_ABBR[prevMonthIdx];
    const nextAbbr = MONTH_ABBR[nextMonthIdx];
    // Generar todos los días del mes: YYYY-MM-DD y variantes D/M/YYYY
    const allowedYMD = [];
    const allowedDMY = [];        // d/m/yyyy (sin padding)
    const allowedDMY_DDMM = [];   // dd/mm/yyyy (ambos con padding)
    const allowedDMY_DDM = [];    // dd/m/yyyy (día padded, mes sin padding)
    const allowedDMY_DMM = [];    // d/mm/yyyy (día sin padding, mes padded)
    const regexMonthNames = [];
    {
      const firstDay = new Date(targetYear, targetMonthIndex, 1);
      const lastDay = new Date(targetYear, targetMonthIndex + 1, 0);
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const mNoPad = String(d.getMonth() + 1);
        const dd = String(d.getDate()).padStart(2, '0');
        const dNoPad = String(d.getDate());
        allowedYMD.push(`${y}-${m}-${dd}`);
        // Variantes D/M/YYYY
        allowedDMY.push(`${dNoPad}/${mNoPad}/${y}`); // d/m/yyyy
        allowedDMY_DDMM.push(`${dd}/${m}/${y}`);     // dd/mm/yyyy
        allowedDMY_DDM.push(`${dd}/${mNoPad}/${y}`); // dd/m/yyyy
        allowedDMY_DMM.push(`${dNoPad}/${m}/${y}`);  // d/mm/yyyy
        // Regex para cadenas tipo Date: ^.*\bMonAbbr\b\s+DD\s+YYYY
        const dayRegex = new RegExp(`^.*\\b${monthAbbr}\\b\\s+${d.getDate()}\\s+${y}`, 'i');
        regexMonthNames.push(dayRegex);
      }
    }
    // Regex amplios por mes (fallback por si hay variantes de espaciado)
    const regexYMD = new RegExp(`^${targetYear}-${targetMonthPadded}-`);
    const regexDMYPad = new RegExp(`\\/${targetMonthPadded}\\/${targetYear}$`);
    const regexDMYNoPad = new RegExp(`\\/${targetMonthNoPad}\\/${targetYear}$`);

    // Fechas de corte (rango cerrado-abierto) del mes objetivo
    const startOfMonth = new Date(targetYear, targetMonthIndex, 1);
    const startOfNextMonth = new Date(targetYear, targetMonthIndex + 1, 1);

    // Pipeline simplificado que funciona con los datos reales
    const useCreatedAt = String(field).toLowerCase() === 'createdat';
    const pipelineBase = [
      // 0-pre) Si el cliente pide field=createdAt, usarlo directamente como base de fecha
      ...(useCreatedAt ? [{
        $addFields: {
          _diaParsed: {
            $cond: [
              { $eq: [ { $type: "$createdAt" }, "date" ] }, "$createdAt",
              { $cond: [
                { $eq: [ { $type: "$createdAt" }, "string" ] },
                { $dateFromString: { dateString: { $toString: "$createdAt" }, timezone: "-06:00" } },
                null
              ]}
            ]
          }
        }
      }] : []),
      // 0) Normalizar dia_venta a Date en _diaParsed (robusto por formato)
      {
        $addFields: {
          _diaParsed: {
            $cond: [
              { $eq: [ { $type: "$dia_venta" }, "date" ] },
              "$dia_venta",
              {
                $let: { vars: { s: { $toString: "$dia_venta" } }, in: {
                  $cond: [
                    // ISO YYYY-MM-DD
                    { $regexMatch: { input: "$$s", regex: /^\d{4}-\d{2}-\d{2}$/ } },
                    { $dateFromString: { dateString: "$$s", format: "%Y-%m-%d", timezone: "-06:00" } },
                    {
                      $cond: [
                        // D/M/YYYY o DD/MM/YYYY -> usar split + dateFromParts
                        { $regexMatch: { input: "$$s", regex: /^\d{1,2}\/\d{1,2}\/\d{4}$/ } },
                        { $let: { vars: { parts: { $split: ["$$s", "/"] } }, in: {
                          $dateFromParts: {
                            year: { $toInt: { $arrayElemAt: ["$$parts", 2] } },
                            month: { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                            day: { $toInt: { $arrayElemAt: ["$$parts", 0] } }
                          }
                        }}},
                        {
                          $cond: [
                            // Nombre de mes inglés (con o sin día 0-pad). Dejar que el parser deduzca.
                            { $regexMatch: { input: "$$s", regex: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b\s+\d{1,2}\s+\d{4}/i } },
                            { $dateFromString: { dateString: "$$s", timezone: "-06:00" } },
                            // Último recurso: intentar parseo libre; si falla, null
                            { $dateFromString: { dateString: "$$s", timezone: "-06:00" } }
                          ]
                        }
                      ]
                    }
                  ]
                }}
              }
            ]
          }
        }
      },
      // 0.1) Fallback adicional: si _diaParsed sigue null y dia_venta es d/m/yyyy (sin padding), parsear con split + dateFromParts
      {
        $addFields: {
          _diaParsed: {
            $cond: [
              { $ne: ["$_diaParsed", null] },
              "$_diaParsed",
              {
                $let: {
                  vars: { s: { $toString: "$dia_venta" } },
                  in: {
                    $cond: [
                      { $regexMatch: { input: "$$s", regex: /^\d{1,2}\/\d{1,2}\/\d{4}$/ } },
                      {
                        $let: {
                          vars: { parts: { $split: ["$$s", "/"] } },
                          in: {
                            $dateFromParts: {
                              year: { $toInt: { $arrayElemAt: ["$$parts", 2] } },
                              month: { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                              day: { $toInt: { $arrayElemAt: ["$$parts", 0] } }
                            }
                          }
                        }
                      },
                      null
                    ] 
                  }
                }
              }
            ]
          }
        }
      },
      // 0.2) Fallback final: usar createdAt cuando dia_venta no existe/no parsea
      {
        $addFields: {
          _diaParsed: {
            $cond: [
              { $ne: ["$_diaParsed", null] },
              "$_diaParsed",
              {
                $cond: [
                  { $eq: [ { $type: "$createdAt" }, "date" ] },
                  "$createdAt",
                  {
                    $cond: [
                      { $eq: [ { $type: "$createdAt" }, "string" ] },
                      { $dateFromString: { dateString: { $toString: "$createdAt" }, timezone: "-06:00" } },
                      null
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      // 1) Filtrar por rango del mes objetivo usando _diaParsed (>= inicioMes y < inicioMesSiguiente)
      {
        $match: {
          _diaParsed: { $ne: null },
          $expr: { $and: [
            { $gte: [ "$_diaParsed", startOfMonth ] },
            { $lt:  [ "$_diaParsed", startOfNextMonth ] }
          ]}
        }
      },
      // 1.1) Eliminado: la barrera anti-colados por regex en dia_venta podía excluir válidos cuando usamos createdAt
      
      // 2) Filtrar por agente (si aplica)
      ...(agente ? [{
        $match: {
          $or: [
            { agenteNombre: { $regex: new RegExp(agente, 'i') } },
            { agente: { $regex: new RegExp(agente, 'i') } }
          ]
        }
      }] : []),
      
      // 3) Filtrar solo documentos con agente válido (puntaje puede faltar)
      {
        $match: {
          $or: [
            { agenteNombre: { $exists: true, $ne: null, $ne: "" } },
            { agente: { $exists: true, $ne: null, $ne: "" } }
          ],
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
            $cond: [
              { $eq: ["$_statusNorm", "CANCEL"] },
              0,
              { $toDouble: { $ifNull: [ "$puntaje", 0 ] } }
            ]
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
    const matchStageDiaVenta = pipelineBase[0];

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

    // Si debug=1, obtener muestra de registros que pasaron el filtro por dia_venta
    let matchedSamples = null;
    if (String(debug) === '1') {
      try {
        const debugArr = await db.collection(usedCollection).aggregate([
          matchStageDiaVenta,
          { $project: { _id: 0, dia_venta: 1, agenteNombre: 1, status: 1, puntaje: 1 } },
          { $limit: 25 }
        ]).toArray();
        matchedSamples = debugArr;
      } catch (e) {
        console.warn('[RANKING][DEBUG] No se pudo obtener muestra de dia_venta:', e?.message);
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
        monthFilter: {
          targetYear,
          targetMonthIndex,
          targetMonthPadded,
          allowedYMDCount: allowedYMD.length,
          allowedDMYCount: allowedDMY.length
        },
        attempts,
        scoreFieldStats,
        sampleDocs,
        matchedSamples
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
