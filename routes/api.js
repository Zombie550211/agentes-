const express = require('express');
const router = express.Router();
const { getDb, getDbFor, connectToMongoDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// ============================
// Funciones auxiliares
// ============================

function __isTeamLineas(req) {
  try {
    const t = String(req.user?.team||'').toLowerCase();
    const r = String(req.user?.role||'').toLowerCase();
    const u = String(req.user?.username||'').toLowerCase();
    return t.includes('lineas') || r.includes('teamlineas') || u.startsWith('lineas-');
  } catch { return false; }
}

function __normName(s) {
  try { 
    return String(s||'').normalize('NFD')
      .replace(/[^\x00-\x7F]/g,'')
      .toUpperCase()
      .replace(/\\s+/g,'_')
      .replace(/[^A-Z0-9_]/g,'_') || 'UNKNOWN'; 
  } catch { 
    return String(s||'').toUpperCase().replace(/\\s+/g,'_') || 'UNKNOWN'; 
  }
}

function __getTeamLineasCollection(req) {
  const dbTL = getDbFor('TEAM_LINEAS');
  if (!dbTL) return null;
  const ownerName = req.user?.name || req.user?.username || 'UNKNOWN';
  const colName = __normName(ownerName);
  return dbTL.collection(colName);
}

async function __findByIdGeneric(col, recordId) {
  let objId = null;
  try { objId = new ObjectId(String(recordId)); } catch { objId = null; }
  const byObj = objId ? await col.findOne({ _id: objId }) : null;
  if (byObj) return byObj;
  return await col.findOne({ _id: String(recordId) }) || await col.findOne({ id: String(recordId) });
}

async function getCostumerById(db, recordId) {
  const collection = db.collection('costumers');
  let objId = null;
  try { objId = new ObjectId(recordId); } catch { objId = null; }
  const byObj = objId ? await collection.findOne({ _id: objId }) : null;
  if (byObj) return byObj;
  return await collection.findOne({ _id: recordId });
}

// ============================
// Rutas
// ============================

/**
 * @route GET /api/leads
 * @desc Obtener lista de leads/clientes
 * @access Private
 */
router.get('/leads', protect, async (req, res) => {
  try {
    const db = getDb();
    console.log('[USERS UPDATE ROLE] after getDb, db present?', !!db);
    if (!db) {
      console.warn('[USERS UPDATE ROLE] No DB connection available');
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const { fechaInicio, fechaFin, status, month, allData, noFilter, skipDate } = req.query;
    let query = {};
    const andConditions = [];

    // ===== SOLICITUD GLOBAL (para mapa, etc.) =====
    const isGlobalRequest = (String(allData).toLowerCase() === 'true') ||
                            (String(noFilter).toLowerCase() === 'true') ||
                            (String(skipDate).toLowerCase() === 'true');

    if (isGlobalRequest && !fechaInicio && !fechaFin && !month && !status) {
      // TODOS los usuarios ven datos agregados de todas las colecciones
      console.log('[API /leads GLOBAL] Agregando de TODAS las colecciones costumers* para todos los usuarios');
      
      let leads = [];
      
      // Siempre agregar de todas las colecciones
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);
      const costumersCollections = collectionNames.filter(name => /^costumers(_|$)/i.test(name));
      
      for (const colName of costumersCollections) {
        try {
          const docs = await db.collection(colName).find({}).toArray();
          leads = leads.concat(docs);
        } catch (err) {
          console.error(`[API /leads GLOBAL] Error consultando ${colName}:`, err.message);
        }
      }
      
      console.log(`[API /leads GLOBAL] Total de ${costumersCollections.length} colecciones costumers*, ${leads.length} documentos`);
      console.log(`[API /leads] Solicitud GLOBAL sin filtros (mapa u otros). Total combinado: ${leads.length}`);
      return res.json({ success: true, data: leads, queryUsed: { global: true } });
    }
    // ===== FIN SOLICITUD GLOBAL =====

    // Filtro por status (si se proporciona)
    if (status && status.toLowerCase() !== 'todos') {
      andConditions.push({ status: status });
    }

    // Filtro por mes específico o mes actual si no se especifican fechas
    if (!fechaInicio && !fechaFin) {
      let targetYear, targetMonth;
      
      if (month) {
        // Soportar formatos: YYYY-MM OR MM (con ?year=YYYY)
        if (/^\d{4}-\d{2}$/.test(month)) {
          const [year, monthNum] = month.split('-').map(Number);
          targetYear = year;
          targetMonth = monthNum;
          console.log(`[API /leads] Filtro por mes específico (YYYY-MM): ${month}`);
        } else if (/^\d{1,2}$/.test(month) && req.query.year && /^\d{4}$/.test(String(req.query.year))) {
          targetYear = Number(req.query.year);
          targetMonth = Number(month);
          console.log(`[API /leads] Filtro por mes específico (MM + year): ${targetYear}-${String(targetMonth).padStart(2,'0')}`);
        } else {
          console.warn('[API /leads] Parámetro month no reconocido, usando mes actual. month=', month, 'year=', req.query.year);
        }
      } else {
        // Usar mes actual por defecto
        const now = new Date();
        targetYear = now.getFullYear();
        targetMonth = now.getMonth() + 1; // 1-12
        console.log(`[API /leads] Filtro automático por mes actual: ${targetYear}-${String(targetMonth).padStart(2, '0')}`);
      }

      // Validar que targetYear/targetMonth sean números válidos; si no, usar mes actual
      if (!Number.isInteger(targetYear) || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
        const now = new Date();
        targetYear = now.getFullYear();
        targetMonth = now.getMonth() + 1;
        console.warn('[API /leads] Valores de mes/año inválidos tras parseo; usando mes actual:', targetYear, targetMonth);
      }
      
      // Generar strings para todo el mes objetivo
      const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
      const dateStrings = [];
      const dateRegexes = [];
      
      for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = String(day).padStart(2, '0');
        const monthStr = String(targetMonth).padStart(2, '0');
        
        dateStrings.push(`${targetYear}-${monthStr}-${dayStr}`);
        dateStrings.push(`${dayStr}/${monthStr}/${targetYear}`);
        
        const dateObj = new Date(targetYear, targetMonth - 1, day);
        dateRegexes.push(new RegExp(`^${dateObj.toDateString()}`, 'i'));
      }
      
      const monthStart = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(targetYear, targetMonth - 1, daysInMonth, 23, 59, 59, 999);
      
      const dateOrConditions = [
        { dia_venta: { $in: dateStrings } },
        { createdAt: { $gte: monthStart, $lte: monthEnd } }
      ];
      
      dateRegexes.forEach(regex => {
        dateOrConditions.push({ dia_venta: { $regex: regex.source, $options: 'i' } });
      });
      
      const dateQuery = { $or: dateOrConditions };
      andConditions.push(dateQuery);
    }
    // Filtro por rango de fechas (si se proporciona)
    else if (fechaInicio && fechaFin) {
      // Parsear fechas en formato YYYY-MM-DD
      const [yStart, mStart, dStart] = fechaInicio.split('-').map(Number);
      const [yEnd, mEnd, dEnd] = fechaFin.split('-').map(Number);
      
      const start = new Date(yStart, mStart - 1, dStart, 0, 0, 0, 0);
      const end = new Date(yEnd, mEnd - 1, dEnd, 23, 59, 59, 999);

      const dateStrings = [];
      const dateRegexes = [];

      // Generar strings para cada día en el rango
      const current = new Date(yStart, mStart - 1, dStart);
      const endDate = new Date(yEnd, mEnd - 1, dEnd);
      
      while (current <= endDate) {
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        
        dateStrings.push(`${year}-${month}-${day}`);
        dateStrings.push(`${day}/${month}/${year}`);
        dateRegexes.push(new RegExp(`^${current.toDateString()}`, 'i'));
        
        current.setDate(current.getDate() + 1);
      }

      const dateOrConditions = [
        { dia_venta: { $in: dateStrings } },
        { createdAt: { $gte: start, $lte: end } }
      ];
      
      // Agregar condiciones de regex individualmente usando el source del RegExp
      dateRegexes.forEach(regex => {
        dateOrConditions.push({ dia_venta: { $regex: regex.source, $options: 'i' } });
      });

      const dateQuery = { $or: dateOrConditions };
      andConditions.push(dateQuery);
      
      // Logs de depuración dentro del scope
      console.log(`[API /leads] Filtro de fecha: ${fechaInicio} a ${fechaFin}`);
      console.log(`[API /leads] Strings de fecha buscados:`, dateStrings.slice(0, 4));
    }
    
    if (andConditions.length > 0) {
        query = { $and: andConditions };
    }

    // ====== AGREGACIÓN MULTI-COLECCIÓN (PAGINADA) ======
    // Implementamos paginación global a través de las colecciones costumers* (y TEAM_LINEAS si existe)
    // Parámetros soportados: page, limit, fields (proyección CSV)
    const page = Math.max(1, parseInt(req.query.page) || 1);
    // Por defecto devolver 50 leads por página para evitar payloads grandes
    const requestedLimit = parseInt(req.query.limit);
    const defaultLimit = 50;
    const maxLimit = 5000;
    let limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit;
    limit = Math.min(limit, maxLimit);
    const offsetGlobal = Math.max(0, parseInt(req.query.offset) || ((page - 1) * limit));
    const fieldsParam = (req.query.fields || '').toString().trim();
    const projection = {};
    if (fieldsParam) {
      fieldsParam.split(',').map(f => f.trim()).filter(Boolean).forEach(f => { projection[f] = 1; });
    }

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';

    // Recolectar todas las colecciones a iterar (incluye TEAM_LINEAS si existe)
    const allCollections = [];
    const collectionsList = await db.listCollections().toArray();
    const allNames = collectionsList.map(c => c.name);
    const unifiedAvailable = preferUnified && allNames.includes(unifiedCollectionName);
    const collectionNamesList = unifiedAvailable
      ? [unifiedCollectionName]
      : allNames.filter(n => /^costumers(_|$)/i.test(n));

    collectionNamesList.forEach(n => allCollections.push({ db: db, name: n }));
    console.log(`[API /leads] Source mode: ${unifiedAvailable ? 'costumers_unified' : 'costumers*'} (legacy=${String(legacy || '')})`);

    // Paginación a través de colecciones: calcular total y tomar la ventana [offsetGlobal, offsetGlobal+limit)
    let remaining = limit;
    let offset = offsetGlobal;
    const collected = [];
    let totalCount = 0;

    for (const collInfo of allCollections) {
      const colName = collInfo.name;
      try {
        const col = collInfo.db.collection(colName);
        // Contar documentos que coinciden con la query en esta colección
        const cnt = await col.countDocuments(query);
        console.log(`[API /leads] Colección ${colName} -> count=${cnt}`);
        totalCount += cnt;

        if (offset >= cnt) {
          // aún saltamos esta colección completa
          console.log(`[API /leads] Saltando colección ${colName} (offset remaining=${offset} >= count=${cnt})`);
          offset -= cnt;
          continue;
        }

        // calcular skip para esta colección
        const skip = offset > 0 ? offset : 0;
        const fetchLimit = Math.max(0, remaining);
        console.log(`[API /leads] Preparando fetch en ${colName}: skip=${skip} limit=${fetchLimit} (remaining global=${remaining})`);

        const cursor = col.find(query).sort({ createdAt: -1 }).skip(skip).limit(fetchLimit);
        if (Object.keys(projection).length) cursor.project(projection);
        const docs = await cursor.toArray();
        console.log(`[API /leads] ${colName} -> docsFetched=${docs?.length||0}`);
        if (docs && docs.length) {
          collected.push(...docs);
          remaining -= docs.length;
        }

        // reset offset una vez consumida la primera colección que requería skipping
        offset = 0;
        if (remaining <= 0) {
          console.log('[API /leads] Ventana completada — remaining <= 0, deteniendo iteración de colecciones');
          break;
        }
      } catch (err) {
        console.warn(`[API /leads] Error consultando ${colName}:`, err?.message || err);
      }
    }

    // Si no se usó proyección o se pidió menos datos que el total, devolver resultados tal cual
    // Calcular páginas totales
    const pages = Math.max(1, Math.ceil(totalCount / limit));
    console.log(`[API /leads] Paginación compuesta: page=${page} limit=${limit} offset=${offsetGlobal} total=${totalCount} pages=${pages} returned=${collected.length}`);

    // Ordenar la ventana devuelta por dia_venta y createdAt para mantener consistencia de UI
    collected.sort((a, b) => {
      const dateA = a.dia_venta || '';
      const dateB = b.dia_venta || '';
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      const cA = a.createdAt ? new Date(a.createdAt) : new Date(0);
      const cB = b.createdAt ? new Date(b.createdAt) : new Date(0);
      return cB - cA;
    });

    return res.json({ success: true, data: collected, total: totalCount, page, pages, queryUsed: query });
    // ====== FIN AGREGACIÓN MULTI-COLECCIÓN (PAGINADA) ======

  } catch (error) {
    console.error('[API] Error en GET /api/leads:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;

// Endpoint de diagnóstico para ver formatos de fecha
router.get('/leads/debug-dates', protect, async (req, res) => {
  try {
    const db = getDb();
    const collection = db.collection('costumers');
    
    // Buscar específicamente del día 20
    const day20 = await collection.find({
      dia_venta: "2025-11-20"
    }).toArray();
    
    console.log(`[DEBUG] Encontradas ${day20.length} ventas del día 20/11/2025`);
    
    // Buscar ventas de noviembre 2025
    const novSamples = await collection.find({
      dia_venta: { $regex: /^2025-11/ }
    }).sort({ createdAt: -1 }).limit(20).toArray();
    
    // Contar total de noviembre
    const novCount = await collection.countDocuments({
      dia_venta: { $regex: /^2025-11/ }
    });
    
    const dateInfo = novSamples.map(s => ({
      _id: s._id,
      dia_venta: s.dia_venta,
      createdAt: s.createdAt,
      status: s.status,
      agente: s.agenteNombre || s.agente
    }));
    
    res.json({ 
      success: true, 
      totalNoviembre: novCount,
      totalDia20: day20.length,
      samples: dateInfo,
      dia20Samples: day20.slice(0, 10).map(s => ({
        dia_venta: s.dia_venta,
        status: s.status,
        agente: s.agenteNombre || s.agente,
        servicios: s.servicios_texto || s.servicios
      }))
    });
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint temporal: devolver conteos por colección para un mes/rango dado
router.get('/leads/collection-counts', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'No DB' });

    const { month, fechaInicio, fechaFin } = req.query;
    let andConditions = [];

    // Construir query de fechas similar a /api/leads
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const dateStrings = [];
      const dateRegexes = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const d = String(day).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        dateStrings.push(`${y}-${mm}-${d}`);
        dateStrings.push(`${d}/${mm}/${y}`);
        const dateObj = new Date(y, m - 1, day);
        dateRegexes.push(new RegExp(`^${dateObj.toDateString()}`, 'i'));
      }
      const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(y, m - 1, daysInMonth, 23, 59, 59, 999);
      const dateOr = [ { dia_venta: { $in: dateStrings } }, { createdAt: { $gte: monthStart, $lte: monthEnd } } ];
      dateRegexes.forEach(r => dateOr.push({ dia_venta: { $regex: r.source, $options: 'i' } }));
      andConditions.push({ $or: dateOr });
    } else if (fechaInicio && fechaFin) {
      const [ys, ms, ds] = fechaInicio.split('-').map(Number);
      const [ye, me, de] = fechaFin.split('-').map(Number);
      const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
      const end = new Date(ye, me - 1, de, 23, 59, 59, 999);
      const dateOr = [ { createdAt: { $gte: start, $lte: end } } ];
      andConditions.push({ $or: dateOr });
    }

    const query = andConditions.length ? { $and: andConditions } : {};

    const collections = await db.listCollections().toArray();
    const names = collections.map(c => c.name).filter(n => /^costumers(_|$)/i.test(n));
    const result = {};

    for (const n of names) {
      try {
        const col = db.collection(n);
        const cnt = await col.countDocuments(query);
        result[n] = cnt;
      } catch (e) {
        result[n] = { error: e.message };
      }
    }

    // Intentar TEAM_LINEAS si existe
    try {
      const dbTL = getDbFor('TEAM_LINEAS');
      if (dbTL) {
        const cols = await dbTL.listCollections().toArray();
        const tlCounts = {};
        for (const c of cols) {
          try {
            tlCounts[c.name] = await dbTL.collection(c.name).countDocuments(query);
          } catch (e) { tlCounts[c.name] = { error: e.message }; }
        }
        return res.json({ success: true, collections: result, team_lineas: tlCounts, queryUsed: query });
      }
    } catch (e) {
      // ignore
    }

    return res.json({ success: true, collections: result, queryUsed: query });
  } catch (error) {
    console.error('[API /leads/collection-counts] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint público temporal (sin auth) para diagnóstico rápido en entorno local
router.get('/leads/collection-counts-public', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'No DB' });

    const { month, fechaInicio, fechaFin } = req.query;
    let andConditions = [];

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const dateStrings = [];
      const dateRegexes = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const d = String(day).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        dateStrings.push(`${y}-${mm}-${d}`);
        dateStrings.push(`${d}/${mm}/${y}`);
        const dateObj = new Date(y, m - 1, day);
        dateRegexes.push(new RegExp(`^${dateObj.toDateString()}`, 'i'));
      }
      const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(y, m - 1, daysInMonth, 23, 59, 59, 999);
      const dateOr = [ { dia_venta: { $in: dateStrings } }, { createdAt: { $gte: monthStart, $lte: monthEnd } } ];
      dateRegexes.forEach(r => dateOr.push({ dia_venta: { $regex: r.source, $options: 'i' } }));
      andConditions.push({ $or: dateOr });
    } else if (fechaInicio && fechaFin) {
      const [ys, ms, ds] = fechaInicio.split('-').map(Number);
      const [ye, me, de] = fechaFin.split('-').map(Number);
      const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
      const end = new Date(ye, me - 1, de, 23, 59, 59, 999);
      const dateOr = [ { createdAt: { $gte: start, $lte: end } } ];
      andConditions.push({ $or: dateOr });
    }

    const query = andConditions.length ? { $and: andConditions } : {};

    const collections = await db.listCollections().toArray();
    const names = collections.map(c => c.name).filter(n => /^costumers(_|$)/i.test(n));
    const result = {};
    for (const n of names) {
      try { result[n] = await db.collection(n).countDocuments(query); } catch (e) { result[n] = { error: e.message }; }
    }
    try {
      const dbTL = getDbFor('TEAM_LINEAS');
      if (dbTL) {
        const cols = await dbTL.listCollections().toArray();
        const tlCounts = {};
        for (const c of cols) { try { tlCounts[c.name] = await dbTL.collection(c.name).countDocuments(query); } catch (e) { tlCounts[c.name] = { error: e.message }; } }
        return res.json({ success: true, collections: result, team_lineas: tlCounts, queryUsed: query });
      }
    } catch (e) { /* ignore */ }
    return res.json({ success: true, collections: result, queryUsed: query });
  } catch (error) {
    console.error('[API /leads/collection-counts-public] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/estadisticas/leads-dashboard
 * @desc Obtener datos pre-agrupados para dashboard de estadísticas
 * @access Private
 */
router.get('/estadisticas/leads-dashboard', protect, async (req, res) => {
  try {
    // 1. Validaciones iniciales
    const { fechaInicio, fechaFin } = req.query;
    const user = req.user;
    const role = (user?.role || '').toLowerCase();

    if (!user?.username) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      unifiedAvailable = Array.isArray(u) && u.length > 0;
    } catch (_) {}

    // 2. Construir filtros
    let filter = {};
    if (role === 'agente' || role === 'agent') {
      const name = user.username || user.name || user.fullName || user.usuario?.name || '';
      filter = { $or: [{ agenteNombre: name }, { agente: name }, { usuario: name }] };
    } else if (role === 'supervisor') {
      filter = { $or: [{ supervisor: user.username }, { team: user.team }] };
    }

    // 3. Filtro de fechas
    const startUtc = new Date(fechaInicio);
    const endUtc = new Date(fechaFin);
    endUtc.setHours(23, 59, 59, 999);

    const dateFilter = { dia_venta: { $gte: startUtc.toISOString(), $lte: endUtc.toISOString() } };

    // 4. Pipeline optimizado
    const collection = (preferUnified && unifiedAvailable)
      ? db.collection(unifiedCollectionName)
      : db.collection('costumers');
    const pipeline = [
      { $match: { $and: [filter, dateFilter] } },
      { $addFields: {
        equipo: { $ifNull: ['$supervisor', '$team'] },
        servicio: { $ifNull: ['$servicios_texto', { $ifNull: ['$tipo_servicios', '$tipo_servicio'] }] },
        isActiva: {
          $cond: [
            { $regexMatch: { 
              input: { $ifNull: ['$status', ''] }, 
              regex: /completed|completad|finaliz|vendid|vendido|activad|activa/i 
            }},
            1,
            0
          ]
        }
      }},
      { $facet: {
        porDia: [
          { $group: {
            _id: '$dia_venta',
            total: { $sum: 1 },
            activas: { $sum: '$isActiva' },
            icon: { $sum: { $cond: [{ $regexMatch: { input: '$mercado', regex: /ICON/i } }, 1, 0] } },
            bamo: { $sum: { $cond: [{ $regexMatch: { input: '$mercado', regex: /BAMO/i } }, 1, 0] } }
          }},
          { $sort: { _id: 1 } }
        ],
        porProducto: [
          { $group: {
            _id: '$servicio',
            total: { $sum: 1 },
            activas: { $sum: '$isActiva' }
          }},
          { $sort: { total: -1 } }
        ],
        porEquipo: [
          { $group: {
            _id: '$equipo',
            total: { $sum: 1 },
            activas: { $sum: '$isActiva' },
            icon: { $sum: { $cond: [{ $regexMatch: { input: '$mercado', regex: /ICON/i } }, 1, 0] } },
            bamo: { $sum: { $cond: [{ $regexMatch: { input: '$mercado', regex: /BAMO/i } }, 1, 0] } }
          }},
          { $sort: { _id: 1 } }
        ],
        leads: [
          { $project: {
            _id: 1,
            equipo: 1,
            agente: { $ifNull: ['$agenteNombre', '$agente'] },
            servicio: 1,
            mercado: 1,
            status: 1,
            dia_venta: 1
          }}
        ]
      }}];

    // 5. Ejecutar pipeline y procesar Team Lineas
    const [result] = await collection.aggregate(pipeline).toArray();

    if (role === 'admin' || (role === 'supervisor' && user.team?.toLowerCase().includes('lineas'))) {
      const dbTL = getDbFor('TEAM_LINEAS');
      if (!dbTL) {
        console.warn('[API] DB TEAM_LINEAS no disponible');
        return res.json({ success: true, data: result });
      }

      const usersCol = db.collection('users');
      const supervisores = await usersCol.find({ role: 'supervisor', team: /lineas/i }).toArray();

      const promises = supervisores.map(async (supervisor) => {
        const agents = await usersCol.find({ supervisor: supervisor.username }).toArray();
        const agentPromises = agents.map(async (agent) => {
          const col = dbTL.collection(__normName(agent.username));
          const agentData = await col.find({}).toArray();
          return {
            total: agentData.length,
            activas: agentData.filter(d => d.status?.toLowerCase().includes('complet')).length
          };
        });

        const agentResults = await Promise.all(agentPromises);
        const teamData = agentResults.reduce((acc, curr) => ({
          total: acc.total + curr.total,
          activas: acc.activas + curr.activas
        }), { total: 0, activas: 0 });

        if (result.porEquipo) {
          result.porEquipo.push({
            _id: supervisor.username,
            total: teamData.total,
            activas: teamData.activas,
            icon: teamData.total,
            bamo: 0
          });
        }
      });

      await Promise.all(promises);
    }

    // 6. Enviar respuesta
    res.json({ success: true, data: result });

  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

/**
 * @route PUT /api/leads/:id/status
 * @desc Actualizar el estado de un lead
 * @access Private
 */
router.put('/leads/:id/status', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      unifiedAvailable = Array.isArray(u) && u.length > 0;
    } catch (_) {}

    const { id: recordId } = req.params;
    const { status: newStatus } = req.body || {};
    if (!newStatus) {
      return res.status(400).json({ success: false, message: 'status requerido' });
    }

    // Preferir colección unificada cuando exista; legacy=1 mantiene búsqueda multi-colección.
    let updated = false;
    let updatedCollection = null;
    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }

    // Candidate filters to try: by ObjectId or by string id field
    const tryFiltersBase = objId ? [{ _id: objId }, { _id: recordId }, { id: recordId }] : [{ _id: recordId }, { id: recordId }];
    // Añadir filtros alternativos comunes (id_cliente, leadId, clienteId, etc.)
    const altKeys = ['leadId','lead_id','id_cliente','clienteId','cliente_id','clientId','client_id','cliente','idCliente'];
    const tryFilters = tryFiltersBase.concat(altKeys.map(k => ({ [k]: recordId })));

    // Primero probar en colección unificada si existe (y no es legacy)
    if (preferUnified && unifiedAvailable) {
      try {
        const unifiedCol = db.collection(unifiedCollectionName);
        for (const f of tryFilters) {
          try {
            const r = await unifiedCol.updateOne(f, { $set: { status: newStatus } });
            if (r && r.matchedCount && r.matchedCount > 0) {
              updated = true; updatedCollection = unifiedCollectionName; break;
            }
          } catch (innerE) {
            console.warn('[API UPDATE STATUS] unified.updateOne error with filter', f, innerE?.message || innerE);
          }
        }
      } catch (e) {
        console.warn('[API UPDATE STATUS] unified collection check failed:', e?.message || e);
      }
    }

    // En legacy o si no existe unified, probar primero costumers
    if (!updated && (!preferUnified || !unifiedAvailable)) {
      try {
        const primaryCol = db.collection('costumers');
        for (const f of tryFilters) {
          try {
            const r = await primaryCol.updateOne(f, { $set: { status: newStatus } });
            console.log('[API UPDATE STATUS] Tried primary costumers filter', f, 'matched:', r && r.matchedCount ? r.matchedCount : 0);
            if (r && r.matchedCount && r.matchedCount > 0) {
              updated = true; updatedCollection = 'costumers'; break;
            }
          } catch (innerE) {
            console.warn('[API UPDATE STATUS] primaryCol.updateOne error with filter', f, innerE?.message || innerE);
          }
        }
      } catch (e) {
        console.warn('[API UPDATE STATUS] primary collection check failed:', e?.message || e);
      }
    }

    if (!updated && (!preferUnified || !unifiedAvailable)) {
      // Search other collections matching costumers*
      const collections = await db.listCollections().toArray();
      const colNames = collections.map(c => c.name).filter(name => /^costumers(_|$)/i.test(name));
      for (const colName of colNames) {
        try {
          const col = db.collection(colName);
          for (const f of tryFilters) {
            try {
              const r = await col.updateOne(f, { $set: { status: newStatus } });
              console.log('[API UPDATE STATUS] Tried', colName, 'filter', f, 'matched:', r && r.matchedCount ? r.matchedCount : 0);
              if (r && r.matchedCount && r.matchedCount > 0) {
                updated = true; updatedCollection = colName; break;
              }
            } catch (innerE) {
              console.warn('[API UPDATE STATUS] updateOne error in', colName, 'filter', f, innerE?.message || innerE);
            }
          }
        } catch (e) {
          console.warn('[API UPDATE STATUS] Error accessing collection', colName, e?.message || e);
        }
        if (updated) break;
      }
    }

    if (!updated) {
      console.warn('[API UPDATE STATUS] No collection matched for id:', recordId, 'triedFiltersCount:', tryFilters.length);
      // Devolver 404 con hint corto (no exponer datos internos)
      return res.status(404).json({ success: false, message: 'Cliente no encontrado', triedFilters: tryFilters.length });
    }

    return res.json({ success: true, message: 'Status actualizado', data: { id: recordId, status: newStatus, collection: updatedCollection } });
  } catch (error) {
    console.error('[API UPDATE STATUS] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

/**
 * @route GET /api/leads/:id
 * @desc Obtener un lead por ID (busca en TODAS las colecciones costumers*)
 * @access Private
 */
router.get('/leads/:id', protect, async (req, res, next) => {
  try {
    const { id: recordId } = req.params;
    
    // Validar que el ID parezca un ObjectId válido (24 caracteres hex)
    // Si no lo es, pasar al siguiente manejador (para rutas como /leads/check-dates)
    if (!recordId || !/^[a-fA-F0-9]{24}$/.test(recordId)) {
      return next();
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    
    // Preferir colección unificada cuando exista; legacy=1 mantiene búsqueda multi-colección.
    const costumersCollections = (preferUnified && unifiedAvailable)
      ? [unifiedCollectionName]
      : (await db.listCollections().toArray()).map(c => c.name).filter(name => /^costumers(_|$)/i.test(name));

    console.log(`[GET /leads/:id] Buscando lead ${recordId} en ${costumersCollections.length} colecciones`, { preferUnified, unifiedAvailable });
    
    let lead = null;
    let foundInCollection = null;
    
    // Buscar en cada colección
    for (const colName of costumersCollections) {
      const collection = db.collection(colName);
      
      // Intenta buscar por ObjectId primero
      if (objId) {
        lead = await collection.findOne({ _id: objId });
        if (lead) {
          foundInCollection = colName;
          console.log(`[GET /leads/:id] Lead encontrado en ${colName} por ObjectId`);
          break;
        }
      }
      
      // Luego por string ID
      if (!lead) {
        lead = await collection.findOne({ _id: recordId });
        if (lead) {
          foundInCollection = colName;
          console.log(`[GET /leads/:id] Lead encontrado en ${colName} por string ID`);
          break;
        }
      }
      
      // También buscar por campo 'id' (por si acaso)
      if (!lead) {
        lead = await collection.findOne({ id: recordId });
        if (lead) {
          foundInCollection = colName;
          console.log(`[GET /leads/:id] Lead encontrado en ${colName} por campo 'id'`);
          break;
        }
      }
    }

    if (!lead) {
      console.warn(`[GET /leads/:id] Lead ${recordId} no encontrado en ninguna colección`);
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    console.log(`[GET /leads/:id] Lead encontrado en ${foundInCollection}, tiene notas:`, Array.isArray(lead.notas) ? lead.notas.length : 'no');
    return res.json({ success: true, data: lead, lead: lead, foundInCollection });
  } catch (error) {
    console.error('[API GET LEAD] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

/**
 * @route PUT /api/leads/:id
 * @desc Actualizar un lead completo
 * @access Private
 */
router.put('/leads/:id', protect, async (req, res, next) => {
  try {
    const { id: recordId } = req.params;
    
    console.log('[PUT /leads/:id] ID recibido:', recordId);
    console.log('[PUT /leads/:id] Body:', JSON.stringify(req.body).substring(0, 500));
    
    // Validar que el ID parezca un ObjectId válido (24 caracteres hex)
    if (!recordId || !/^[a-fA-F0-9]{24}$/.test(recordId)) {
      console.log('[PUT /leads/:id] ID inválido, pasando al siguiente handler');
      return next();
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const updateData = req.body || {};

    // Remover campos que no deben actualizarse
    delete updateData._id;
    delete updateData.id;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'No hay datos para actualizar' });
    }

    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    
    // Preferir colección unificada cuando exista; legacy=1 mantiene búsqueda multi-colección.
    const costumersCollections = (preferUnified && unifiedAvailable)
      ? [unifiedCollectionName]
      : (await db.listCollections().toArray()).map(c => c.name).filter(name => /^costumers(_|$)/i.test(name));
    
    let result = null;
    let updatedCollection = null;
    
    for (const colName of costumersCollections) {
      const collection = db.collection(colName);
      
      // Intentar actualizar por ObjectId primero
      if (objId) {
        result = await collection.updateOne({ _id: objId }, { $set: updateData });
        if (result && result.matchedCount > 0) {
          updatedCollection = colName;
          console.log(`[PUT /leads/:id] Lead actualizado en ${colName} por ObjectId`);
          break;
        }
      }
      
      // Si no se encontró, intentar por string ID
      if (!result || result.matchedCount === 0) {
        result = await collection.updateOne({ _id: recordId }, { $set: updateData });
        if (result && result.matchedCount > 0) {
          updatedCollection = colName;
          console.log(`[PUT /leads/:id] Lead actualizado en ${colName} por string ID`);
          break;
        }
      }
    }

    if (!result || result.matchedCount === 0) {
      console.log('[PUT /leads/:id] Lead no encontrado en ninguna colección');
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    // Emitir notificación Socket.io si se actualizaron notas
    if (updateData.notas && global.io) {
      try {
        // Obtener info del lead para saber quién es el dueño
        const collection = db.collection(updatedCollection || 'costumers');
        const lead = await collection.findOne(objId ? { _id: objId } : { _id: recordId });
        if (lead) {
          const ownerId = lead.agenteId || lead.agente || lead.odigo || lead.createdBy;
          const clientName = lead.nombre_cliente || lead.nombre || 'Cliente';
          const author = req.user?.username || req.user?.name || 'Usuario';
          
          // Si quien edita NO es el dueño, notificar al dueño
          const currentUserId = req.user?.agenteId || req.user?.odigo || req.user?.username;
          if (ownerId && ownerId !== currentUserId) {
            global.io.to(`user:${ownerId}`).emit('note-added', {
              leadId: recordId,
              clientName,
              author,
              timestamp: new Date().toISOString()
            });
            console.log(`[Socket.io] Notificación enviada a ${ownerId}`);
          }
        }
      } catch (socketErr) {
        console.error('[Socket.io] Error al emitir notificación:', socketErr.message);
      }
    }

    console.log('[PUT /leads/:id] Actualizado correctamente en', updatedCollection, '. matchedCount:', result.matchedCount, 'modifiedCount:', result.modifiedCount);
    return res.json({ 
      success: true, 
      message: 'Lead actualizado correctamente', 
      data: { id: recordId, ...updateData },
      updatedCollection
    });
  } catch (error) {
    console.error('[API UPDATE LEAD] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

/**
 * @route DELETE /api/leads/:id
 * @desc Eliminar un lead (solo admin y backoffice)
 * @access Private (admin/backoffice only)
 */
router.delete('/leads/:id', protect, async (req, res, next) => {
  try {
    const { id: recordId } = req.params;
    
    // Validar que el ID parezca un ObjectId válido (24 caracteres hex)
    if (!recordId || !/^[a-fA-F0-9]{24}$/.test(recordId)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    // Verificar permisos: solo admin y backoffice pueden eliminar
    const user = req.user;
    const role = (user?.role || '').toLowerCase();
    const allowedRoles = ['admin', 'administrador', 'administrator', 'backoffice', 'b.o', 'b:o', 'bo'];
    
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'No tienes permisos para eliminar registros. Solo Administradores y Backoffice pueden hacerlo.' 
      });
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const collection = (preferUnified && unifiedAvailable) ? db.collection(unifiedCollectionName) : db.collection('costumers');
    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    
    // Intentar eliminar por ObjectId primero
    let result = null;
    if (objId) {
      result = await collection.deleteOne({ _id: objId });
    }
    
    // Si no se encontró, intentar por string
    if (!result || result.deletedCount === 0) {
      result = await collection.deleteOne({ _id: recordId });
    }

    if (!result || result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    console.log(`[API DELETE LEAD] Lead ${recordId} eliminado por usuario ${user?.username || user?.name || 'desconocido'} (${role})`);
    
    return res.json({ 
      success: true, 
      message: 'Lead eliminado correctamente', 
      data: { id: recordId } 
    });
  } catch (error) {
    console.error('[API DELETE LEAD] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

router.get('/lineas-team', protect, async (req, res) => {
  try {
    const user = req.user;
    const username = user?.username || '';
    const role = (user?.role || '').toLowerCase();
    const team = (user?.team || '').toLowerCase();
    
    console.log('[API /lineas-team] Usuario:', username, 'Rol:', role, 'Team:', team);
    
    const isTeamLineas = team.includes('lineas') || role === 'lineas-agentes' || role === 'supervisor team lineas' || (role === 'supervisor' && team.includes('lineas')) || role === 'admin' || role === 'administrador';
    if (!isTeamLineas) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }
    
    // Conectar a la base de datos TEAM_LINEAS
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      console.error('[API /lineas-team] No se pudo conectar a TEAM_LINEAS');
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }
    
    // Convertir nombre de usuario a nombre de colección (ej: "Edward Ramirez" -> "EDWARD_RAMIREZ")
    const collectionName = username.toUpperCase().replace(/\s+/g, '_');
    console.log('[API /lineas-team] Buscando en colección:', collectionName);
    
    let leads = [];
    
    if (role === 'admin' || role === 'administrador') {
      // Admin ve todas las colecciones
      const collections = await db.listCollections().toArray();
      console.log('[API /lineas-team] Colecciones disponibles:', collections.map(c => c.name));
      
      for (const coll of collections) {
        const docs = await db.collection(coll.name).find({}).toArray();
        leads = leads.concat(docs.map(d => ({ ...d, _collectionName: coll.name })));
      }
    } else if (role === 'supervisor' || role === 'supervisor team lineas') {
      // Supervisor ve todas las colecciones de su equipo
      const collections = await db.listCollections().toArray();
      for (const coll of collections) {
        const docs = await db.collection(coll.name).find({}).toArray();
        leads = leads.concat(docs.map(d => ({ ...d, _collectionName: coll.name })));
      }
    } else {
      // Agente ve solo su colección
      const collection = db.collection(collectionName);
      leads = await collection.find({}).toArray();
    }
    
    console.log('[API /lineas-team] Leads encontrados:', leads.length);
    res.json({ success: true, data: leads });
  } catch (error) {
    console.error('[API /lineas-team] Error:', error.message);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
});

router.post('/seed-lineas-leads', protect, async (req, res) => {
  try {
    const user = req.user;
    const role = (user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'administrador') {
      return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para administradores.' });
    }
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB de Team Lineas' });
    }
    const leadsCollection = db.collection('team_lineas_leads');
    const agentsBySupervisor = {
      'JONATHAN F': [{ username: 'VICTOR HURTADO' }, { username: 'EDWARD RAMIREZ' }, { username: 'CRISTIAN RIVERA' }],
      'LUIS G': [{ username: 'DANIEL DEL CID' }, { username: 'FERNANDO BELTRAN' }, { username: 'KARLA RODRIGUEZ' }, { username: 'JOCELYN REYES' }, { username: 'JONATHAN GARCIA' }, { username: 'NANCY LOPEZ' }]
    };
    const supervisorsWithAgents = Object.keys(agentsBySupervisor);
    const leadsPlan = [];
    for (let i = 0; i < 10; i++) {
      const supervisorName = supervisorsWithAgents[i % supervisorsWithAgents.length];
      const agents = agentsBySupervisor[supervisorName];
      const agent = agents[i % agents.length];
      const lead = {
        nombre_cliente: `CLIENTE DE PRUEBA ${i + 1}`,
        telefono_principal: `555-010${i}`,
        numero_cuenta: `ACC-TL-00${i}`,
        status: i % 3 === 0 ? 'completed' : 'pending',
        supervisor: supervisorName,
        agenteAsignado: agent.username,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      leadsPlan.push(lead);
    }
    await leadsCollection.deleteMany({});
    await leadsCollection.insertMany(leadsPlan);
    res.json({ success: true, message: `${leadsPlan.length} leads de prueba creados.` });
  } catch (error) {
    console.error('[API /seed-lineas-leads] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor al crear leads.' });
  }
});

// Endpoint para obtener la facturación de un mes específico
router.get('/facturacion/:ano/:mes', protect, async (req, res) => {
  try {
    const { ano, mes } = req.params;
    const db = getDb();
    if (!db) {
      return res.status(500).json({ ok: false, message: 'Error de conexión a DB' });
    }
    const facturacion = await db.collection('Facturacion').find({ anio: parseInt(ano), mes: parseInt(mes) }).toArray();
    res.json({ ok: true, data: facturacion });
  } catch (error) {
    console.error('Error en GET /facturacion/:ano/:mes:', error);
    res.status(500).json({ ok: false, message: 'Error interno del servidor' });
  }
});

// Endpoint para obtener los totales anuales de facturación
router.get('/facturacion/anual/:ano', protect, async (req, res) => {
  try {
    const { ano } = req.params;
    const db = getDb();
    if (!db) {
      return res.status(500).json({ ok: false, message: 'Error de conexión a DB' });
    }j
    const pipeline = [
      { $match: { anio: parseInt(ano) } },
      { $addFields: {
        totalDiaStr: { $arrayElemAt: ["$campos", 9] }
      }},
      { $addFields: {
        cleanedTotalStr: { $replaceAll: { input: { $replaceAll: { input: "$totalDiaStr", find: "$", replacement: "" } }, find: ",", replacement: "" } }
      }},
      { $addFields: {
        totalDiaNum: { $convert: { input: "$cleanedTotalStr", to: "double", onError: 0.0, onNull: 0.0 } }
      }},
      { $group: { _id: "$mes", total: { $sum: "$totalDiaNum" } } }
    ];
    const resultados = await db.collection('Facturacion').aggregate(pipeline).toArray();
    const totalesPorMes = Array(12).fill(0);
    resultados.forEach(r => {
      if (r._id >= 1 && r._id <= 12) {
        totalesPorMes[r._id - 1] = r.total;
      }
    });
    res.json({ ok: true, totalesPorMes });
  } catch (error) {
    console.error('Error en GET /facturacion/anual/:ano:', error);
    res.status(500).json({ ok: false, message: 'Error interno del servidor' });
  }
});

// Endpoint para guardar/actualizar un registro de facturación
router.post('/facturacion', protect, async (req, res) => {
  try {
    const { fecha, campos } = req.body;
    const db = getDb();
    if (!db) {
      return res.status(500).json({ ok: false, message: 'Error de conexión a DB' });
    }
    const [dia, mes, anio] = fecha.split('/').map(Number);
    const totalDia = parseFloat(campos[9]) || 0;

    const result = await db.collection('Facturacion').updateOne(
      { anio, mes, dia },
      { $set: { fecha, campos, totalDia, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, result });
  } catch (error) {
    console.error('Error en POST /facturacion:', error);
    res.status(500).json({ ok: false, message: 'Error interno del servidor' });
  }
});

// Endpoint de diagnóstico: revisar fechas en la base de datos (sin protección temporal)
router.get('/leads/check-dates', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'DB no disponible' });
    }
    
    const collection = db.collection('costumers');
    
    // Obtener todas las ventas de octubre y noviembre 2025
    const ventas = await collection.find({
      $or: [
        { dia_venta: { $regex: /^2025-10/ } },
        { dia_venta: { $regex: /^2025-11/ } },
        { dia_venta: { $regex: /^[0-9]{2}\/10\/2025/ } },
        { dia_venta: { $regex: /^[0-9]{2}\/11\/2025/ } },
        { createdAt: { $gte: new Date('2025-10-01'), $lte: new Date('2025-11-30T23:59:59') } }
      ]
    }).limit(200).toArray();
    
    // Agrupar por fecha
    const porFecha = {};
    ventas.forEach(lead => {
      const fecha = lead.dia_venta || lead.fecha_contratacion || lead.createdAt || 'sin_fecha';
      const fechaStr = typeof fecha === 'string' ? fecha : fecha.toISOString();
      if (!porFecha[fechaStr]) {
        porFecha[fechaStr] = [];
      }
      porFecha[fechaStr].push({
        nombre: lead.nombre_cliente,
        agente: lead.agente || lead.agenteNombre,
        createdAt: lead.createdAt
      });
    });
    
    // Ordenar por fecha
    const fechasOrdenadas = Object.keys(porFecha).sort();
    
    res.json({
      success: true,
      total: ventas.length,
      fechasEncontradas: fechasOrdenadas.length,
      porFecha: fechasOrdenadas.reduce((acc, fecha) => {
        acc[fecha] = {
          cantidad: porFecha[fecha].length,
          ejemplos: porFecha[fecha].slice(0, 3)
        };
        return acc;
      }, {}),
      hoy: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error en check-dates:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route POST /api/fix-agent-names
 * @desc Normalizar nombres de agentes duplicados (ej: Alejandramelara -> Alejandra Melara)
 * @access Private (admin only)
 */
// Endpoint para verificar conteos por agente (MENSUAL)
// Verificar registros específicos de un agente
router.get('/verify-agent-detail', async (req, res) => {
  try {
    const db = getDb();
    const agente = req.query.agente || 'Lucia Ferman';
    const mes = req.query.mes || '2025-11';
    const [year, month] = mes.split('-').map(Number);
    
    const collection = db.collection('costumers');
    
    // Buscar todos los registros del agente
    const regexAgente = new RegExp(agente.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const allRecords = await collection.find({
      $or: [
        { agenteNombre: regexAgente },
        { agente: regexAgente },
        { createdBy: regexAgente }
      ]
    }).toArray();
    
    // Filtrar por mes
    const mesRecords = allRecords.filter(r => {
      const dv = r.dia_venta || '';
      if (dv.match(/^\d{4}-\d{2}/)) {
        const [y, m] = dv.split('-').map(Number);
        return y === year && m === month;
      }
      return false;
    });
    
    res.json({
      success: true,
      agente,
      mes,
      totalTodosLosMeses: allRecords.length,
      totalMesActual: mesRecords.length,
      registrosMes: mesRecords.map(r => ({
        _id: r._id,
        nombre_cliente: r.nombre_cliente,
        dia_venta: r.dia_venta,
        status: r.status,
        team: r.team,
        supervisor: r.supervisor,
        // Campos de agente para diagnóstico
        agente: r.agente,
        agenteNombre: r.agenteNombre,
        agenteId: r.agenteId,
        createdBy: r.createdBy
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/verify-agent-counts', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const collection = db.collection('costumers');
    
    // Mes actual: noviembre 2025
    const mesActual = req.query.mes || '2025-11';
    const [year, month] = mesActual.split('-').map(Number);
    
    // Filtro por mes en dia_venta
    const mesFilter = {
      $or: [
        { dia_venta: { $regex: `^${year}-${String(month).padStart(2, '0')}` } },
        { dia_venta: { $regex: `^[0-9]{2}/${String(month).padStart(2, '0')}/${year}` } }
      ]
    };
    
    // Contar por agenteNombre para el mes
    const agenteNombreCounts = await collection.aggregate([
      { $match: mesFilter },
      { $group: { _id: "$agenteNombre", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    // Contar por team/supervisor
    const teamCounts = await collection.aggregate([
      { $match: mesFilter },
      { $group: { _id: "$team", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    // Total del mes
    const totalMes = await collection.countDocuments(mesFilter);

    res.json({
      success: true,
      mes: mesActual,
      totalMes,
      porAgenteNombre: agenteNombreCounts,
      porTeam: teamCounts
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Corregir team de Jonathan Morales (de ROBERTO a MARISOL)
router.get('/fix-jonathan-team', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const collection = db.collection('costumers');
    
    // Buscar registros de Jonathan Morales
    const jonathanRegex = /jonathan\s*morales/i;
    
    // Actualizar team y supervisor a MARISOL
    const result = await collection.updateMany(
      {
        $or: [
          { agenteNombre: jonathanRegex },
          { agente: jonathanRegex },
          { createdBy: jonathanRegex }
        ]
      },
      {
        $set: {
          team: 'MARISOL',
          supervisor: 'MARISOL',
          equipo: 'MARISOL'
        }
      }
    );

    res.json({
      success: true,
      message: `Jonathan Morales movido al team MARISOL`,
      registrosActualizados: result.modifiedCount
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/fix-agent-names', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    // Mapeo de nombres incorrectos -> nombre correcto
    const NAME_FIXES = {
      'Alejandramelara': 'Alejandra Melara',
      'alejandramelara': 'Alejandra Melara',
      'Melissaescobar': 'Melissa Escobar',
      'melissaescobar': 'Melissa Escobar',
      'Michelleleiva': 'Michelle Leiva',
      'michelleleiva': 'Michelle Leiva',
      'Eduardor': 'Eduardo R',
      'eduardor': 'Eduardo R',
      'abigail.bernal': 'Abigail Bernal',
      'Abigail.Bernal': 'Abigail Bernal',
      'jorge.segovia': 'Jorge Segovia',
      'Jorge.Segovia': 'Jorge Segovia',
      'JORGE.SEGOVIA': 'Jorge Segovia',
      'nicole.cruz': 'Nicole Cruz',
      'Nicole.Cruz': 'Nicole Cruz',
      'mIguel Nunez': 'Miguel Nunez',
      'johanna Santana': 'Johanna Santana',
      'Fabricio Panameno': 'Fabricio Panameño',
    };

    const AGENT_FIELDS = ['agente', 'agenteNombre', 'createdBy', 'usuario', 'vendedor', 'asignadoA', 'assignedTo'];
    const collection = db.collection('costumers');
    
    const results = [];
    let totalUpdated = 0;

    for (const [wrongName, correctName] of Object.entries(NAME_FIXES)) {
      for (const field of AGENT_FIELDS) {
        // Buscar con regex case-insensitive
        const regexQuery = new RegExp(`^${wrongName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const result = await collection.updateMany(
          { [field]: regexQuery },
          { $set: { [field]: correctName } }
        );
        
        if (result.modifiedCount > 0) {
          results.push({ field, from: wrongName, to: correctName, count: result.modifiedCount });
          totalUpdated += result.modifiedCount;
        }
      }
    }

    console.log(`[FIX NAMES] Total actualizados: ${totalUpdated}`);
    res.json({ 
      success: true, 
      message: `${totalUpdated} registros actualizados`,
      details: results
    });

  } catch (error) {
    console.error('Error en fix-agent-names:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================
// Gestión de usuarios (solo admin)
// ============================

// Listar usuarios básicos para administración (sin password)
router.get('/users/admin-list', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const role = (req.user?.role || '').toLowerCase();
    const allowedAdminRoles = ['admin', 'administrador', 'administrativo', 'administrador general'];
    if (!allowedAdminRoles.includes(role)) {
      return res.status(403).json({ success: false, message: 'No autorizado para listar usuarios' });
    }

    const users = await db.collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ username: 1 })
      .toArray();

    const sanitized = users.map(u => ({
      id: u._id?.toString() || null,
      username: u.username || null,
      name: u.name || u.fullName || u.nombre || u.username || null,
      email: u.email || null,
      role: u.role || null,
      team: u.team || null,
      supervisor: u.supervisor || null
    }));

    return res.json({ success: true, users: sanitized, agents: sanitized });
  } catch (error) {
    console.error('[ADMIN USERS LIST] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener usuarios', error: error.message });
  }
});

// Actualizar rol y/o team de un usuario existente (y renombrar team si pasa a supervisor)
router.put('/users/:id/role', protect, async (req, res) => {
  try {
    console.log('[ROUTE] PUT /api/users/:id/role called', { params: req.params, bodyPreview: req.body && Object.keys(req.body).length ? Object.fromEntries(Object.entries(req.body).slice(0,5)) : {}, user: req.user && req.user.username });
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const userRole = (req.user?.role || '').toLowerCase();
    console.log('[USERS UPDATE ROLE] req.user.role normalized:', userRole);
    const allowedAdminRoles = ['admin', 'administrador', 'administrativo', 'administrador general'];
    if (!allowedAdminRoles.includes(userRole)) {
      console.warn('[USERS UPDATE ROLE] userRole not allowed:', userRole);
      return res.status(403).json({ success: false, message: 'No autorizado para actualizar usuarios' });
    }

    const userId = req.params.id;
    const { role, team } = req.body || {};

    if (!userId) {
      console.warn('[USERS UPDATE ROLE] Missing userId in params');
      return res.status(400).json({ success: false, message: 'ID de usuario requerido' });
    }
    if (!role) {
      console.warn('[USERS UPDATE ROLE] Missing role in body');
      return res.status(400).json({ success: false, message: 'Nuevo rol requerido' });
    }

    const allowedRoles = ['admin', 'Administrador', 'administrador', 'Administrativo', 'supervisor', 'vendedor', 'usuario', 'backoffice'];
    console.log('[USERS UPDATE ROLE] requested new role:', role);
    if (!allowedRoles.includes(role)) {
      console.warn('[USERS UPDATE ROLE] requested role not allowed:', role);
      return res.status(400).json({ success: false, message: 'Rol no permitido' });
    }

    const usersColl = db.collection('users');

    let objectId = null;
    try {
      objectId = new ObjectId(String(userId));
    } catch {
      objectId = null;
    }

    const filter = objectId ? { _id: objectId } : { _id: String(userId) };

    // Obtener usuario actual antes de cambios para conocer su nombre y team actual
    console.log('[USERS UPDATE ROLE] about to findOne with filter:', filter);
    const currentUser = await usersColl.findOne(filter);
    console.log('[USERS UPDATE ROLE] findOne result present?', !!currentUser);
    console.log('[USERS UPDATE ROLE] filter used:', filter);
    if (!currentUser) {
      console.warn('[USERS UPDATE ROLE] Usuario no encontrado con filter:', filter);
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const now = new Date();
    let finalTeam = team || currentUser.team || null;

    const isSupervisorRole = String(role).toLowerCase().includes('supervisor');

    if (isSupervisorRole && finalTeam) {
      // Construir nuevo nombre de team basado en el nombre del supervisor
      const displayName = currentUser.name || currentUser.fullName || currentUser.nombre || currentUser.username || 'SUPERVISOR';
      const newTeamName = `TEAM ${displayName}`.toUpperCase();

      // Renombrar team para todos los usuarios que pertenecen a ese team
      const renameResult = await usersColl.updateMany(
        { team: finalTeam },
        {
          $set: {
            team: newTeamName,
            updatedAt: now,
            updatedBy: req.user?.username || 'system'
          }
        }
      );

      console.log('[USERS UPDATE ROLE] Team renombrado', {
        oldTeam: finalTeam,
        newTeam: newTeamName,
        modifiedCount: renameResult.modifiedCount
      });

      finalTeam = newTeamName;
    }

    const update = {
      $set: {
        role,
        team: finalTeam,
        updatedAt: now,
        updatedBy: req.user?.username || 'system'
      }
    };

    const result = await usersColl.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      projection: { password: 0 }
    });

    console.log('[USERS UPDATE ROLE] findOneAndUpdate raw result:', result && (result.value ? { id: result.value._id, username: result.value.username, role: result.value.role } : { value: !!result.value, lastErrorObject: result && result.lastErrorObject ? result.lastErrorObject : null }));

    // Algunos entornos/versión de driver pueden devolver el documento directamente
    // o devolver un objeto con la propiedad `value`. Si no hay `value`, intentar
    // obtener el documento actualizado con findOne antes de responder 404.
    let updatedUser = null;
    if (result && result.value) {
      updatedUser = result.value;
    } else if (result && result._id) {
      // En casos raros el resultado puede ser el documento mismo
      updatedUser = result;
    } else {
      // Intentar leer el documento actualizado desde la DB
      try {
        updatedUser = await usersColl.findOne(filter, { projection: { password: 0 } });
      } catch (e) {
        console.warn('[USERS UPDATE ROLE] Error buscando usuario tras update:', e.message || e);
        updatedUser = null;
      }
    }

    if (!updatedUser) {
      console.warn('[USERS UPDATE ROLE] Usuario no encontrado tras actualizar. findOneAndUpdate returned:', result);
      return res.status(404).json({ success: false, message: 'Usuario no encontrado tras actualizar' });
    }

    console.log('[USERS UPDATE ROLE] Usuario actualizado:', {
      id: updatedUser._id,
      username: updatedUser.username,
      role: updatedUser.role,
      team: updatedUser.team
    });

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('[USERS UPDATE ROLE] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar rol/team de usuario' });
  }
});

// Actualizar credenciales (username y/o password) de un usuario existente (solo Admins)
router.put('/users/:id/credentials', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const userRole = (req.user?.role || '').toLowerCase();
    const allowedAdminRoles = ['admin', 'administrador', 'administrativo', 'administrador general'];
    if (!allowedAdminRoles.includes(userRole)) {
      return res.status(403).json({ success: false, message: 'No autorizado para actualizar credenciales' });
    }

    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'ID de usuario requerido' });
    }

    const body = req.body || {};
    const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';

    if (!rawUsername && !rawPassword) {
      return res.status(400).json({ success: false, message: 'Proporciona un nuevo usuario o una nueva contraseña para continuar' });
    }

    const usersColl = db.collection('users');
    let objectId = null;
    try { objectId = new ObjectId(String(userId)); } catch { objectId = null; }
    const filter = objectId ? { _id: objectId } : { _id: String(userId) };

    const currentUser = await usersColl.findOne(filter);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const updateSet = {
      updatedAt: new Date(),
      updatedBy: req.user?.username || 'system'
    };

    let changed = false;
    let changedUsername = false;
    let changedPassword = false;

    const usernameCandidate = rawUsername;
    if (usernameCandidate) {
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(usernameCandidate)) {
        return res.status(400).json({ success: false, message: 'Nombre de usuario inválido. Usa de 3 a 32 caracteres alfanuméricos, punto, guion o guion bajo.' });
      }
      if (usernameCandidate !== currentUser.username) {
        const excludeId = currentUser._id instanceof ObjectId ? currentUser._id : String(currentUser._id);
        const usernameExists = await usersColl.findOne({
          username: usernameCandidate,
          _id: { $ne: excludeId }
        });
        if (usernameExists) {
          return res.status(409).json({ success: false, message: 'El nombre de usuario ya está en uso' });
        }
        updateSet.username = usernameCandidate;
        changed = true;
        changedUsername = true;
      }
    }

    if (rawPassword) {
      if (rawPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres' });
      }
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(rawPassword, salt);
      updateSet.password = hashed;
      updateSet.passwordUpdatedAt = new Date();
      changed = true;
      changedPassword = true;
    }

    if (!changed) {
      return res.status(400).json({ success: false, message: 'No hay cambios para aplicar' });
    }

    const updateResult = await usersColl.updateOne(filter, { $set: updateSet });
    if (!updateResult || updateResult.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const updatedUser = await usersColl.findOne(filter, { projection: { password: 0 } });
    const responseUser = updatedUser ? {
      id: updatedUser._id?.toString() || null,
      username: updatedUser.username || null,
      name: updatedUser.name || updatedUser.fullName || updatedUser.nombre || null,
      email: updatedUser.email || null,
      role: updatedUser.role || null,
      team: updatedUser.team || null,
      supervisor: updatedUser.supervisor || null
    } : {
      id: currentUser._id?.toString() || null,
      username: updateSet.username || currentUser.username || null
    };

    return res.json({
      success: true,
      message: 'Credenciales actualizadas correctamente',
      user: responseUser,
      updated: {
        username: changedUsername,
        password: changedPassword
      }
    });
  } catch (error) {
    console.error('[USERS UPDATE CREDENTIALS] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar credenciales de usuario' });
  }
});

// DELETE /api/users/:id -> Eliminar usuario (solo Admins)
// Nota: esta operación elimina SOLO el documento del usuario y NO toca leads/u otros documentos.
// Se requiere rol administrador.
router.delete('/users/:id', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'Error de conexión a DB' });

    const userRole = (req.user?.role || '').toLowerCase();
    const allowedAdminRoles = ['admin', 'administrador', 'administrativo', 'administrador general'];
    if (!allowedAdminRoles.includes(userRole)) {
      return res.status(403).json({ success: false, message: 'No autorizado para eliminar usuarios' });
    }

    const userId = req.params.id;
    if (!userId) return res.status(400).json({ success: false, message: 'ID de usuario requerido' });

    // Evitar que un admin se borre a sí mismo por accidente
    if (req.user && (req.user.id || req.user._id) && String(req.user.id || req.user._id) === String(userId)) {
      return res.status(400).json({ success: false, message: 'No puedes eliminar tu propia cuenta' });
    }

    const usersColl = db.collection('users');
    let objectId = null;
    try { objectId = new ObjectId(String(userId)); } catch { objectId = null; }
    const filter = objectId ? { _id: objectId } : { _id: String(userId) };

    const existing = await usersColl.findOne(filter);
    if (!existing) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    // Borrar solo el documento del usuario
    await usersColl.deleteOne(filter);

    console.log('[USERS DELETE] Usuario eliminado:', { id: userId, deletedBy: req.user?.username || 'system' });
    return res.json({ success: true, message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('[USERS DELETE] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
  }
});

// ========== ENDPOINT DE DIAGNÓSTICO TEMPORAL ==========
// GET /api/debug/search-lead/:id
// Búsqueda exhaustiva de un lead en todas las colecciones (para diagnosticar dónde está)
router.get('/debug/search-lead/:id', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'No DB connection' });

    const recordId = req.params.id;
    if (!recordId) return res.status(400).json({ success: false, message: 'ID required' });

    console.log('[DEBUG SEARCH] Buscando lead con id:', recordId);

    // Preparar filtros a probar
    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    const filters = objId
      ? [{ _id: objId }, { _id: recordId }, { id: recordId }]
      : [{ _id: recordId }, { id: recordId }];
    const altKeys = ['leadId','lead_id','id_cliente','clienteId','cliente_id','clientId','client_id','cliente','idCliente','numero_cuenta','id_cuenta'];
    filters.push(...altKeys.map(k => ({ [k]: recordId })));

    const results = {
      id: recordId,
      found: false,
      collection: null,
      document: null,
      searchedCollections: [],
      filtersTried: filters.length,
      details: []
    };

    // Listar todas las colecciones
    const collections = await db.listCollections().toArray();
    const colNames = collections.map(c => c.name);
    console.log('[DEBUG SEARCH] Colecciones disponibles:', colNames);

    // Buscar en todas las colecciones (costumers* primero, luego otras)
    const costumerCols = colNames.filter(name => /^costumers(_|$)/i.test(name));
    const otherCols = colNames.filter(name => !/^costumers(_|$)/i.test(name) && name !== 'users');
    const searchOrder = [...costumerCols, ...otherCols];

    for (const colName of searchOrder) {
      try {
        const col = db.collection(colName);
        results.searchedCollections.push(colName);

        for (const f of filters) {
          try {
            const found = await col.findOne(f);
            if (found) {
              results.found = true;
              results.collection = colName;
              results.document = {
                _id: found._id ? found._id.toString ? found._id.toString() : found._id : null,
                nombre_cliente: found.nombre_cliente || null,
                numero_cuenta: found.numero_cuenta || null,
                telefono_principal: found.telefono_principal || null,
                status: found.status || null,
                dia_venta: found.dia_venta || null,
                agente: found.agente || found.agenteNombre || null
              };
              results.details.push(`Encontrado en ${colName} con filtro ${JSON.stringify(f)}`);
              console.log('[DEBUG SEARCH] ✓ Encontrado en', colName);
              return res.json({ success: true, ...results });
            }
          } catch (e) {
            results.details.push(`Error en ${colName} filtro ${JSON.stringify(f)}: ${e.message}`);
          }
        }
      } catch (e) {
        console.warn('[DEBUG SEARCH] Error accediendo colección', colName, e.message);
        results.details.push(`Error accediendo ${colName}: ${e.message}`);
      }
    }

    console.log('[DEBUG SEARCH] ✗ Lead NO ENCONTRADO en ninguna colección');
    return res.json({ success: false, message: 'Lead no encontrado en ninguna colección', ...results });
  } catch (error) {
    console.error('[DEBUG SEARCH] Error:', error);
    return res.status(500).json({ success: false, message: 'Error en búsqueda', error: error.message });
  }
});
