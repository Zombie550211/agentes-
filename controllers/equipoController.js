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
    console.log('[EQUIPOS] Request params:', req.query);
    let db = getDb();
    if (!db) {
      try {
        db = await connectToMongoDB();
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
      }
    }

    

    // Rango de fechas (por defecto: MES ACTUAL)
    let { fechaInicio, fechaFin, scope, all, debug } = req.query || {};
    const isDebug = String(debug) === '1';
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

    let start = parseDateInput(fechaInicio);
    let end = parseDateInput(fechaFin);
    let endOfDay = end ? new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1) : null;

    const pipeline = [];

    // Si piden SOLO el día (scope=day o fechaInicio==fechaFin), aplicar match directo por strings
    const isDayOnly = (scope === 'day') || (fechaInicio && fechaFin && fechaInicio === fechaFin);
    // Regla de reinicio: 09:30 America/El_Salvador (UTC-6, sin DST)
    let dayResetInfo = null;
    if (isDayOnly && start) {
      try {
        const now = new Date();
        const nowSV = new Date(now.getTime() - 6 * 60 * 60 * 1000); // UTC-6
        const req = new Date(start);
        const sameDateSV = (d1, d2) => d1.getUTCFullYear() === d2.getUTCFullYear() && (d1.getUTCMonth() === d2.getUTCMonth()) && (d1.getUTCDate() === d2.getUTCDate());
        const cutoff = new Date(nowSV.getTime()); cutoff.setUTCHours(15, 30, 0, 0); // 09:30 SV = 15:30 UTC
        // Si la fecha solicitada es "hoy" (en horario de SV) y aún no pasa 09:30 SV, usar ayer
        if (sameDateSV(req, nowSV) && now < cutoff) {
          const yesterday = new Date(req.getTime() - 24 * 60 * 60 * 1000);
          start = yesterday; end = yesterday; endOfDay = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000 - 1);
          dayResetInfo = { effective: yesterday.toISOString().slice(0,10), reason: 'before_09_30_SV' };
        } else {
          dayResetInfo = { effective: req.toISOString().slice(0,10), reason: 'after_09_30_SV_or_not_today' };
        }
        console.log('[EQUIPOS] Day scope:', dayResetInfo);
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
        teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team', '$equipo', ''] } } } },
        mercadoNorm: { $toUpper: { $trim: { input: { $ifNull: ['$mercado', ''] } } } },
  // Normalizar status/estado (simplificado) para contar 'activas' basadas en status
  statusRaw: { $ifNull: [ '$status', '$estado' ] },
  statusNorm: { $toLower: { $trim: { input: { $ifNull: [ '$status', '$estado' ] } } } },
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

    // Match por rango/día (con límites en UTC y soporte string)
    let pipelineMatchStrategy = 'none';
    let sUTC = null, eUTC = null;
    if (String(all).trim() !== '1' && (start || endOfDay)) {
      const sameDay = !!(start && end && start.toDateString() === end.toDateString());
      // Límites en UTC para evitar desfases por zona horaria
      sUTC = start ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0)) : null;
      eUTC = end ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999)) : null;
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

      if (sameDay && sUTC && eUTC) {
        pipeline.push({
          $match: {
            $or: [
              // Por tipo Date en rango UTC
              { $expr: { $and: [ { $gte: ['$saleDateDate', sUTC] }, { $lte: ['$saleDateDate', eUTC] } ] } },
              // Por string crudo exacto
              { saleDateRaw: { $in: [ sYMD, sDMY, sDMYDash ] } },
              // Por string inglés estilo "Mon Oct 27 2025 ..."
              { saleDateRaw: { $regex: new RegExp(`^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\\s+${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(start).getUTCMonth()]}\\s+${new Date(start).getUTCDate()}\\s+${new Date(start).getUTCFullYear()}`, 'i') } }
            ]
          }
        });
        pipelineMatchStrategy = 'same-day UTC|string-exact';
        console.log('[EQUIPOS] Match strategy:', pipelineMatchStrategy, 'sUTC:', sUTC?.toISOString(), 'eUTC:', eUTC?.toISOString());
      } else {
        const exprDate = { $and: [] };
        if (sUTC) exprDate.$and.push({ $gte: ['$saleDateDate', sUTC] });
        if (eUTC) exprDate.$and.push({ $lte: ['$saleDateDate', eUTC] });

        // Comparación alternativa por string YYYY-MM-DD (más tolerante a TZ)
        const exprStr = { $and: [] };
        if (fechaInicio) exprStr.$and.push({ $gte: [ { $dateToString: { format: '%Y-%m-%d', date: '$saleDateDate' } }, String(fechaInicio) ] });
        if (fechaFin)    exprStr.$and.push({ $lte: [ { $dateToString: { format: '%Y-%m-%d', date: '$saleDateDate' } }, String(fechaFin) ] });

        const finalOr = [];
        if (exprDate.$and.length) finalOr.push({ $and: exprDate.$and });
        if (exprStr.$and.length)  finalOr.push({ $and: exprStr.$and });

        // Si el rango es dentro del mismo mes, agregar también coincidencias por strings crudos del mes
        try {
          const [yyS, mmS] = String(fechaInicio || '').split('-');
          const [yyE, mmE] = String(fechaFin || '').split('-');
          const sameMonthRange = yyS && mmS && yyE && mmE && yyS === yyE && mmS === mmE;
          if (sameMonthRange) {
            const monthRegexYMD = new RegExp(`^${yyS}-${mmS}-`);
            const monthRegexDMY = new RegExp(`\\/${mmS}\\/${yyS}$`);
            const monthRegexDMYDash = new RegExp(`-${mmS}-${yyS}$`);
            // Regex para strings en inglés con mes abreviado dentro del mes/año: "Oct <dia> 2025"
            const monthIdx = Number(mmS) - 1;
            const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthIdx];
            const monthRegexENG = new RegExp(`(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\\s+${monthAbbr}\\s+\\d{1,2}\\s+${yyS}`, 'i');
            finalOr.push({ $regexMatch: { input: '$saleDateRaw', regex: monthRegexYMD } });
            finalOr.push({ $regexMatch: { input: '$saleDateRaw', regex: monthRegexDMY } });
            finalOr.push({ $regexMatch: { input: '$saleDateRaw', regex: monthRegexDMYDash } });
            finalOr.push({ $regexMatch: { input: '$saleDateRaw', regex: monthRegexENG } });
          }
        } catch {}

        if (finalOr.length) pipeline.push({ $match: { $expr: { $or: finalOr } } });
        pipelineMatchStrategy = 'range UTC|string-ymd';
        console.log('[EQUIPOS] Match strategy:', pipelineMatchStrategy, 'sUTC:', sUTC?.toISOString(), 'eUTC:', eUTC?.toISOString());
      }
    }

    // Agrupar por team
    pipeline.push({
      $group: {
        _id: '$teamNorm',
        ICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, 1, 0 ] } },
        ACTIVAS: { $sum: { $cond: [ { $or: [ { $regexMatch: { input: '$statusNorm', regex: /completed|completad|finaliz|vendid|vendido/ } }, { $eq: ['$activated', true] }, { $eq: ['$sold', true] }, { $eq: ['$vendido', true] } ] }, 1, 0 ] } },
        BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
        Total: { $sum: 1 },
        Puntaje: { $sum: '$puntajeNum' },
        PuntajeICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, '$puntajeNum', 0 ] } },
        PuntajeBAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, '$puntajeNum', 0 ] } }
      }
    });

  pipeline.push({ $project: { _id: 0, TEAM: '$_id', ICON: 1, ACTIVAS: 1, BAMO: 1, Total: 1, Puntaje: 1, PuntajeICON: 1, PuntajeBAMO: 1 } });
    pipeline.push({ $sort: { TEAM: 1 } });

    // Intentar múltiples colecciones posibles y UNIFICAR resultados
    const collectionsToTry = ['costumers','Costumers','customers','leads','Leads','ventas'];
    let equiposData = [];
    let usedCollections = [];
    const mergeMap = new Map();
    for (const colName of collectionsToTry) {
      try {
        const arr = await db.collection(colName).aggregate(pipeline).toArray();
        if (Array.isArray(arr) && arr.length > 0) {
          usedCollections.push(colName);
          for (const r of arr) {
            const key = String(r.TEAM || '').toUpperCase();
            const cur = mergeMap.get(key) || { TEAM: key, ICON: 0, ACTIVAS: 0, BAMO: 0, Total: 0, Puntaje: 0, PuntajeICON: 0, PuntajeBAMO: 0 };
            cur.ICON += Number(r.ICON || 0);
            cur.ACTIVAS += Number(r.ACTIVAS || 0);
            cur.BAMO += Number(r.BAMO || 0);
            cur.Total += Number(r.Total || 0);
            cur.Puntaje += Number(r.Puntaje || 0);
            cur.PuntajeICON += Number(r.PuntajeICON || 0);
            cur.PuntajeBAMO += Number(r.PuntajeBAMO || 0);
            mergeMap.set(key, cur);
          }
        }
      } catch (e) {
        // continuar
      }
    }
    equiposData = Array.from(mergeMap.values()).sort((a,b)=>a.TEAM.localeCompare(b.TEAM));
    console.log('[EQUIPOS] Used collections:', usedCollections.length ? usedCollections : 'none (no matches)');

    // Fallback por string exacto si no hubo matches
    let total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
    if ((!equiposData || equiposData.length === 0) && start && endOfDay && (start.toDateString() === end.toDateString())) {
      try {
        const startStr = new Date(start).toISOString().slice(0,10);
        const unionDocs = [];
        for (const colName of collectionsToTry) {
          try {
            const docs = await db.collection(colName).find({ $or: [ { dia_venta: startStr }, { fecha_contratacion: startStr } ] }).toArray();
            if (docs && docs.length) unionDocs.push(...docs);
          } catch {}
        }
        const docs = unionDocs;
        if (docs && docs.length) {
          const map = new Map();
          for (const d of docs) {
            const teamKey = String(d.team || d.equipo || '').toUpperCase() || 'SIN EQUIPO';
            const mercadoKey = String(d.mercado || '').toUpperCase();
              const punt = Number(d.puntaje || 0);
              const obj = map.get(teamKey) || { TEAM: teamKey, ICON: 0, ACTIVAS: 0, BAMO: 0, Total: 0, Puntaje: 0 };
              if (mercadoKey === 'ICON') obj.ICON += 1; else if (mercadoKey === 'BAMO') obj.BAMO += 1;
              // Determinar si este documento representa una 'venta activa' por status
              try {
                const status = (d.status || d.estado || d.estadoVenta || d.workflowStatus || d.state || d.saleStatus || '').toString().toLowerCase();
                if (/completed|completad|finaliz|vendid|vendido/.test(status) || d.activated === true || d.sold === true) {
                  obj.ACTIVAS = (obj.ACTIVAS || 0) + 1;
                }
              } catch(_) {}
              obj.Total += 1; obj.Puntaje += punt; map.set(teamKey, obj);
          }
          equiposData = Array.from(map.values()).sort((a,b)=>a.TEAM.localeCompare(b.TEAM));
          total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
        }
      } catch(e){ console.warn('[EQUIPOS fallback] Error:', e?.message); }
    }


    // LINEAS como team agregado
    const lineasCollections = ['Lineas','lineas'];
    const lineasPipeline = [
      { $addFields: {
          saleDateRaw: { $ifNull: ['$dia_venta', '$creadoEn'] },
          saleDate: { $cond: [ { $eq: [ { $type: '$dia_venta' }, 'string' ] }, { $dateFromString: { dateString: '$dia_venta' } }, { $ifNull: ['$dia_venta', '$creadoEn'] } ] },
          teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team', 'TEAM LINEAS'] } } } },
          mercadoNorm: { $toUpper: { $trim: { input: { $ifNull: ['$mercado', '' ] } } } },
          puntajeNum: { $convert: { input: '$puntaje', to: 'double', onError: 0, onNull: 0 } }
      } }
    ];
    if (String(all).trim() !== '1' && (start || endOfDay)) {
      const sameDay = !!(start && end && start.toDateString() === end.toDateString());
      // Usar límites en UTC
      const sUTC = start ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0)) : null;
      const eUTC = end ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999)) : null;
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
      if (sameDay && sUTC && eUTC) {
        lineasPipeline.push({
          $match: {
            $or: [
              { $expr: { $and: [ { $gte: ['$saleDate', sUTC] }, { $lte: ['$saleDate', eUTC] } ] } },
              { dia_venta: { $in: [ sYMD, sDMY, sDMYDash ] } }
            ]
          }
        });
      } else {
        const orExpr = [];
        const andDate = { $and: [] };
        if (sUTC) andDate.$and.push({ $gte: ['$saleDate', sUTC] });
        if (eUTC) andDate.$and.push({ $lte: ['$saleDate', eUTC] });
        if (andDate.$and.length) orExpr.push(andDate);

        const andStr = { $and: [] };
        if (fechaInicio) andStr.$and.push({ $gte: [ { $dateToString: { format: '%Y-%m-%d', date: '$saleDate' } }, String(fechaInicio) ] });
        if (fechaFin)    andStr.$and.push({ $lte: [ { $dateToString: { format: '%Y-%m-%d', date: '$saleDate' } }, String(fechaFin) ] });
        if (andStr.$and.length) orExpr.push(andStr);

        if (orExpr.length) lineasPipeline.push({ $match: { $expr: { $or: orExpr } } });
      }
    }
    lineasPipeline.push({ $group: {
      _id: '$teamNorm',
      ICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, 1, 0 ] } },
      ACTIVAS: { $sum: { $cond: [ { $or: [ { $regexMatch: { input: '$statusNorm', regex: /completed|completad|finaliz|vendid|vendido/ } }, { $eq: ['$activated', true] }, { $eq: ['$sold', true] } ] }, 1, 0 ] } },
      BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
      Total: { $sum: 1 },
      Puntaje: { $sum: '$puntajeNum' }
    } });
    lineasPipeline.push({ $project: { _id: 0, TEAM: '$_id', ICON: 1, ACTIVAS: 1, BAMO: 1, Total: 1, Puntaje: 1 } });

    let lineasTeams = [];
    for (const ln of lineasCollections) {
      try {
        const arr = await db.collection(ln).aggregate(lineasPipeline).toArray();
        if (Array.isArray(arr) && arr.length) {
          lineasTeams = lineasTeams.concat(arr);
        }
      } catch {}
    }

    // Fusionar resultado de Lineas en equiposData (como otro team)
    if (Array.isArray(lineasTeams) && lineasTeams.length) {
      // Si ya existe TEAM LINEAS en equiposData, sumar
      const map = new Map(equiposData.map(e => [e.TEAM, { ...e }]));
      for (const lt of lineasTeams) {
          if (map.has(lt.TEAM)) {
          const cur = map.get(lt.TEAM);
          cur.ICON = (cur.ICON || 0) + (lt.ICON || 0);
          cur.ACTIVAS = (cur.ACTIVAS || 0) + (lt.ACTIVAS || 0);
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
      const EXCLUDED_TEAMS = new Set([]);
      const merged = new Map();
      for (const r of (equiposData || [])) {
        const key = baseName(r.TEAM);
  const cur = merged.get(key) || { TEAM: key, ICON: 0, ACTIVAS: 0, BAMO: 0, Total: 0, Puntaje: 0 };
        cur.ICON += Number(r.ICON || 0);
        cur.BAMO += Number(r.BAMO || 0);
        cur.Total += Number(r.Total || 0);
        cur.Puntaje += Number(r.Puntaje || 0);
        merged.set(key, cur);
      }
      equiposData = Array.from(merged.values()).filter(e => !EXCLUDED_TEAMS.has(baseName(e.TEAM)));

      // 2) Construir lista completa de equipos conocidos desde todas las colecciones
      const potentialCollections = ['costumers','Costumers','customers','leads','Leads','ventas'];
      const allTeamsSet = new Set();

      for (const colName of potentialCollections) {
        try {
          const teamAgg = await db.collection(colName).aggregate([
            { $addFields: { teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team', '$equipo', ''] } } } } } },
            { $group: { _id: '$teamNorm' } },
            { $match: { _id: { $ne: '' } } }
          ]).toArray();
          for (const t of (teamAgg || [])) {
            const name = baseName(t._id);
            if (name && !EXCLUDED_TEAMS.has(name)) allTeamsSet.add(name);
          }
        } catch {}
      }

      // Asegurar también equipos provenientes de Lineas
      if (Array.isArray(lineasTeams)) {
        for (const lt of lineasTeams) {
          const name = baseName(lt.TEAM);
          if (name && !EXCLUDED_TEAMS.has(name)) allTeamsSet.add(name);
        }
      }

      // 3) Lista obligatoria y orden prioritario
      const requiredOrder = ['IRANIA','MARISOL','PLEITEZ','ROBERTO'];
      requiredOrder.forEach(n => allTeamsSet.add(n));

      const present = new Set((equiposData || []).map(e => baseName(e.TEAM)));
      for (const name of allTeamsSet) {
          if (!present.has(name) && !EXCLUDED_TEAMS.has(name)) {
          equiposData.push({ TEAM: name, ICON: 0, ACTIVAS: 0, BAMO: 0, Total: 0, Puntaje: 0 });
        }
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
      const EXCLUDED_TEAMS = new Set([]);
      const requiredOrderFinal = ['IRANIA','MARISOL','PLEITEZ','ROBERTO'];
      const present = new Set((equiposData || []).map(e => String(e.TEAM || '').toUpperCase()));
      for (const name of requiredOrderFinal) {
        if (!present.has(name) && !EXCLUDED_TEAMS.has(name)) {
          equiposData.push({ TEAM: name, ICON: 0, ACTIVAS: 0, BAMO: 0, Total: 0, Puntaje: 0 });
        }
      }
      const orderIndex = new Map(requiredOrderFinal.map((n,i)=>[n,i]));
      equiposData.sort((a,b)=>{
        const ai = orderIndex.has(String(a.TEAM).toUpperCase()) ? orderIndex.get(String(a.TEAM).toUpperCase()) : Infinity;
        const bi = orderIndex.has(String(b.TEAM).toUpperCase()) ? orderIndex.get(String(b.TEAM).toUpperCase()) : Infinity;
        if (ai !== bi) return ai - bi;
        return String(a.TEAM).localeCompare(String(b.TEAM));
      });
    } catch {}

    // Fallback mensual por strings del mes (si el rango es mensual y total sigue en 0)
    try {
      if (total === 0 && fechaInicio && fechaFin && fechaInicio !== fechaFin) {
        const [yyS, mmS] = String(fechaInicio).split('-');
        const [yyE, mmE] = String(fechaFin).split('-');
        if (yyS && mmS && yyE && mmE && yyS === yyE && mmS === mmE) {
          const y = yyS; const m = mmS;
          const regexYMD = new RegExp(`^${y}-${m}-`);       // 2025-10-
          const regexDMY = new RegExp(`\\/${m}\\/${y}$`); // /10/2025
          const regexDMYDash = new RegExp(`-${m}-${y}$`);    // -10-2025

          const monthStringPipeline = [
            { $addFields: {
                teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team', '$equipo', ''] } } } },
                mercadoNorm: { $toUpper: { $trim: { input: { $ifNull: ['$mercado', ''] } } } },
                puntajeNum: { $convert: { input: { $ifNull: ['$puntaje', { $ifNull: ['$puntuacion', { $ifNull: ['$points', '$score'] } ] } ] }, to: 'double', onError: 0, onNull: 0 } }
            }},
            { $match: { $or: [
                { dia_venta: { $regex: regexYMD } },
                { fecha_contratacion: { $regex: regexYMD } },
                { dia_venta: { $regex: regexDMY } },
                { fecha_contratacion: { $regex: regexDMY } },
                { dia_venta: { $regex: regexDMYDash } },
                { fecha_contratacion: { $regex: regexDMYDash } }
            ] } },
            { $group: {
        _id: '$teamNorm',
        ICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, 1, 0 ] } },
        ACTIVAS: { $sum: { $cond: [ { $or: [ { $regexMatch: { input: '$statusNorm', regex: /completed|completad|finaliz|vendid|vendido/ } }, { $eq: ['$activated', true] }, { $eq: ['$sold', true] } ] }, 1, 0 ] } },
        BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
        Total: { $sum: 1 },
        Puntaje: { $sum: '$puntajeNum' }
            }},
      { $project: { _id: 0, TEAM: '$_id', ICON: 1, ACTIVAS: 1, BAMO: 1, Total: 1, Puntaje: 1 } },
            { $sort: { TEAM: 1 } }
          ];

          for (const colName of ['costumers','Costumers','customers','leads','Leads','ventas']) {
            try {
              const arr = await db.collection(colName).aggregate(monthStringPipeline).toArray();
              if (Array.isArray(arr) && arr.length) {
                equiposData = arr;
                usedCollection = colName;
                break;
              }
            } catch {}
          }
          total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
        }
      }
    } catch {}

    const response = { success: true, message: 'Estadísticas calculadas', total, data: equiposData };
    console.log('[EQUIPOS] Totales:', { total, equipos: equiposData.length });
    if (isDebug) {
      response.debug = {
        usedCollection,
        requested: { fechaInicio, fechaFin, scope: scope || null },
        match: { strategy: pipelineMatchStrategy, sUTC: sUTC ? sUTC.toISOString() : null, eUTC: eUTC ? eUTC.toISOString() : null },
        dayReset: dayResetInfo,
        sizes: { equipos: equiposData.length }
      };
    }
    return res.json(response);
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
      { $addFields: { teamNorm: { $toUpper: { $ifNull: ['$supervisor', '$team', '$equipo', ''] } } } },
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
