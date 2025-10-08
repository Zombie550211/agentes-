const { getDb } = require('../config/db');

// Utilidad: parsear fecha desde string
function parseDateInput(s) {
  if (!s) return null;
  try {
    const str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00.000Z');
    if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(str)) {
      const [d, m, y] = str.split(/[\/\-]/).map(Number);
      return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    }
    const d = new Date(str);
    return isNaN(d) ? null : d;
  } catch { return null; }
}

async function obtenerEstadisticasEquipos(req, res) {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });

    // Rango de fechas (por defecto: HOY)
    let { fechaInicio, fechaFin } = req.query || {};
    if (!fechaInicio && !fechaFin) {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      fechaInicio = todayStr;
      fechaFin = todayStr;
    }

    const start = parseDateInput(fechaInicio);
    const end = parseDateInput(fechaFin);
    const endOfDay = end ? new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1) : null;

    const costumers = db.collection('costumers');
    const pipeline = [];

    // Normalización previa
    pipeline.push({
      $addFields: {
        saleDateRaw: { $ifNull: ['$dia_venta', '$createdAt'] },
        teamNorm: { $toUpper: { $ifNull: ['$team', '$equipo', ''] } },
        mercadoNorm: { $toUpper: { $ifNull: ['$mercado', ''] } },
        puntajeNum: { $convert: { input: '$puntaje', to: 'double', onError: 0, onNull: 0 } }
      }
    });

    // Parseo de fecha a Date
    pipeline.push({
      $addFields: {
        saleDate: {
          $switch: {
            branches: [
              {
                // yyyy-mm-dd (con o sin hora)
                case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{4}-\d{2}-\d{2}/ } } ] },
                then: { $dateFromString: { dateString: '$saleDateRaw' } }
              },
              {
                // dd/mm/yyyy o dd-mm-yyyy
                case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{2}[\/\-]\d{2}[\/\-]\d{4}/ } } ] },
                then: { $dateFromString: { dateString: '$saleDateRaw', format: '%d/%m/%Y' } }
              }
            ],
            default: '$saleDateRaw'
          }
        },
        saleDateDate: { $cond: [ { $eq: [ { $type: '$saleDate' }, 'date' ] }, '$saleDate', { $toDate: '$saleDate' } ] }
      }
    });

    // Match por rango
    if (start || endOfDay) {
      const expr = { $and: [] };
      if (start) expr.$and.push({ $gte: ['$saleDateDate', start] });
      if (endOfDay) expr.$and.push({ $lte: ['$saleDateDate', endOfDay] });

      let startStr = null;
      try { if (start) startStr = new Date(start).toISOString().slice(0,10); } catch {}

      if (start && endOfDay && startStr) {
        pipeline.push({
          $match: {
            $or: [
              { $expr: expr },
              { $and: [ { $expr: { $eq: [ { $type: '$saleDateRaw' }, 'string' ] } }, { $expr: { $eq: [ '$saleDateRaw', startStr ] } } ] }
            ]
          }
        });
      } else {
        pipeline.push({ $match: { $expr: expr } });
      }
    }

    // Agrupar por team
    pipeline.push({
      $group: {
        _id: '$teamNorm',
        ICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, 1, 0 ] } },
        BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
        Total: { $sum: 1 },
        Puntaje: { $sum: '$puntajeNum' },
        PuntajeICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, '$puntajeNum', 0 ] } },
        PuntajeBAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, '$puntajeNum', 0 ] } }
      }
    });

    pipeline.push({ $project: { _id: 0, TEAM: '$_id', ICON: 1, BAMO: 1, Total: 1, Puntaje: 1, PuntajeICON: 1, PuntajeBAMO: 1 } });
    pipeline.push({ $sort: { TEAM: 1 } });

    const equiposCol = costumers;
    let equiposData = await equiposCol.aggregate(pipeline).toArray();

    // Fallback por string exacto si no hubo matches
    let total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
    if ((!equiposData || equiposData.length === 0) && start && endOfDay && (start.toDateString() === end.toDateString())) {
      try {
        const startStr = new Date(start).toISOString().slice(0,10);
        const docs = await equiposCol.find({ $or: [ { dia_venta: startStr }, { fecha_contratacion: startStr } ] }).toArray();
        if (docs && docs.length) {
          const map = new Map();
          for (const d of docs) {
            const teamKey = String(d.team || d.equipo || '').toUpperCase() || 'SIN EQUIPO';
            const mercadoKey = String(d.mercado || '').toUpperCase();
            const punt = Number(d.puntaje || 0);
            const obj = map.get(teamKey) || { TEAM: teamKey, ICON: 0, BAMO: 0, Total: 0, Puntaje: 0 };
            if (mercadoKey === 'ICON') obj.ICON += 1; else if (mercadoKey === 'BAMO') obj.BAMO += 1;
            obj.Total += 1; obj.Puntaje += punt; map.set(teamKey, obj);
          }
          equiposData = Array.from(map.values()).sort((a,b)=>a.TEAM.localeCompare(b.TEAM));
          total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
        }
      } catch(e){ console.warn('[EQUIPOS fallback] Error:', e?.message); }
    }

    // LINEAS
    const lineasCol = db.collection('Lineas');
    const lineasPipeline = [{ $addFields: { saleDate: { $ifNull: ['$dia_venta', '$creadoEn'] }, name: { $ifNull: ['$agenteNombre', { $ifNull: ['$agente', '$createdBy'] }] } } }];
    if (start || endOfDay) {
      const lm = {}; if (start) lm.$gte = start; if (endOfDay) lm.$lte = endOfDay;
      lineasPipeline.push({ $match: { saleDate: lm } });
    }
    lineasPipeline.push({ $group: { _id: '$name', ICON: { $sum: 1 } } });
    lineasPipeline.push({ $project: { _id: 0, name: '$_id', ICON: 1 } });
    lineasPipeline.push({ $sort: { name: 1 } });

    let lineas = [];
    try { lineas = await lineasCol.aggregate(lineasPipeline).toArray(); } catch { lineas = []; }

    return res.json({ success: true, message: 'Estadísticas calculadas', total, data: equiposData, lineas });
  } catch (error) {
    console.error('[EQUIPOS obtenerEstadisticasEquipos] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
}

async function obtenerListaEquipos(req, res){
  try {
    const db = getDb();
    const col = db.collection('costumers');
    const teams = await col.aggregate([
      { $addFields: { teamNorm: { $toUpper: { $ifNull: ['$team', '$equipo', ''] } } } },
      { $group: { _id: '$teamNorm' } },
      { $match: { _id: { $ne: '' } } },
      { $sort: { _id: 1 } }
    ]).toArray();
    res.json({ success:true, data: teams.map(t=>t._id), total: teams.length });
  } catch (e) {
    res.status(500).json({ success:false, message:'Error obteniendo lista de equipos', error:e.message });
  }
}

async function debugCostumers(req, res){
  try{
    const db = getDb();
    const col = db.collection('costumers');
    const sample = await col.find({}).sort({ _id: -1 }).limit(5).toArray();
    res.json({ success:true, sample });
  } catch(e){
    res.status(500).json({ success:false, message:'Error debug', error:e.message });
  }
}

module.exports = { obtenerEstadisticasEquipos, obtenerListaEquipos, debugCostumers };
