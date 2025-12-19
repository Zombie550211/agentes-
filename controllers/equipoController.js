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
    let { fechaInicio, fechaFin, scope, all, debug, primaryOnly, legacy } = req.query || {};
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
    // En métricas MENSUALES no usar createdAt/fecha como fallback de fecha de venta para evitar mezclar meses.
    // Solo permitir createdAt como fallback cuando se consulta un día específico.
    const allowCreatedAtFallback = !!isDayOnly;

    // Filtro mensual estricto (solo ISO): si el rango solicitado está dentro del mismo mes,
    // filtraremos únicamente por prefijo YYYY-MM- en dia_venta/fecha_contratacion.
    let strictMonthKey = null;
    let strictMonthPrefix = null;
    try {
      if (!isDayOnly && fechaInicio && fechaFin) {
        const [yyS, mmS] = String(fechaInicio).split('-');
        const [yyE, mmE] = String(fechaFin).split('-');
        const sameMonthRange = yyS && mmS && yyE && mmE && yyS === yyE && mmS === mmE;
        if (sameMonthRange) {
          strictMonthKey = `${yyS}-${mmS}`;
          strictMonthPrefix = new RegExp(`^${yyS}-${mmS}-`);
        }
      }
    } catch (_) {}

    // Si es un mes completo, aplicar match simple por prefijo ISO antes de parseos.
    // Esto evita falsos 0 que activan el fallback y nos asegura que costumers (primaryOnly) coincide con Atlas.
    if (strictMonthPrefix && !isDayOnly) {
      try {
        pipeline.push({
          $match: {
            $or: [
              { dia_venta: { $regex: strictMonthPrefix } },
              { fecha_contratacion: { $regex: strictMonthPrefix } }
            ]
          }
        });
      } catch (_) {}
    }
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
        saleDateRaw: allowCreatedAtFallback
          ? {
              $ifNull: [
                '$dia_venta',
                { $ifNull: [ '$fecha_contratacion', { $ifNull: [ '$createdAt', { $ifNull: [ '$fecha', '$creadoEn' ] } ] } ] }
              ]
            }
          : {
              $ifNull: [ '$dia_venta', { $ifNull: [ '$fecha_contratacion', null ] } ]
            },
        teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team', '$equipo', '$TEAM', ''] } } } },
        mercadoNorm: { $toUpper: { $trim: { input: { $ifNull: ['$mercado', ''] } } } },
  // Normalizar status/estado (simplificado) para contar 'activas' basadas en status
  statusRaw: { $ifNull: [ '$status', '$estado' ] },
  statusNorm: { 
    $toLower: { 
      $trim: { 
        input: { 
          $ifNull: [ 
            { $convert: { input: '$status', to: 'string', onError: '', onNull: '' } },
            { $convert: { input: '$estado', to: 'string', onError: '', onNull: '' } },
            ''
          ] 
        } 
      } 
    } 
  },
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

    // Nota: el match mensual estricto ya se aplicó arriba por prefijo ISO.

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
        ACTIVAS: { $sum: { $cond: [ 
          { $or: [ 
            { $eq: ['$statusNorm', 'completed'] },
            { $eq: ['$statusNorm', 'completado'] },
            { $eq: ['$statusNorm', 'finalizado'] },
            { $eq: ['$statusNorm', 'vendido'] },
            { $eq: ['$activated', true] }, 
            { $eq: ['$sold', true] }, 
            { $eq: ['$vendido', true] } 
          ] }, 
          1, 
          0 
        ] } },
        BAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, 1, 0 ] } },
        Total: { $sum: 1 },
        Puntaje: { $sum: '$puntajeNum' },
        PuntajeICON: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'ICON'] }, '$puntajeNum', 0 ] } },
        PuntajeBAMO: { $sum: { $cond: [ { $eq: ['$mercadoNorm', 'BAMO'] }, '$puntajeNum', 0 ] } }
      }
    });

  pipeline.push({ $project: { _id: 0, TEAM: '$_id', ICON: 1, ACTIVAS: 1, BAMO: 1, Total: 1, Puntaje: 1, PuntajeICON: 1, PuntajeBAMO: 1 } });
    pipeline.push({ $sort: { TEAM: 1 } });
    
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      unifiedAvailable = Array.isArray(u) && u.length > 0;
    } catch (_) {}
    const debugCollectionName = (preferUnified && unifiedAvailable) ? unifiedCollectionName : 'costumers';

    console.log('[EQUIPOS DEBUG] Buscando registros con status "completed" en noviembre...');
    try {
      const { ObjectId } = require('mongodb');
      const completedId = new ObjectId('690d45fec1c56f24f452ceb5');
      
      // Buscar el registro específico con status completed
      const completedDoc = await db.collection(debugCollectionName).findOne({ _id: completedId });
      
      if (completedDoc) {
        console.log('[EQUIPOS DEBUG] ✅ Registro con status COMPLETED encontrado:');
        console.log(`  - _id: ${completedDoc._id}`);
        console.log(`  - nombre: ${completedDoc.nombre_cliente}`);
        console.log(`  - status RAW: "${completedDoc.status}"`);
        console.log(`  - supervisor: ${completedDoc.supervisor}`);
        console.log(`  - dia_venta: ${completedDoc.dia_venta}`);
        console.log(`  - mercado: ${completedDoc.mercado}`);
        
        // Verificar si el pipeline lo procesa
        const testPipeline = [
          { $match: { _id: completedId } },
          {
            $addFields: {
              saleDateRaw: { $ifNull: ['$dia_venta', '$fecha_contratacion'] },
              teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team'] } } } },
              statusNorm: { 
                $toLower: { 
                  $trim: { 
                    input: { 
                      $ifNull: [ 
                        { $convert: { input: '$status', to: 'string', onError: '', onNull: '' } },
                        ''
                      ] 
                    } 
                  } 
                } 
              }
            }
          }
        ];
        const testResult = await db.collection(debugCollectionName).aggregate(testPipeline).toArray();
        if (testResult[0]) {
          console.log(`  - statusNorm en pipeline: "${testResult[0].statusNorm}"`);
          console.log(`  - teamNorm en pipeline: "${testResult[0].teamNorm}"`);
          console.log(`  - saleDateRaw en pipeline: "${testResult[0].saleDateRaw}"`);
        }
      } else {
        console.log('[EQUIPOS DEBUG] ❌ NO se encontró el registro con _id 690d45fec1c56f24f452ceb5');
      }
      
      // Contar cuántos registros con status completed hay en noviembre
      const completedCount = await db.collection(debugCollectionName).countDocuments({
        status: 'completed',
        dia_venta: { $regex: /2025-11-/ }
      });
      console.log(`[EQUIPOS DEBUG] Total registros con status "completed" en nov: ${completedCount}`);
      
    } catch(e) { console.warn('[EQUIPOS DEBUG] Error:', e.message); }

    // DEBUG: Ejecutar un pipeline simplificado para ver si el registro completed pasa el filtro
    console.log('[EQUIPOS DEBUG] Probando si el registro completed pasa el filtro de fechas...');
    try {
      const { ObjectId } = require('mongodb');
      const testPipeline = [...pipeline];
      testPipeline.push({ $match: { _id: new ObjectId('690d45fec1c56f24f452ceb5') } });
      const testResult = await db.collection(debugCollectionName).aggregate(testPipeline).toArray();
      console.log(`[EQUIPOS DEBUG] Resultado del test: ${testResult.length} documentos`);
      if (testResult.length > 0) {
        console.log('[EQUIPOS DEBUG] ✅ El registro SÍ pasa el filtro del pipeline');
      } else {
        console.log('[EQUIPOS DEBUG] ❌ El registro NO pasa el filtro del pipeline - quedó filtrado');
        
        // Debug adicional: revisar qué campos están fallando
        console.log('[EQUIPOS DEBUG] Depurando filtros:');
        console.log('- fechaInicio:', fechaInicio);
        console.log('- fechaFin:', fechaFin);
        console.log('- sUTC:', sUTC?.toISOString());
        console.log('- eUTC:', eUTC?.toISOString());
        
        // Probar solo el registro sin filtros de fecha
        const noDateFilter = pipeline.slice(0, -3); // Sin $match de fecha, $group, $project
        const testNoDate = await db.collection(debugCollectionName).aggregate([
          ...noDateFilter,
          { $match: { _id: new ObjectId('690d45fec1c56f24f452ceb5') } }
        ]).toArray();
        console.log('[EQUIPOS DEBUG] Sin filtro de fecha:', testNoDate.length, testNoDate[0] ? {
          saleDateRaw: testNoDate[0].saleDateRaw,
          saleDateDate: testNoDate[0].saleDateDate,
          teamNorm: testNoDate[0].teamNorm,
          statusNorm: testNoDate[0].statusNorm
        } : 'No encontrado');
      }
    } catch(e) { console.warn('[EQUIPOS DEBUG] Error en test:', e.message); }

    // Obtener colecciones costumers* para agregar (o solo la principal si se solicita)
    const usePrimaryOnly = String(primaryOnly) === '1' || String(primaryOnly).toLowerCase() === 'true';
    const allCollections = await db.listCollections().toArray();
    const allCollectionNames = allCollections.map(c => c.name);
    const useUnifiedAsSource = preferUnified && allCollectionNames.includes(unifiedCollectionName);
    const costumersCollections = useUnifiedAsSource
      ? [unifiedCollectionName]
      : (usePrimaryOnly
          ? (allCollectionNames.includes('costumers') ? ['costumers'] : [])
          : allCollectionNames.filter(name => /^costumers(_|$)/i.test(name))
        );
    
    console.log(`[EQUIPOS] Agregando de ${costumersCollections.length} colecciones ${useUnifiedAsSource ? '(costumers_unified)' : (usePrimaryOnly ? '(solo costumers)' : 'costumers*')}`);
    
    let equiposData = [];
    let usedCollections = [];
    const mergeMap = new Map();
    
    for (const colName of costumersCollections) {
      try {
        const arr = await db.collection(colName).aggregate(pipeline).toArray();
        if (Array.isArray(arr) && arr.length > 0) {
          usedCollections.push(colName);
          console.log(`[EQUIPOS DEBUG] Colección "${colName}" devolvió ${arr.length} equipos:`, JSON.stringify(arr));
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
        cur.ACTIVAS += Number(r.ACTIVAS || 0);
        cur.BAMO += Number(r.BAMO || 0);
        cur.Total += Number(r.Total || 0);
        cur.Puntaje += Number(r.Puntaje || 0);
        merged.set(key, cur);
      }
      equiposData = Array.from(merged.values()).filter(e => !EXCLUDED_TEAMS.has(baseName(e.TEAM)));

      // 2) Construir lista completa de equipos conocidos desde TODAS las colecciones costumers*
      const allCollectionsForTeams = await db.listCollections().toArray();
      const allCollectionNamesForTeams = allCollectionsForTeams.map(c => c.name);
      const costumersCollectionsForTeams = allCollectionNamesForTeams.filter(name => /^costumers(_|$)/i.test(name));
      const allTeamsSet = new Set();

      for (const colName of costumersCollectionsForTeams) {
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

    console.log(`[EQUIPOS DEBUG] Antes del fallback mensual: total=${total}, equiposData.length=${equiposData.length}`);
    console.log(`[EQUIPOS DEBUG] equiposData con ACTIVAS:`, equiposData.map(e => ({ team: e.TEAM, activas: e.ACTIVAS, total: e.Total })));

    // Fallback mensual por strings del mes (si el rango es mensual y total sigue en 0)
    try {
      console.log(`[EQUIPOS DEBUG] Verificando fallback mensual: total=${total}, fechaInicio=${fechaInicio}, fechaFin=${fechaFin}`);
      if (total === 0 && fechaInicio && fechaFin && fechaInicio !== fechaFin) {
        console.log('[EQUIPOS DEBUG] ⚠️ ACTIVANDO FALLBACK MENSUAL - Esto sobrescribirá el resultado del pipeline principal');
        const [yyS, mmS] = String(fechaInicio).split('-');
        const [yyE, mmE] = String(fechaFin).split('-');
        if (yyS && mmS && yyE && mmE && yyS === yyE && mmS === mmE) {
          const y = yyS; const m = mmS;
          const regexYMD = new RegExp(`^${y}-${m}-`);       // 2025-10-
          const regexDMY = new RegExp(`\\/${m}\\/${y}$`); // /10/2025
          const regexDMYDash = new RegExp(`-${m}-${y}$`);    // -10-2025

          const monthStringPipeline = [
            { $addFields: {
                teamNorm: { $toUpper: { $trim: { input: { $ifNull: ['$supervisor', '$team', '$equipo', '$TEAM', ''] } } } },
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

          // Obtener colecciones a considerar para el fallback mensual (respetar primaryOnly)
          const monthCollections = await db.listCollections().toArray();
          const monthCollectionNames = monthCollections.map(c => c.name);
          const costumersMonthCollections = usePrimaryOnly
            ? (monthCollectionNames.includes('costumers') ? ['costumers'] : [])
            : monthCollectionNames.filter(name => /^costumers(_|$)/i.test(name));
          
          const monthMergeMap = new Map();
          for (const colName of costumersMonthCollections) {
            try {
              const arr = await db.collection(colName).aggregate(monthStringPipeline).toArray();
              if (Array.isArray(arr) && arr.length) {
                for (const r of arr) {
                  const key = String(r.TEAM || '').toUpperCase();
                  const cur = monthMergeMap.get(key) || { TEAM: key, ICON: 0, ACTIVAS: 0, BAMO: 0, Total: 0, Puntaje: 0 };
                  cur.ICON += Number(r.ICON || 0);
                  cur.ACTIVAS += Number(r.ACTIVAS || 0);
                  cur.BAMO += Number(r.BAMO || 0);
                  cur.Total += Number(r.Total || 0);
                  cur.Puntaje += Number(r.Puntaje || 0);
                  monthMergeMap.set(key, cur);
                }
                usedCollection = colName;
              }
            } catch {}
          }
          
          equiposData = Array.from(monthMergeMap.values()).sort((a,b)=>a.TEAM.localeCompare(b.TEAM));
          total = equiposData.reduce((acc, r) => acc + (r?.Total || 0), 0);
        }
      }
    } catch {}

    const response = { success: true, message: 'Estadísticas calculadas', total, data: equiposData, lineas: [], lineasTotalICON: 0 };
    console.log('[EQUIPOS] Totales:', { total, equipos: equiposData.length });
    
    // AGREGAR DATOS DE SUPERVISORES DE TEAM_LINEAS INDIVIDUALMENTE
    try {
      const { getDbFor } = require('../config/db');
      const user = req.user;
      const role = (user?.role || '').toLowerCase();
      const team = (user?.team || '').toLowerCase();
      
      // Obtener todos los supervisores de Team Lineas
      const supervisorsCol = await db.collection('users').find({ 
        role: /supervisor/i,
        team: /lineas/i
      }).toArray();
      
      console.log('[EQUIPOS] Supervisores de Team Lineas encontrados:', supervisorsCol.length);
      
      if (supervisorsCol && supervisorsCol.length > 0) {
        const dbTL = getDbFor('TEAM_LINEAS');
        
        if (dbTL) {
          // Mapeo de usernames a nombres completos de supervisores
          const supervisorNames = {
            'JONATHAN': 'JONATHAN F',
            'LUIS': 'LUIS G'
          };
          
          // Procesar cada supervisor individualmente
          for (const supervisor of supervisorsCol) {
            const supUsername = String(supervisor.username || '').toUpperCase();
            // Usar el mapeo para obtener el nombre completo
            const displayName = supervisorNames[supUsername] || supUsername;
            
            console.log(`[EQUIPOS] Procesando supervisor: ${displayName} (username: ${supUsername})`);
            
            // Obtener todos los agentes de este supervisor (buscar por username)
            const agents = await db.collection('users').find({ 
              supervisor: supUsername 
            }).toArray();
            
            console.log(`[EQUIPOS] Agentes encontrados para ${supUsername}:`, agents.length);
            
            if (agents && agents.length > 0) {
              let totalVentas = 0;
              let ventasActivas = 0; // Contador para ventas con status "Completed"
              
              // Helper para normalizar nombres de colecciones
              const __normName = (s) => {
                if (!s) return '';
                let v = String(s).trim();
                v = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                v = v.toUpperCase();
                v = v.replace(/\s+/g, '_');
                return v;
              };
              
              // Recorrer cada agente y contar sus ventas
              for (const agent of agents) {
                try {
                  const colName = __normName(agent.username);
                  const col = dbTL.collection(colName);
                  
                  // Construir filtro de fecha si aplica
                  let dateFilter = {};
                  if (fechaInicio && fechaFin) {
                    const sDate = parseDateInput(fechaInicio);
                    const eDate = parseDateInput(fechaFin);
                    
                    if (sDate && eDate) {
                      const sYMD = sDate.toISOString().split('T')[0];
                      const eYMD = eDate.toISOString().split('T')[0];
                      
                      // Filtro flexible para diferentes formatos de fecha
                      dateFilter = {
                        $or: [
                          { createdAt: { $gte: sDate, $lte: new Date(eDate.getTime() + 24*60*60*1000) } },
                          { creadoEn: { $gte: sDate, $lte: new Date(eDate.getTime() + 24*60*60*1000) } },
                          { dia_venta: { $gte: sYMD, $lte: eYMD } }
                        ]
                      };
                    }
                  }
                  
                  // Contar el total de clientes del agente
                  const count = await col.countDocuments(dateFilter);
                  totalVentas += count;
                  
                  // Contar ventas ACTIVAS (status = "Completed" - case insensitive)
                  const activasFilter = { 
                    ...dateFilter, 
                    $or: [
                      { status: 'Completed' },
                      { status: 'completed' },
                      { status: 'COMPLETED' }
                    ]
                  };
                  const activasCount = await col.countDocuments(activasFilter);
                  ventasActivas += activasCount;
                  
                  console.log(`[EQUIPOS] Agente ${agent.username}: ${count} ventas totales, ${activasCount} activas (Completed)`);
                } catch (err) {
                  console.warn(`[EQUIPOS] Error procesando agente ${agent.username}:`, err.message);
                }
              }
              
              // Agregar el supervisor a los datos de TEAM LINEAS (separado de equipos principales)
              const supervisorData = {
                name: displayName, // Nombre completo del supervisor
                TEAM: displayName,
                ICON: totalVentas, // Para TEAM LINEAS, ICON muestra el total
                ACTIVAS: ventasActivas, // Ventas con status "Completed"
                BAMO: 0,
                Total: totalVentas,
                Puntaje: 0,
                PuntajeICON: 0,
                PuntajeBAMO: 0
              };
              
              // Agregar al array de LINEAS (no al array principal de data)
              response.lineas.push(supervisorData);
              response.lineasTotalICON += totalVentas;
              
              console.log(`[EQUIPOS] Datos de supervisor ${displayName} agregados a LINEAS:`, supervisorData);
            }
          }
        }
      }
    } catch (err) {
      console.error('[EQUIPOS] Error agregando datos de supervisores TEAM_LINEAS:', err);
      // Continuar sin agregar supervisores si hay error
    }
    
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
    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let col = db.collection('costumers');
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      if (preferUnified && Array.isArray(u) && u.length > 0) col = db.collection(unifiedCollectionName);
    } catch (_) {}
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
    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let col = db.collection('costumers');
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      if (preferUnified && Array.isArray(u) && u.length > 0) col = db.collection(unifiedCollectionName);
    } catch (_) {}
    const sample = await col.find({}).sort({ _id: -1 }).limit(5).toArray();
    res.json({ success:true, sample });
  } catch(e){
    res.status(500).json({ success:false, message:'Error debug', error:e.message });
  }
}

module.exports = { obtenerEstadisticasEquipos, obtenerListaEquipos, debugCostumers };
