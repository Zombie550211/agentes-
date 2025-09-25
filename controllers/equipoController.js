const Lead = require('../models/Lead');
const Costumer = require('../models/Costumer');
const { connectToMongoDB, getDb } = require('../config/db');
const mongoose = require('mongoose');

/**
 * Obtiene estadísticas de equipos
 */
exports.obtenerEstadisticasEquipos = async (req, res) => {
  try {
    // Datos de prueba para cuando MongoDB no esté disponible
    const datosPrueba = [
      { TEAM: 'TEAM IRANIA', ICON: 8, BAMO: 7, Total: 15, Puntaje: 46.7 },
      { TEAM: 'TEAM ROBERTO VELASQUEZ', ICON: 12, BAMO: 11, Total: 23, Puntaje: 47.8 },
      { TEAM: 'TEAM BRYAN PLEITEZ', ICON: 9, BAMO: 9, Total: 18, Puntaje: 50.0 },
      { TEAM: 'TEAM MARISOL BELTRAN', ICON: 6, BAMO: 6, Total: 12, Puntaje: 50.0 },
      { TEAM: 'TEAM RANDAL MARTINEZ', ICON: 11, BAMO: 9, Total: 20, Puntaje: 45.0 },
      { TEAM: 'TEAM LINEA', ICON: 4, BAMO: 4, Total: 8, Puntaje: 50.0 }
    ];

    const lineasPrueba = [
      { name: 'JONATHAN', ICON: 2 },
      { name: 'DIEGO', ICON: 2 }
    ];

    // Rango de fechas: hoy por defecto, o por querystring (YYYY-MM-DD)
    const { fechaInicio, fechaFin } = req.query || {};
    // Obtener la fecha actual en la zona horaria de El Salvador (UTC-6) para evitar el corte a las 6 PM.
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' });
    const hoyStr = formatter.format(now);

    const startStr = (fechaInicio && String(fechaInicio).trim()) || hoyStr;
    const endStr = (fechaFin && String(fechaFin).trim()) || hoyStr;

    // Verificar si MongoDB está disponible
    let db;
    try {
      db = getDb();
      if (!db) db = await connectToMongoDB();
    } catch (error) {
      console.log('[EQUIPOS] MongoDB no disponible, usando datos de prueba');
      return res.json({
        success: true,
        message: 'Datos de prueba - MongoDB no disponible',
        total: datosPrueba.length,
        fechaInicio: startStr,
        fechaFin: endStr,
        data: datosPrueba,
        lineas: lineasPrueba,
        lineasTotalICON: 4,
        debugCount: { rawCount: datosPrueba.length, paddedCount: datosPrueba.length }
      });
    }

    // Asegurar conexión nativa a Mongo (reutilizar db ya obtenido)
    if (!db) {
      try {
        db = await connectToMongoDB();
      } catch (error) {
        console.log('[EQUIPOS] Error conectando a MongoDB en segunda intentona:', error.message);
        return res.json({
          success: true,
          message: 'Datos de prueba - Error de conexión MongoDB',
          total: datosPrueba.length,
          data: datosPrueba,
          lineas: lineasPrueba,
          debugCount: { rawCount: datosPrueba.length, paddedCount: datosPrueba.length }
        });
      }
    }

    // Usar la colección correcta 'costumers' como especificó el usuario
    const coll = db.collection('costumers');

    // Construir el $match dinámico para el rango de fechas
    // Construir el $match dinámico para el rango de fechas completo (agnóstico a la hora)
    // Construir el $match dinámico para el rango de fechas completo en UTC
    const matchStage = {
      $match: {
        dia_venta: startStr
      }
    };

    // Agregación por team, contando ICON/BAMO, Total y sumando puntaje (normalizando mercado a mayúsculas)
    const pipeline = [
      matchStage,
      // Normalizar campos para evitar fallos por espacios/caso
      {
        $addFields: {
          mercado_norm: {
            $toUpper: {
              $trim: { input: { $ifNull: ['$mercado', ''] } }
            }
          },
          team_norm: {
            $trim: {
              input: {
                $ifNull: [
                  '$team',
                  { $ifNull: ['$supervisor', ''] }
                ]
              }
            }
          },
          puntaje_num: {
            $toDouble: { $ifNull: ['$puntaje', 0] }
          }
        }
      },
      {
        $group: {
          _id: {
            $let: {
              vars: { t: { $trim: { input: { $ifNull: ['$team_norm', ''] } } } },
              in: { $cond: [ { $eq: ['$$t',''] }, 'Sin equipo', '$$t' ] }
            }
          },
          ICON: { $sum: { $cond: [{ $eq: ['$mercado_norm', 'ICON'] }, 1, 0] } },
          BAMO: { $sum: { $cond: [{ $eq: ['$mercado_norm', 'BAMO'] }, 1, 0] } },
          Total: { $sum: 1 },
          Puntaje: { $sum: '$puntaje_num' }
        }
      },
      { $sort: { Total: -1, _id: 1 } },
      {
        $project: {
          _id: 0,
          TEAM: '$_id',
          ICON: 1,
          BAMO: 1,
          Total: 1,
          Puntaje: { $round: ['$Puntaje', 2] }
        }
      }
    ];

    const data = await coll.aggregate(pipeline, { maxTimeMS: 30000 }).toArray();

    // Agregación específica para TEAM LINEA (desglose por supervisor, contando ICON)
    const lineaPipeline = [
      matchStage,
      { $match: { team: { $in: ['LINEA','linea','Lineas','LINEAS','team lineas','TEAM LINEA'] } } },
      {
        $group: {
          _id: { $toUpper: { $ifNull: ['$supervisor', 'SIN NOMBRE'] } },
          ICON: { $sum: { $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$mercado',''] } }, 'ICON'] }, 1, 0] } }
        }
      },
      { $project: { _id: 0, name: '$_id', ICON: 1 } },
      { $sort: { ICON: -1, name: 1 } }
    ];
    const lineasAgg = await coll.aggregate(lineaPipeline, { maxTimeMS: 30000 }).toArray();

    // Normalización y padding: asegurar los 6 equipos siempre presentes
    const normalizeTeam = (s) => {
      try {
        const up = String(s || '').toUpperCase().trim();
        return up.startsWith('TEAM ') ? up.slice(5).trim() : up;
      } catch { return ''; }
    };
    // Lista base en forma canónica (sin prefijo TEAM)
    // No incluir LINEA en la tabla principal
    const BASE_TEAMS = [
      'IRANIA',
      'ROBERTO VELASQUEZ',
      'BRYAN PLEITEZ',
      'MARISOL BELTRAN',
      'RANDAL MARTINEZ',
      'LINEA'
    ];
    // Alias conocidos desde la BD hacia los nombres base
    const ALIASES = new Map([
      ['IRANIA', 'IRANIA'],
      ['MARISOL', 'MARISOL BELTRAN'],
      ['ROBERTO', 'ROBERTO VELASQUEZ'],
      ['ROBERTO V', 'ROBERTO VELASQUEZ'],
      ['BRYAN', 'BRYAN PLEITEZ'],
      ['PLEITEZ', 'BRYAN PLEITEZ'],
      ['BRYAN P', 'BRYAN PLEITEZ'],
      ['BRYAN PLEITES', 'BRYAN PLEITEZ'],
      ['RANDAL', 'RANDAL MARTINEZ'],
      ['LINEAS', 'LINEA'],
      ['LINEA', 'LINEA']
    ]);
    const byKey = new Map();
    for (const r of (data || [])) {
      const rawK = normalizeTeam(r.TEAM);
      const k = ALIASES.get(rawK) || rawK;
      if (!k) continue;
      byKey.set(k, {
        TEAM: `TEAM ${k}`,
        ICON: Number(r.ICON || 0),
        BAMO: Number(r.BAMO || 0),
        Total: Number(r.Total || 0),
        Puntaje: Number(r.Puntaje || 0)
      });
    }
    const padded = BASE_TEAMS.map(k => byKey.get(k) || ({ TEAM: `TEAM ${k}`, ICON: 0, BAMO: 0, Total: 0, Puntaje: 0 }));
    const lineasTotalICON = (lineasAgg || []).reduce((s, r) => s + Number(r.ICON || 0), 0);

    // Encabezados de diagnóstico
    res.set('X-Equipos-Source', 'aggregate');
    res.set('X-Equipos-Coll', 'costumers');
    const payload = {
      success: true,
      message: `OK-MONGO-AGG PADDED-${padded.length} LINEAS-${lineasAgg.length}`,
      total: padded.length,
      fechaInicio: startStr,
      fechaFin: endStr,
      data: padded,
      lineas: lineasAgg,
      lineasTotalICON,
      debugCount: { rawCount: data.length, paddedCount: padded.length }
    };
    if (String(req.query?.debug || '').toLowerCase() === '1') {
      payload.dataRaw = data;
    }
    console.log('[equipos/estadisticas] counts => raw:', data.length, 'padded:', padded.length);
    return res.json(payload);
  } catch (error) {
    console.error('Error en obtenerEstadisticasEquipos:', error);
    res.set('X-Equipos-Source', 'error');
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas de equipos',
      error: error?.message || 'Unknown error'
    });
  }
};

/**
 * Debug: Información estática sin consultas
 */
exports.debugCostumers = async (req, res) => {
  res.json({
    success: true,
    debug: {
      message: 'Debug endpoint - sin consultas MongoDB',
      timestamp: new Date().toISOString(),
      status: 'OK'
    }
  });
};

/**
 * Obtiene los equipos únicos disponibles
 */
exports.obtenerListaEquipos = async (req, res) => {
  const equipos = [
    'TEAM IRANIA',
    'TEAM ROBERTO VELASQUEZ', 
    'TEAM BRYAN PLEITEZ',
    'TEAM MARISOL BELTRAN',
    'TEAM RANDAL MARTINEZ',
    'TEAM LINEA'
  ];
  
  res.json({
    success: true,
    data: equipos,
    total: equipos.length
  });
};
