const { getDb, connectToMongoDB } = require('../config/db');

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
    let db = getDb();
    if (!db) {
      try {
        db = await connectToMongoDB();
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
      }
    }

    // Rango de fechas (por defecto: MES ACTUAL)
    let { fechaInicio, fechaFin, scope, all } = req.query || {};
    if (!fechaInicio || !fechaFin) {
      const now = new Date();
      const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const yyyyS = startMonth.getUTCFullYear();
      const mmS = String(startMonth.getUTCMonth() + 1).padStart(2, '0');
      const ddS = String(startMonth.getUTCDate()).padStart(2, '0');
      const yyyyE = now.getUTCFullYear();
      const mmE = String(now.getUTCMonth() + 1).padStart(2, '0');
      const ddE = String(now.getUTCDate()).padStart(2, '0');
      fechaInicio = `${yyyyS}-${mmS}-${ddS}`;
      fechaFin = `${yyyyE}-${mmE}-${ddE}`;
      if (scope === 'day') {
        // Si se pide explícitamente día
        fechaInicio = `${yyyyE}-${mmE}-${ddE}`;
        fechaFin = `${yyyyE}-${mmE}-${ddE}`;
      }
    }

    const start = parseDateInput(fechaInicio);
    const end = parseDateInput(fechaFin);
    const endOfDay = end ? new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1) : null;

    const pipeline = [];

    // Si piden SOLO el día (scope=day o fechaInicio==fechaFin), aplicar match directo por strings
    const isDayOnly = (scope === 'day') || (fechaInicio && fechaFin && fechaInicio === fechaFin);
    if (isDayOnly && start) {
      try {
        const d = new Date(start);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const sYMD = `${y}-${m}-${dd}`;      // YYYY-MM-DD
        const sDMY = `${dd}/${m}/${y}`;      // DD/MM/YYYY
        const sDMYDash = `${dd}-${m}-${y}`;  // DD-MM-YYYY
        pipeline.push({ $match: { $or: [
          { dia_venta: { $in: [sYMD, sDMY, sDMYDash] } },
          { fecha_contratacion: { $in: [sYMD, sDMY, sDMYDash] } }
        ] } });
      } catch {}
    }

    // Normalización previa (fechas y puntaje desde múltiples campos)
    pipeline.push({
      $addFields: {
        saleDateRaw: {
          $ifNull: [
            '$dia_venta',
            { $ifNull: [ '$fecha_contratacion', { $ifNull: [ '$createdAt', { $ifNull: [ '$fecha', '$creadoEn' ] } ] } ] }
          ]
        },
        teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$team', '$equipo', ''] } } } },
        mercadoNorm: { $toUpper: { $ifNull: ['$mercado', ''] } },
        puntajeNum: {
          $convert: {
            input: { $ifNull: [ '$puntaje', { $ifNull: [ '$puntuacion', { $ifNull: [ '$points', '$score' ] } ] } ] },
            to: 'double', onError: 0, onNull: 0
          }
        }
      }
    });

    // Parseo de fecha a Date (soporta Date, yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy)
    pipeline.push({
      $addFields: {   
        saleDate: {
          $switch: {
            branches: [
              { case: { $eq: [ { $type: '$saleDateRaw' }, 'date' ] }, then: '$saleDateRaw' },
              { case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{4}-\d{2}-\d{2}/ } } ] }, then: { $dateFromString: { dateString: '$saleDateRaw' } } },
              { case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{2}\/\d{2}\/\d{4}/ } } ] }, then: { $dateFromString: { dateString: '$saleDateRaw', format: '%d/%m/%Y' } } },
              { case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{2}-\d{2}-\d{4}/ } } ] }, then: { $dateFromString: { dateString: '$saleDateRaw', format: '%d-%m-%Y' } } }
            ],
            default: '$saleDateRaw'
          }
        },
        saleDateDate: { $cond: [ { $eq: [ { $type: '$saleDate' }, 'date' ] }, '$saleDate', { $toDate: '$saleDate' } ] }
      }
    });

    // Match por rango/día (con límites locales y soporte string)
    if (String(all).trim() !== '1' && (start || endOfDay)) {
      const sameDay = !!(start && end && start.toDateString() === end.toDateString());
      // Límites locales (00:00:00 a 24:00:00 del día solicitado)
      const sLocal = start ? new Date(new Date(start).setHours(0,0,0,0)) : null;
      const eLocal = end ? new Date(new Date(end).setHours(23,59,59,999)) : null;
      let sYMD = null, sDMY = null, sDMYDash = null;
      try {
        if (start) {
          const d = new Date(start);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          sYMD = `${y}-${m}-${dd}`;      // YYYY-MM-DD
          sDMY = `${dd}/${m}/${y}`;      // DD/MM/YYYY
          sDMYDash = `${dd}-${m}-${y}`;  // DD-MM-YYYY
        }
      } catch {}

      if (sameDay && sLocal && eLocal) {
        pipeline.push({
          $match: {
            $or: [
              // Por tipo Date en rango local
              { $expr: { $and: [ { $gte: ['$saleDateDate', sLocal] }, { $lte: ['$saleDateDate', eLocal] } ] } },
              // Por string crudo exacto
              { saleDateRaw: { $in: [ sYMD, sDMY, sDMYDash ] } }
            ]
          }
        });
      } else {
        const expr = { $and: [] };
        if (sLocal) expr.$and.push({ $gte: ['$saleDateDate', sLocal] });
        if (eLocal) expr.$and.push({ $lte: ['$saleDateDate', eLocal] });
        if (expr.$and.length) pipeline.push({ $match: { $expr: expr } });
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

    // Intentar múltiples colecciones posibles
    const collectionsToTry = ['costumers','Costumers','customers','leads','Leads','ventas'];
    let equiposData = [];
    let usedCollection = null;
    for (const colName of collectionsToTry) {
      try {
        const arr = await db.collection(colName).aggregate(pipeline).toArray();
        if (arr && arr.length >= 0) { // aceptamos 0 también para seguir el fallback abajo
          equiposData = arr;
          usedCollection = colName;
          break;
        }
      } catch (e) {
        // continuar
      }
    }

    // Fallback por string exacto si no hubo matches
    let total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
    if ((!equiposData || equiposData.length === 0) && start && endOfDay && (start.toDateString() === end.toDateString())) {
      try {
        const startStr = new Date(start).toISOString().slice(0,10);
        const col = usedCollection ? db.collection(usedCollection) : db.collection('costumers');
        const docs = await col.find({ $or: [ { dia_venta: startStr }, { fecha_contratacion: startStr } ] }).toArray();
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

    // Fallback adicional: si sigue vacío en día exacto, reintentar con rango del MES ACTUAL
    const sameDayFinal = !!(start && end && start.toDateString() === end.toDateString());
    if ((scope === 'day' || sameDayFinal) && (!equiposData || equiposData.length === 0)) {
      try {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const ms = monthStart;
        const me = new Date();
        const pipelineMonth = [
          { $addFields: {
              saleDateRaw: { $ifNull: ['$dia_venta', { $ifNull: ['$fecha_contratacion', { $ifNull: ['$createdAt', { $ifNull: ['$fecha', '$creadoEn'] } ] } ] } ] },
              teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$team', '$equipo', ''] } } } },
              mercadoNorm: { $toUpper: { $ifNull: ['$mercado', ''] } },
              puntajeNum: { $convert: { input: { $ifNull: ['$puntaje', { $ifNull: ['$puntuacion', { $ifNull: ['$points', '$score'] } ] } ] }, to: 'double', onError: 0, onNull: 0 } },
              saleDate: {
                $switch: {
                  branches: [
                    { case: { $eq: [ { $type: '$saleDateRaw' }, 'date' ] }, then: '$saleDateRaw' },
                    { case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{4}-\d{2}-\d{2}/ } } ] }, then: { $dateFromString: { dateString: '$saleDateRaw' } } },
                    { case: { $and: [ { $eq: [ { $type: '$saleDateRaw' }, 'string' ] }, { $regexMatch: { input: '$saleDateRaw', regex: /^\d{2}[\/\-]\d{2}[\/\-]\d{4}/ } } ] }, then: { $dateFromString: { dateString: '$saleDateRaw', format: '%d/%m/%Y' } } }
                  ],
                  default: '$saleDateRaw'
                }
              },
              saleDateDate: { $cond: [ { $eq: [ { $type: '$saleDate' }, 'date' ] }, '$saleDate', { $toDate: '$saleDate' } ] }
          }},
          { $match: { $expr: { $and: [ { $gte: ['$saleDateDate', ms] }, { $lte: ['$saleDateDate', me] } ] } } },
          { $group: {
            _id: '$teamNorm',
            ICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, 1, 0 ] } },
            BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
            Total: { $sum: 1 },
            Puntaje: { $sum: '$puntajeNum' }
          }},
          { $project: { _id: 0, TEAM: '$_id', ICON: 1, BAMO: 1, Total: 1, Puntaje: 1 } },
          { $sort: { TEAM: 1 } }
        ];

        let monthData = [];
        for (const colName of ['costumers','Costumers','customers','leads','Leads','ventas']) {
          try {
            const arr = await db.collection(colName).aggregate(pipelineMonth).toArray();
            if (Array.isArray(arr) && arr.length >= 0) { monthData = arr; usedCollection = colName; break; }
          } catch {}
        }
        if (monthData.length) {
          equiposData = monthData;
          total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
        }
      } catch (e) { console.warn('[EQUIPOS fallback-month] Error:', e?.message); }
    }

    // LINEAS como team agregado
    const lineasCol = db.collection('Lineas');
    const lineasPipeline = [
      { $addFields: {
          saleDateRaw: { $ifNull: ['$dia_venta', '$creadoEn'] },
          saleDate: { $cond: [ { $eq: [ { $type: '$dia_venta' }, 'string' ] }, { $dateFromString: { dateString: '$dia_venta' } }, { $ifNull: ['$dia_venta', '$creadoEn'] } ] },
          teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$team', 'TEAM LINEAS'] } } } },
          mercadoNorm: { $toUpper: { $ifNull: ['$mercado', '' ] } },
          puntajeNum: { $convert: { input: '$puntaje', to: 'double', onError: 0, onNull: 0 } }
      } }
    ];
    if (String(all).trim() !== '1' && (start || endOfDay)) {
      const sameDay = !!(start && end && start.toDateString() === end.toDateString());
      const sLocal = start ? new Date(new Date(start).setHours(0,0,0,0)) : null;
      const eLocal = end ? new Date(new Date(end).setHours(23,59,59,999)) : null;
      let sYMD = null, sDMY = null, sDMYDash = null;
      try {
        if (start) {
          const d = new Date(start);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          sYMD = `${y}-${m}-${dd}`;
          sDMY = `${dd}/${m}/${y}`;
          sDMYDash = `${dd}-${m}-${y}`;
        }
      } catch {}
      if (sameDay && sLocal && eLocal) {
        lineasPipeline.push({
          $match: {
            $or: [
              { $expr: { $and: [ { $gte: ['$saleDate', sLocal] }, { $lte: ['$saleDate', eLocal] } ] } },
              { dia_venta: { $in: [ sYMD, sDMY, sDMYDash ] } }
            ]
          }
        });
      } else {
        const lm = {}; if (sLocal) lm.$gte = sLocal; if (eLocal) lm.$lte = eLocal;
        if (Object.keys(lm).length) lineasPipeline.push({ $match: { saleDate: lm } });
      }
    }
    lineasPipeline.push({ $group: {
      _id: '$teamNorm',
      ICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, 1, 0 ] } },
      BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
      Total: { $sum: 1 },
      Puntaje: { $sum: '$puntajeNum' }
    } });
    lineasPipeline.push({ $project: { _id: 0, TEAM: '$_id', ICON: 1, BAMO: 1, Total: 1, Puntaje: 1 } });

    let lineasTeams = [];
    try { lineasTeams = await lineasCol.aggregate(lineasPipeline).toArray(); } catch { lineasTeams = []; }

    // Fusionar resultado de Lineas en equiposData (como otro team)
    if (Array.isArray(lineasTeams) && lineasTeams.length) {
      // Si ya existe TEAM LINEAS en equiposData, sumar
      const map = new Map(equiposData.map(e => [e.TEAM, { ...e }]));
      for (const lt of lineasTeams) {
        if (map.has(lt.TEAM)) {
          const cur = map.get(lt.TEAM);
          cur.ICON = (cur.ICON || 0) + (lt.ICON || 0);
          cur.BAMO = (cur.BAMO || 0) + (lt.BAMO || 0);
          cur.Total = (cur.Total || 0) + (lt.Total || 0);
          cur.Puntaje = (cur.Puntaje || 0) + (lt.Puntaje || 0);
          map.set(lt.TEAM, cur);
        } else {
          map.set(lt.TEAM, lt);
        }
      }
      equiposData = Array.from(map.values()).sort((a,b)=>a.TEAM.localeCompare(b.TEAM));
      total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
    }

    // Asegurar que aparezcan todos los equipos, incluso con valores en cero
    try {
      // 1) Unificar equipos por nombre base (quita prefijo 'TEAM' y toma la primera palabra)
      const baseName = (s) => {
        try {
          if (!s) return '';
          let v = String(s).toUpperCase().trim();
          if (v.startsWith('TEAM ')) v = v.slice(5).trim();
          const first = v.split(/\s+/)[0] || '';
          return first;
        } catch { return ''; }
      };
      const merged = new Map();
      for (const r of (equiposData || [])) {
        const key = baseName(r.TEAM);
        const cur = merged.get(key) || { TEAM: key, ICON: 0, BAMO: 0, Total: 0, Puntaje: 0 };
        cur.ICON += Number(r.ICON || 0);
        cur.BAMO += Number(r.BAMO || 0);
        cur.Total += Number(r.Total || 0);
        cur.Puntaje += Number(r.Puntaje || 0);
        merged.set(key, cur);
      }
      equiposData = Array.from(merged.values());

      // 2) Construir lista completa de equipos conocidos desde todas las colecciones
      const potentialCollections = ['costumers','Costumers','customers','leads','Leads','ventas'];
      const allTeamsSet = new Set();

      for (const colName of potentialCollections) {
        try {
          const teamAgg = await db.collection(colName).aggregate([
            { $addFields: { teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$team', '$equipo', ''] } } } } } },
            { $group: { _id: '$teamNorm' } },
            { $match: { _id: { $ne: '' } } }
          ]).toArray();
          for (const t of (teamAgg || [])) allTeamsSet.add(baseName(t._id));
        } catch {}
      }

      // Asegurar también equipos provenientes de Lineas
      if (Array.isArray(lineasTeams)) {
        for (const lt of lineasTeams) allTeamsSet.add(baseName(lt.TEAM));
      }

      // 3) Lista obligatoria y orden prioritario
      const requiredOrder = ['IRANIA','MARISOL','PLEITEZ','RANDAL','ROBERTO'];
      requiredOrder.forEach(n => allTeamsSet.add(n));

      const present = new Set((equiposData || []).map(e => baseName(e.TEAM)));
      for (const name of allTeamsSet) {
        if (!present.has(name)) equiposData.push({ TEAM: name, ICON: 0, BAMO: 0, Total: 0, Puntaje: 0 });
      }

      // 4) Ordenar: primero requiredOrder, luego alfabético
      const orderIndex = new Map(requiredOrder.map((n,i)=>[n,i]));
      equiposData.sort((a,b)=>{
        const ai = orderIndex.has(a.TEAM) ? orderIndex.get(a.TEAM) : Infinity;
        const bi = orderIndex.has(b.TEAM) ? orderIndex.get(b.TEAM) : Infinity;
        if (ai !== bi) return ai - bi;
        return a.TEAM.localeCompare(b.TEAM);
      });
    } catch {}

    // Fallback garantizado: asegurar equipos requeridos aunque falle la sección anterior
    try {
      const requiredOrderFinal = ['IRANIA','MARISOL','PLEITEZ','RANDAL','ROBERTO'];
      const present = new Set((equiposData || []).map(e => String(e.TEAM || '').toUpperCase()));
      for (const name of requiredOrderFinal) {
        if (!present.has(name)) equiposData.push({ TEAM: name, ICON: 0, BAMO: 0, Total: 0, Puntaje: 0 });
      }
      const orderIndex = new Map(requiredOrderFinal.map((n,i)=>[n,i]));
      equiposData.sort((a,b)=>{
        const ai = orderIndex.has(String(a.TEAM).toUpperCase()) ? orderIndex.get(String(a.TEAM).toUpperCase()) : Infinity;
        const bi = orderIndex.has(String(b.TEAM).toUpperCase()) ? orderIndex.get(String(b.TEAM).toUpperCase()) : Infinity;
        if (ai !== bi) return ai - bi;
        return String(a.TEAM).localeCompare(String(b.TEAM));
      });
    } catch {}

    return res.json({ success: true, message: 'Estadísticas calculadas', total, data: equiposData });
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
