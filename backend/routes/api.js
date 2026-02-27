const express = require('express');
const router = express.Router();
const { getDb, getDbFor, connectToMongoDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { protect, authorize } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// ============================
// Funciones auxiliares
// ============================

let __costumersCollectionsCache = { ts: 0, names: null };
let __teamLineasCollectionsCache = { ts: 0, names: null };

async function __getCostumersCollectionsCached(db) {
  const now = Date.now();
  if (__costumersCollectionsCache.names && (now - (__costumersCollectionsCache.ts || 0)) < 60_000) {
    return __costumersCollectionsCache.names;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = (collections || []).map(c => c.name).filter(name => /^costumers(_|$)/i.test(name));
  __costumersCollectionsCache = { ts: now, names };
  return names;
}

async function __getTeamLineasCollectionsCached(dbTL) {
  const now = Date.now();
  if (__teamLineasCollectionsCache.names && (now - (__teamLineasCollectionsCache.ts || 0)) < 60_000) {
    return __teamLineasCollectionsCache.names;
  }
  const collections = await dbTL.listCollections({}, { nameOnly: true }).toArray();
  const names = (collections || []).map(c => c.name);
  __teamLineasCollectionsCache = { ts: now, names };
  return names;
}

async function __collectionExists(db, name) {
  try {
    const u = await db.listCollections({ name }, { nameOnly: true }).toArray();
    return Array.isArray(u) && u.length > 0;
  } catch (_) {
    return false;
  }
}

async function __findLeadInCollection(collection, recordId, objId) {
  // 1) Búsqueda rápida por _id (indexado) para evitar scans
  if (objId) {
    const byObj = await collection.findOne({ _id: objId }, { maxTimeMS: 2_000 });
    if (byObj) return byObj;
  }
  const byStr = await collection.findOne({ _id: recordId }, { maxTimeMS: 2_000 });
  if (byStr) return byStr;

  // 2) Fallback por otros campos (puede ser más lento si no hay índices)
  const altKeys = ['id_cliente','idCliente','clienteId','cliente_id','clientId','client_id'];
  const or = [
    { id: recordId },
    { leadId: recordId },
    { sourceId: recordId }
  ];
  for (const k of altKeys) {
    or.push({ [k]: recordId });
    if (objId) or.push({ [k]: objId });
  }
  return await collection.findOne({ $or: or }, { maxTimeMS: 6_000 });
}

async function __findLeadByIdOnly(collection, recordId, objId) {
  try {
    if (objId) {
      const byObj = await collection.findOne({ _id: objId }, { maxTimeMS: 1_500 });
      if (byObj) return byObj;
    }
    return await collection.findOne({ _id: recordId }, { maxTimeMS: 1_500 });
  } catch (_) {
    return null;
  }
}

function __buildLeadIdFilters(recordId, objId) {
  const altKeys = ['id_cliente','idCliente','clienteId','cliente_id','clientId','client_id'];
  const filters = [];
  if (objId) filters.push({ _id: objId });
  filters.push({ _id: recordId });

  const extra = ['id', 'ID', 'leadId', 'sourceId'];
  for (const k of extra) {
    filters.push({ [k]: recordId });
    if (objId) filters.push({ [k]: objId });
  }
  for (const k of altKeys) {
    filters.push({ [k]: recordId });
    if (objId) filters.push({ [k]: objId });
  }
  return filters;
}

function __buildLeadOrQuery(recordId, objId) {
  const filters = __buildLeadIdFilters(recordId, objId);
  return { $or: filters };
}

async function __tryUpdateByFilters(collection, filters, updateData, maxTimeMS) {
  for (const f of filters) {
    try {
      const r = await collection.updateOne(f, { $set: updateData }, { maxTimeMS });
      if (r && r.matchedCount && r.matchedCount > 0) return r;
    } catch (_) {
      // continue
    }
  }
  return null;
}

async function __findLeadInTeamLineasDb(req, recordId, objId) {
  const dbTL = getDbFor('TEAM_LINEAS');
  if (!dbTL) return null;

  const role = String(req.user?.role || '').toLowerCase();
  const team = String(req.user?.team || '').toLowerCase();
  const username = String(req.user?.username || req.user?.name || '').trim();

  const canSearchAll = role.includes('admin') || role.includes('administrador') || role.includes('backoffice') || role.includes('supervisor');
  const canUseTeamLineas = team.includes('lineas') || role.includes('lineas') || canSearchAll;
  if (!canUseTeamLineas) return null;

  const preferred = username ? username.toUpperCase().replace(/\s+/g, '_') : '';
  if (preferred) {
    try {
      const col = dbTL.collection(preferred);
      const lead = await __findLeadInCollection(col, recordId, objId);
      if (lead) return { lead, collectionName: preferred };
    } catch (_) {}
  }

  if (canSearchAll) {
    let collections = [];
    try {
      collections = await __getTeamLineasCollectionsCached(dbTL);
    } catch (_) {
      collections = [];
    }

    const start = Date.now();
    for (const colName of collections) {
      if (preferred && colName === preferred) continue;
      if ((Date.now() - start) > 7_000) break;
      try {
        const col = dbTL.collection(colName);
        const lead = await __findLeadByIdOnly(col, recordId, objId);
        if (lead) return { lead, collectionName: colName };
      } catch (_) {
        // continue
      }
    }

    // Segundo intento: buscar por otros campos con un presupuesto corto
    for (const colName of collections) {
      if (preferred && colName === preferred) continue;
      if ((Date.now() - start) > 9_000) break;
      try {
        const col = dbTL.collection(colName);
        const filters = __buildLeadIdFilters(recordId, objId);
        let lead = null;
        for (const f of filters.slice(0, 10)) {
          try {
            lead = await col.findOne(f, { maxTimeMS: 400 });
          } catch (_) {
            lead = null;
          }
          if (lead) break;
        }
        if (lead) return { lead, collectionName: colName };
      } catch (_) {
        // continue
      }
    }
  }
  return null;
}

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
  console.log('[API /leads] ===== INICIO PETICIÓN =====');
  console.log('[API /leads] Método:', req.method);
  console.log('[API /leads] URL:', req.url);
  console.log('[API /leads] Usuario:', req.user?.username, 'Role:', req.user?.role, 'Team:', req.user?.team);
  console.log('[API /leads] Query params:', req.query);
  try {
    const db = getDb();
    console.log('[USERS UPDATE ROLE] after getDb, db present?', !!db);
    if (!db) {
      console.warn('[USERS UPDATE ROLE] No DB connection available');
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const { fechaInicio, fechaFin, status, month, allData, noFilter, skipDate, noAutoMonth, agentName, agents, vendedor, telefono, telefono_principal, nombre_cliente, direccion } = req.query;
    let query = {};
    const andConditions = [];

    // ===== Filtros directos por campos (usados para evitar duplicados / búsquedas puntuales) =====
    // Nota: se aplican como $or incluyendo variantes dentro de _raw.*
    const makeLooseTextRegex = (v) => {
      const s = String(v || '').trim();
      if (!s) return null;
      // Escapar regex
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(esc, 'i');
    };

    try {
      const telVal = String(telefono_principal || telefono || '').trim();
      const telRx = makeLooseTextRegex(telVal);
      if (telRx) {
        andConditions.push({
          $or: [
            { telefono_principal: { $regex: telRx.source, $options: 'i' } },
            { telefono: { $regex: telRx.source, $options: 'i' } },
            { phone: { $regex: telRx.source, $options: 'i' } },
            { '_raw.telefono_principal': { $regex: telRx.source, $options: 'i' } },
            { '_raw.telefono': { $regex: telRx.source, $options: 'i' } },
            { '_raw.phone': { $regex: telRx.source, $options: 'i' } }
          ]
        });
      }
    } catch (_) {}

    try {
      const nameRx = makeLooseTextRegex(nombre_cliente);
      if (nameRx) {
        andConditions.push({
          $or: [
            { nombre_cliente: { $regex: nameRx.source, $options: 'i' } },
            { nombre: { $regex: nameRx.source, $options: 'i' } },
            { name: { $regex: nameRx.source, $options: 'i' } },
            { '_raw.nombre_cliente': { $regex: nameRx.source, $options: 'i' } },
            { '_raw.nombre': { $regex: nameRx.source, $options: 'i' } },
            { '_raw.name': { $regex: nameRx.source, $options: 'i' } }
          ]
        });
      }
    } catch (_) {}

    try {
      const addrRx = makeLooseTextRegex(direccion);
      if (addrRx) {
        andConditions.push({
          $or: [
            { direccion: { $regex: addrRx.source, $options: 'i' } },
            { address: { $regex: addrRx.source, $options: 'i' } },
            { '_raw.direccion': { $regex: addrRx.source, $options: 'i' } },
            { '_raw.address': { $regex: addrRx.source, $options: 'i' } }
          ]
        });
      }
    } catch (_) {}

    // ===== Restricción por MERCADO según rol =====
    const roleLowerMarket = String(req.user?.role || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const mercadoRestrict = (() => {
      if (roleLowerMarket === 'rol_icon' || roleLowerMarket === 'icon' || roleLowerMarket.includes('rol icon')) return 'ICON';
      if (roleLowerMarket === 'rol_bamo' || roleLowerMarket === 'bamo' || roleLowerMarket.includes('rol bamo')) return 'BAMO';
      return '';
    })();

    const mercadoCondition = (m) => ({
      $or: [
        { mercado: String(m).toUpperCase() },
        { mercado: String(m).toLowerCase() },
        { mercado: String(m) },
        { 'mercado': { $regex: `^${String(m)}$`, $options: 'i' } },
        { '_raw.mercado': { $regex: `^${String(m)}$`, $options: 'i' } }
      ]
    });

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

      // Aplicar restricción por mercado si corresponde
      if (mercadoRestrict) {
        const before = leads.length;
        const target = String(mercadoRestrict).toUpperCase();
        leads = leads.filter(d => {
          const m = String(d?.mercado || d?._raw?.mercado || '').trim().toUpperCase();
          return m === target;
        });
        console.log(`[API /leads GLOBAL] Filtro por mercado (rol): ${target}. Antes=${before} Después=${leads.length}`);
      }

      // Permisos: ocultar/limitar "Ventas en reserva" en solicitudes GLOBAL para roles no privilegiados
      try {
        const roleRawRes = String(req.user?.role || '');
        const roleRes = roleRawRes
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const isPrivilegedRes = roleRes === 'administrador' || roleRes === 'admin' || roleRes.includes('admin') || roleRes.includes('backoffice');
        const isSupervisorRes = roleRes.includes('supervisor');
        const isAgentRes = !isPrivilegedRes && !isSupervisorRes;
        if (!isPrivilegedRes) {
          const userIdRes = String(req.user?.id || req.user?._id || '').trim();
          const userNameRes = String(req.user?.username || req.user?.name || req.user?.nombre || '').trim();
          const userTeamRes = String(req.user?.team || '').trim();
          const normTxt = (s) => String(s || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
          const unameN = normTxt(userNameRes);
          const uteamN = normTxt(userTeamRes);
          leads = (leads || []).filter(d => {
            const st = normTxt(d?.status || d?._raw?.status || '');
            if (!st.includes('reserva')) return true;
            if (isAgentRes) {
              const aid = String(d?.agenteId || d?._raw?.agenteId || '').trim();
              if (userIdRes && aid && String(userIdRes) === String(aid)) return true;
              const createdBy = normTxt(d?.createdBy || d?._raw?.createdBy || '');
              const agenteNombre = normTxt(d?.agenteNombre || d?.agente || d?._raw?.agenteNombre || d?._raw?.agente || '');
              return !!(unameN && (createdBy === unameN || agenteNombre === unameN));
            }
            if (isSupervisorRes) {
              const t = normTxt(d?.team || d?._raw?.team || '');
              if (uteamN && t === uteamN) return true;
              const sup = normTxt(d?.supervisor || d?._raw?.supervisor || '');
              return !!(unameN && sup === unameN);
            }
            return false;
          });
        }
      } catch (_) {}

      // Normalizar _id a string para evitar que llegue como objeto BSON al navegador
      leads = (leads || []).map(d => ({
        ...d,
        _id: d && d._id ? String(d._id) : d?._id,
        id: (d && d.id) ? String(d.id) : (d && d._id ? String(d._id) : '')
      }));
      return res.json({ success: true, data: leads, queryUsed: { global: true } });
    }
    // ===== FIN SOLICITUD GLOBAL =====

    // Restricción por mercado para queries normales
    if (mercadoRestrict) {
      andConditions.push(mercadoCondition(mercadoRestrict));
      console.log('[API /leads] Restricción por mercado (rol):', mercadoRestrict);
    }

    // ===== Permisos: Ventas en reserva =====
    // Regla:
    // - Agente: solo puede ver sus propias reservas
    // - Supervisor: solo reservas de su team
    // - Backoffice/Admin: puede ver todas
    // Se aplica siempre (aunque no venga status=Ventas en reserva) para evitar fugas de datos.
    try {
      const roleRawRes = String(req.user?.role || '');
      const roleRes = roleRawRes
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const isPrivilegedRes = roleRes === 'administrador' || roleRes === 'admin' || roleRes.includes('admin') || roleRes.includes('backoffice');
      const isSupervisorRes = roleRes.includes('supervisor');
      const isAgentRes = !isPrivilegedRes && !isSupervisorRes;

      if (!isPrivilegedRes) {
        const userIdRes = String(req.user?.id || req.user?._id || '').trim();
        const userNameRes = String(req.user?.username || req.user?.name || req.user?.nombre || '').trim();
        const userTeamRes = String(req.user?.team || '').trim();
        const reReserva = /reserva/i;

        const scopeOr = [];
        if (isAgentRes) {
          if (userIdRes) {
            scopeOr.push({ agenteId: userIdRes });
            scopeOr.push({ 'metadata.agenteId': userIdRes });
          }
          if (userNameRes) {
            scopeOr.push({ createdBy: { $regex: new RegExp(`^${userNameRes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
            scopeOr.push({ agenteNombre: { $regex: new RegExp(`^${userNameRes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
            scopeOr.push({ agente: { $regex: new RegExp(`^${userNameRes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
          }
        } else if (isSupervisorRes) {
          if (userTeamRes) {
            const esc = userTeamRes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            scopeOr.push({ team: { $regex: new RegExp(`^${esc}$`, 'i') } });
            scopeOr.push({ '_raw.team': { $regex: new RegExp(`^${esc}$`, 'i') } });
          }
          if (userNameRes) {
            const escName = userNameRes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            scopeOr.push({ supervisor: { $regex: new RegExp(`^${escName}$`, 'i') } });
            scopeOr.push({ '_raw.supervisor': { $regex: new RegExp(`^${escName}$`, 'i') } });
          }
        }

        // Si no pudimos construir scope, de forma segura ocultamos reservas
        const allowedReservaScope = scopeOr.length ? { $or: scopeOr } : { _id: '__no_reserva__' };

        // Query: (no-reserva) OR (reserva AND dentro de scope)
        andConditions.push({
          $or: [
            { status: { $not: reReserva } },
            { $and: [{ status: { $regex: reReserva } }, allowedReservaScope] }
          ]
        });
      }
    } catch (_) {}

    // Filtro por status (si se proporciona)
    if (status && status.toLowerCase() !== 'todos') {
      andConditions.push({ status: status });
    }

    // Filtro por agente (por nombre) — usado por Supervisores para ver su equipo o un agente específico
    const roleLower0 = String(req.user?.role || '').toLowerCase();
    const isSupervisor0 = roleLower0 === 'supervisor' || roleLower0.includes('supervisor');
    const normalizeList = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
      return String(v).split(',').map(s => s.trim()).filter(Boolean);
    };
    const agentListRaw = normalizeList(agents);

    const toComparable = (s) => String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '');

    const rawVendor = String(vendedor || '').trim();
    let singleAgent = String(agentName || rawVendor || '').trim();
    if (isSupervisor0 && rawVendor) {
      const u1 = toComparable(req.user?.username || '');
      const u2 = toComparable(req.user?.name || req.user?.nombre || '');
      const v = toComparable(rawVendor);
      if (v && (v === u1 || v === u2)) {
        // El frontend a veces manda vendedor=<supervisor>; eso filtra a 0.
        // Para supervisores, ignorarlo y dejar que corra la lógica supervisor->agents.
        singleAgent = '';
      }
    }

    // Para supervisores, NO confiar en `agents=` del frontend cuando NO hay agente seleccionado.
    // Ese param puede contener agentes de otros teams.
    const agentList = (isSupervisor0 && !String(agentName || '').trim()) ? [] : agentListRaw;
    const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const makeExactAnyRegex = (names) => {
      const uniq = Array.from(new Set((names || []).map(s => String(s).trim()).filter(Boolean)));
      if (!uniq.length) return null;
      return new RegExp(`^(${uniq.map(escaped).join('|')})$`, 'i');
    };
    const agentRegex = singleAgent ? makeExactAnyRegex([singleAgent]) : (agentList.length ? makeExactAnyRegex(agentList) : null);
    if (isSupervisor0 && agentRegex) {
      andConditions.push({
        $or: [
          { agenteNombre: { $regex: agentRegex } },
          { agente: { $regex: agentRegex } },
          { createdBy: { $regex: agentRegex } },
          { creadoPor: { $regex: agentRegex } }
        ]
      });
    }

    const disableAutoMonth = String(noAutoMonth || '').toLowerCase() === '1' || String(noAutoMonth || '').toLowerCase() === 'true';

    // Filtro por mes específico o mes actual si no se especifican fechas
    if (!fechaInicio && !fechaFin && !disableAutoMonth) {
      let targetYear, targetMonth;
      
      const explicitMonthProvided = !!month;
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
      
      // Generar strings para el mes objetivo
      // Si el mes objetivo es el mes actual, limitar hasta el día de hoy.
      const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
      const now = new Date();
      const isCurrentTargetMonth = (targetYear === now.getFullYear()) && (targetMonth === (now.getMonth() + 1));
      const lastDay = (isCurrentTargetMonth && !explicitMonthProvided) ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
      // Marcar en request si se trata del mes actual (del 1 hasta hoy)
      // Esto permite más adelante forzar lectura desde todas las colecciones (costumers*)
      // cuando la colección unificada esté desactualizada.
      try { req.__isCurrentMonthQuery = !!(isCurrentTargetMonth && !explicitMonthProvided); } catch (_) {}

      // Evitar queries gigantes (por día). Construir regex compactos por mes + día<=lastDay
      const monthStr = String(targetMonth).padStart(2, '0');
      const monthNoPad = String(targetMonth);
      const dayVals = [];
      for (let d = 1; d <= lastDay; d++) {
        dayVals.push(String(d));
        dayVals.push(String(d).padStart(2, '0'));
      }
      const uniqDayVals = Array.from(new Set(dayVals)).sort((a, b) => a.length - b.length || a.localeCompare(b));
      const dayAlt = uniqDayVals.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const mAlt = [monthStr, monthNoPad].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const yEsc = String(targetYear).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Formatos soportados:
      // - YYYY-MM-DD / YYYY-M-D
      // - YYYY/MM/DD
      // - DD/MM/YYYY y DD-MM-YYYY
      // - MM/DD/YYYY (US)
      const reYMD = new RegExp(`^${yEsc}-(?:${mAlt})-(?:${dayAlt})(?:\\b|T|\\s|$)`, 'i');
      const reYMDSlash = new RegExp(`^${yEsc}\\/(?:${mAlt})\\/(?:${dayAlt})(?:\\b|T|\\s|$)`, 'i');
      const reDMYSlash = new RegExp(`^(?:${dayAlt})\\/(?:${mAlt})\\/${yEsc}(?:\\b|\\s|$)`, 'i');
      const reDMYDash = new RegExp(`^(?:${dayAlt})-(?:${mAlt})-${yEsc}(?:\\b|\\s|$)`, 'i');
      const reMDYSlash = new RegExp(`^(?:${mAlt})\\/(?:${dayAlt})\\/${yEsc}(?:\\b|\\s|$)`, 'i');

      const monthStart = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(targetYear, targetMonth - 1, lastDay, 23, 59, 59, 999);
      
      const saleDateOrConditions = [
        { dia_venta: { $regex: reYMD.source, $options: 'i' } },
        { dia_venta: { $regex: reYMDSlash.source, $options: 'i' } },
        { dia_venta: { $regex: reDMYSlash.source, $options: 'i' } },
        { dia_venta: { $regex: reDMYDash.source, $options: 'i' } },
        { dia_venta: { $regex: reMDYSlash.source, $options: 'i' } },
        { fecha_contratacion: { $regex: reYMD.source, $options: 'i' } },
        { fecha_contratacion: { $regex: reYMDSlash.source, $options: 'i' } },
        { fecha_contratacion: { $regex: reDMYSlash.source, $options: 'i' } },
        { fecha_contratacion: { $regex: reDMYDash.source, $options: 'i' } },
        { fecha_contratacion: { $regex: reMDYSlash.source, $options: 'i' } },
        // Algunos documentos guardan las fechas dentro de _raw (ej. costumers_unified)
        { '_raw.dia_venta': { $regex: reYMD.source, $options: 'i' } },
        { '_raw.dia_venta': { $regex: reYMDSlash.source, $options: 'i' } },
        { '_raw.dia_venta': { $regex: reDMYSlash.source, $options: 'i' } },
        { '_raw.dia_venta': { $regex: reDMYDash.source, $options: 'i' } },
        { '_raw.dia_venta': { $regex: reMDYSlash.source, $options: 'i' } },
        { '_raw.fecha_contratacion': { $regex: reYMD.source, $options: 'i' } },
        { '_raw.fecha_contratacion': { $regex: reYMDSlash.source, $options: 'i' } },
        { '_raw.fecha_contratacion': { $regex: reDMYSlash.source, $options: 'i' } },
        { '_raw.fecha_contratacion': { $regex: reDMYDash.source, $options: 'i' } },
        { '_raw.fecha_contratacion': { $regex: reMDYSlash.source, $options: 'i' } },
        // Variantes camelCase comunes
        { '_raw.diaVenta': { $regex: reYMD.source, $options: 'i' } },
        { '_raw.diaVenta': { $regex: reYMDSlash.source, $options: 'i' } },
        { '_raw.diaVenta': { $regex: reDMYSlash.source, $options: 'i' } },
        { '_raw.diaVenta': { $regex: reDMYDash.source, $options: 'i' } },
        { '_raw.diaVenta': { $regex: reMDYSlash.source, $options: 'i' } },
        { '_raw.fechaContratacion': { $regex: reYMD.source, $options: 'i' } },
        { '_raw.fechaContratacion': { $regex: reYMDSlash.source, $options: 'i' } },
        { '_raw.fechaContratacion': { $regex: reDMYSlash.source, $options: 'i' } },
        { '_raw.fechaContratacion': { $regex: reDMYDash.source, $options: 'i' } },
        { '_raw.fechaContratacion': { $regex: reMDYSlash.source, $options: 'i' } },
        // Soportar casos donde dia_venta/fecha_contratacion se guardaron como Date
        { dia_venta: { $gte: monthStart, $lte: monthEnd } },
        { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } }
      ];

      // Solo usar createdAt/creadoEn/actualizadoEn como fallback si no hay fecha de venta/contratación.
      const saleDatePresence = [
        { dia_venta: { $exists: true, $ne: '' } },
        { fecha_contratacion: { $exists: true, $ne: '' } },
        { '_raw.dia_venta': { $exists: true, $ne: '' } },
        { '_raw.fecha_contratacion': { $exists: true, $ne: '' } },
        { '_raw.diaVenta': { $exists: true, $ne: '' } },
        { '_raw.fechaContratacion': { $exists: true, $ne: '' } }
      ];
      const saleDateMissing = { $nor: saleDatePresence };

      // Más variantes de campos de fecha (visto en bases con formatos mixtos)
      const extraDateFields = [
        'diaVenta',
        'fechaVenta',
        'fecha_venta',
        'fechaDeVenta',
        'saleDate',
        'sale_date',
        'dia_instalacion',
        'fecha_instalacion',
        'diaInstalacion',
        'fechaInstalacion'
      ];
      const extraPaths = [...extraDateFields, ...extraDateFields.map(f => `_raw.${f}`)];
      for (const p of extraPaths) {
        saleDateOrConditions.push({ [p]: { $regex: reYMD.source, $options: 'i' } });
        saleDateOrConditions.push({ [p]: { $regex: reYMDSlash.source, $options: 'i' } });
        saleDateOrConditions.push({ [p]: { $regex: reDMYSlash.source, $options: 'i' } });
        saleDateOrConditions.push({ [p]: { $regex: reDMYDash.source, $options: 'i' } });
        saleDateOrConditions.push({ [p]: { $regex: reMDYSlash.source, $options: 'i' } });
        // y por si ese campo es Date
        saleDateOrConditions.push({ [p]: { $gte: monthStart, $lte: monthEnd } });
      }

      // Soportar strings tipo Date.toDateString() (ej: "Thu Jan 01 2026")
      // Visto en diagnósticos donde `costumers_unified` guarda dia_venta en ese formato.
      for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(targetYear, targetMonth - 1, d);
        const prefix = String(dateObj.toDateString() || '').trim();
        if (!prefix) continue;
        const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        saleDateOrConditions.push({ dia_venta: { $regex: `^${esc}`, $options: 'i' } });
        saleDateOrConditions.push({ '_raw.dia_venta': { $regex: `^${esc}`, $options: 'i' } });
        saleDateOrConditions.push({ '_raw.diaVenta': { $regex: `^${esc}`, $options: 'i' } });
      }
      
      const dateQuery = {
        $or: [
          { $or: saleDateOrConditions },
          { $and: [saleDateMissing, { createdAt: { $gte: monthStart, $lte: monthEnd } }] },
          { $and: [saleDateMissing, { creadoEn: { $gte: monthStart, $lte: monthEnd } }] },
          { $and: [saleDateMissing, { actualizadoEn: { $gte: monthStart, $lte: monthEnd } }] }
        ]
      };
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
        // También aceptar strings ISO con hora y formato DD-MM-YYYY
        dateRegexes.push(new RegExp(`^${year}-${month}-${day}`));
        dateRegexes.push(new RegExp(`^${day}\\/${month}\\/${year}`));
        dateRegexes.push(new RegExp(`^${day}-${month}-${year}`));
        
        current.setDate(current.getDate() + 1);
      }

      const dateOrConditions = [
        { dia_venta: { $in: dateStrings } },
        { fecha_contratacion: { $in: dateStrings } },
        // Algunos documentos guardan las fechas dentro de _raw (ej. costumers_unified)
        { '_raw.dia_venta': { $in: dateStrings } },
        { '_raw.fecha_contratacion': { $in: dateStrings } },
        // Variantes camelCase comunes
        { '_raw.diaVenta': { $in: dateStrings } },
        { '_raw.fechaContratacion': { $in: dateStrings } },
        // Campos Date
        { dia_venta: { $gte: start, $lte: end } },
        { fecha_contratacion: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end } },
        { creadoEn: { $gte: start, $lte: end } },
        { actualizadoEn: { $gte: start, $lte: end } }
      ];
      
      // Agregar condiciones de regex individualmente usando el source del RegExp
      dateRegexes.forEach(regex => {
        dateOrConditions.push({ dia_venta: { $regex: regex.source, $options: 'i' } });
        dateOrConditions.push({ fecha_contratacion: { $regex: regex.source, $options: 'i' } });
        dateOrConditions.push({ '_raw.dia_venta': { $regex: regex.source, $options: 'i' } });
        dateOrConditions.push({ '_raw.fecha_contratacion': { $regex: regex.source, $options: 'i' } });
        dateOrConditions.push({ '_raw.diaVenta': { $regex: regex.source, $options: 'i' } });
        dateOrConditions.push({ '_raw.fechaContratacion': { $regex: regex.source, $options: 'i' } });
      });

      // Más variantes de campos de fecha (visto en bases con formatos mixtos)
      const extraDateFields = [
        'diaVenta',
        'fechaVenta',
        'fecha_venta',
        'fechaDeVenta',
        'saleDate',
        'sale_date',
        'dia_instalacion',
        'fecha_instalacion',
        'diaInstalacion',
        'fechaInstalacion'
      ];
      const extraPaths = [...extraDateFields, ...extraDateFields.map(f => `_raw.${f}`)];
      for (const p of extraPaths) {
        dateOrConditions.push({ [p]: { $in: dateStrings } });
        dateRegexes.forEach(regex => {
          dateOrConditions.push({ [p]: { $regex: regex.source, $options: 'i' } });
        });
        dateOrConditions.push({ [p]: { $gte: start, $lte: end } });
      }

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

    const roleLower = String(req.user?.role || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const isSupervisor = roleLower === 'supervisor' || roleLower.includes('supervisor');

    // Recolectar todas las colecciones a iterar (incluye TEAM_LINEAS si existe)
    const allCollections = [];
    const collectionsList = await db.listCollections().toArray();
    const allNames = collectionsList.map(c => c.name);

    // Preferir colección unificada cuando exista (reduce costo). El filtrado por rol se aplica en `query`.
    const unifiedAvailable = preferUnified && allNames.includes(unifiedCollectionName);

    // En mes actual, preferir siempre costumers* (la unificada puede estar desactualizada)
    let unifiedAvailableFinal = unifiedAvailable;
    try {
      if (req.__isCurrentMonthQuery) {
        const isAdminRole = (roleLower === 'admin' || roleLower === 'administrador' || roleLower.includes('admin'));
        if (!isAdminRole) {
          unifiedAvailableFinal = false;
          console.log('[API /leads] Mes actual detectado: usando costumers* en vez de costumers_unified');
        } else {
          console.log('[API /leads] Mes actual detectado (admin): manteniendo costumers_unified si está disponible');
        }
      }
    } catch (_) {}

    // Para supervisores + colección unificada: filtrar por agentes asignados.
    // En `costumers_unified` puede que NO existan campos supervisor/team dentro del lead; si filtramos por ellos, el resultado queda en 0.
    // Mantener fallback seguro (no exponer otros equipos) si no se puede resolver el equipo.
    if (isSupervisor && unifiedAvailableFinal && !agentRegex) {
      console.log('[API /leads] Supervisor con unified, resolviendo agentes...');
      const supervisorUsername = String(req.user?.username || '').trim();
      const supervisorName = String(req.user?.name || req.user?.nombre || req.user?.fullName || '').trim();
      const supervisorTeam = String(req.user?.team || '').trim();
      const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || '')).trim();

      console.log('[API /leads] Supervisor info:', { supervisorUsername, supervisorName, supervisorTeam, currentUserId });

      let agentes = [];
      try {
        let supOid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) supOid = new ObjectId(currentUserId); } catch (_) {}

        // Algunos supervisores “cuelgan” de un supervisorId padre; en ese caso los agentes usan ese supervisorId,
        // no el _id del supervisor actual.
        let parentSupervisorId = null;
        try {
          const selfUser = await db.collection('users').findOne(
            { _id: supOid || currentUserId },
            { projection: { supervisorId: 1 } }
          );
          parentSupervisorId = selfUser?.supervisorId || null;
        } catch (_) { parentSupervisorId = null; }

        const supNameCandidates = [supervisorUsername, supervisorName].filter(v => v && String(v).trim().length > 0);
        const supNameRegex = supNameCandidates.length
          ? new RegExp(supNameCandidates.map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
          : null;

        const or = [
          ...(currentUserId ? [{ supervisorId: currentUserId }] : []),
          ...(supOid ? [{ supervisorId: supOid }] : [])
        ];
        if (parentSupervisorId) {
          or.push({ supervisorId: parentSupervisorId });
          try {
            const ps = (typeof parentSupervisorId === 'string' && /^[a-fA-F0-9]{24}$/.test(parentSupervisorId))
              ? new ObjectId(parentSupervisorId)
              : parentSupervisorId;
            or.push({ supervisorId: ps });
          } catch (_) {}
        }
        if (supNameRegex) {
          or.push({ supervisor: { $regex: supNameRegex } });
          or.push({ supervisorName: { $regex: supNameRegex } });
          or.push({ manager: { $regex: supNameRegex } });
        }
        if (supervisorTeam) {
          or.push({ team: supervisorTeam });
        }

        console.log('[API /leads] Query para buscar agentes:', or.length ? { $or: or } : 'sin filtros');
        const and = [];
        if (or.length) and.push({ $or: or });
        // No considerar al supervisor como “agente”
        if (supOid) and.push({ _id: { $ne: supOid } });
        // Excluir roles de supervisor (case-insensitive)
        and.push({ role: { $not: /supervisor/i } });
        const userQuery = and.length ? { $and: and } : { role: { $not: /supervisor/i } };
        agentes = await db.collection('users').find(userQuery).toArray();
        console.log('[API /leads] Agentes encontrados:', agentes.length);
      if (agentes.length > 0) {
        console.log('[API /leads] Primer agente encontrado (campos):', Object.keys(agentes[0] || {}));
        console.log('[API /leads] Primer agente encontrado (datos):', JSON.stringify(agentes[0], null, 2));
      }
      } catch (e) {
        console.warn('[API /leads] Supervisor(unified): error resolviendo agentes:', e?.message || e);
        agentes = [];
      }

      const agentIdStrings = (agentes || [])
        .map(a => (a && a._id ? (a._id.toString ? a._id.toString() : String(a._id)) : ''))
        .filter(Boolean);
      const agentIdObjs = [];
      for (const id of agentIdStrings) {
        try { if (/^[a-fA-F0-9]{24}$/.test(id)) agentIdObjs.push(new ObjectId(id)); } catch (_) {}
      }

      const agentNameCandidates = (agentes || [])
        .flatMap(a => [
          a?.username, 
          a?.name, 
          a?.nombre,
          a?.fullName,
          a?.displayName,
          a?.email,
          a?.correo,
          a?.user,
          a?.agente,
          a?.agenteNombre
        ])
        .map(v => String(v || '').trim())
        .filter(v => v && v.length > 0);

      const teamCandidates = (agentes || [])
        .flatMap(a => [a?.team, a?.supervisor, a?.supervisorName, a?.manager])
        .map(v => String(v || '').trim())
        .filter(v => v && v.length > 0);

      console.log('[API /leads] Agentes IDs strings:', agentIdStrings);
      console.log('[API /leads] Agentes nombres:', agentNameCandidates);
      console.log('[API /leads] Agentes team candidates:', teamCandidates);

      const derivedAgentRegex = agentNameCandidates.length ? makeExactAnyRegex(agentNameCandidates) : null;
      console.log('[API /leads] derivedAgentRegex:', derivedAgentRegex);
      console.log('[API /leads] derivedAgentRegex source:', derivedAgentRegex?.source);
      console.log('[API /leads] derivedAgentRegex toString:', derivedAgentRegex?.toString());

      let dominantTeam = '';

      // Derivar team real desde costumers_unified para cubrir agentes no ligados en `users`.
      // (p.ej. leads viajan con team/supervisor = "JOHANA" aunque en users no esté bien asignado).
      try {
        const unifiedCol = db.collection(unifiedCollectionName);
        const hintOr = [];
        if (agentIdStrings.length) hintOr.push({ agenteId: { $in: agentIdStrings } });
        if (agentIdObjs.length) hintOr.push({ agenteId: { $in: agentIdObjs } });
        if (derivedAgentRegex) {
          hintOr.push({ agenteNombre: { $regex: derivedAgentRegex } });
          hintOr.push({ agente: { $regex: derivedAgentRegex } });
          hintOr.push({ createdBy: { $regex: derivedAgentRegex } });
          hintOr.push({ creadoPor: { $regex: derivedAgentRegex } });
        }
        if (hintOr.length) {
          const hintQuery = { $or: hintOr };

          // 1) Determinar team dominante para NO abrir a otros equipos
          try {
            const agg = await unifiedCol.aggregate([
              { $match: hintQuery },
              {
                $project: {
                  _t: { $ifNull: ['$team', '$supervisor'] },
                  _s: '$supervisor',
                  _sn: '$supervisorName'
                }
              },
              {
                $addFields: {
                  _teamKey: {
                    $ifNull: [
                      '$_t',
                      { $ifNull: ['$_s', '$_sn'] }
                    ]
                  }
                }
              },
              { $group: { _id: '$_teamKey', n: { $sum: 1 } } },
              { $sort: { n: -1 } },
              { $limit: 1 }
            ]).toArray();
            dominantTeam = String(agg?.[0]?._id || '').trim();
          } catch (e) {
            dominantTeam = '';
          }

          // 2) Mantener candidatos como fallback (si no se pudo determinar dominante)
          if (!dominantTeam) {
            const tVals = await unifiedCol.distinct('team', hintQuery);
            const sVals = await unifiedCol.distinct('supervisor', hintQuery);
            const snVals = await unifiedCol.distinct('supervisorName', hintQuery);
            [...(tVals || []), ...(sVals || []), ...(snVals || [])]
              .map(v => String(v || '').trim())
              .filter(Boolean)
              .forEach(v => teamCandidates.push(v));
            console.log('[API /leads] team candidates (from unified distinct):', { team: tVals?.length || 0, supervisor: sVals?.length || 0, supervisorName: snVals?.length || 0 });
          } else {
            console.log('[API /leads] dominantTeam (from unified):', dominantTeam);
          }
        }
      } catch (e) {
        console.log('[API /leads] No se pudo derivar team desde unified:', e?.message || e);
      }

      const teamCanonSource = dominantTeam ? [dominantTeam] : teamCandidates;
      const teamCanon = Array.from(new Set(
        (teamCanonSource || [])
          .map(s => String(s || '').trim())
          .filter(Boolean)
          .flatMap(s => {
            const raw = String(s || '').trim();
            const upper = raw.toUpperCase();
            const rawNoTeam = raw.replace(/^TEAM\s+/i, '').trim();
            const upperNoTeam = upper.replace(/^TEAM\s+/, '').trim();
            const tokens = upper.split(/\s+/).filter(Boolean);
            const first = (tokens[0] && tokens[0] !== 'TEAM') ? tokens[0] : '';
            const firstNoTeam = (upperNoTeam.split(/\s+/).filter(Boolean)[0] || '');
            return [
              raw,
              upper,
              rawNoTeam,
              upperNoTeam,
              first,
              firstNoTeam
            ].filter(Boolean);
          })
      ));

      const supOr = [];
      if (agentIdStrings.length) supOr.push({ agenteId: { $in: agentIdStrings } });
      if (agentIdObjs.length) supOr.push({ agenteId: { $in: agentIdObjs } });
      if (derivedAgentRegex) {
        supOr.push({ agenteNombre: { $regex: derivedAgentRegex } });
        supOr.push({ agente: { $regex: derivedAgentRegex } });
        supOr.push({ createdBy: { $regex: derivedAgentRegex } });
        supOr.push({ creadoPor: { $regex: derivedAgentRegex } });
      }
      if (teamCanon.length) {
        supOr.push({ team: { $in: teamCanon } });
        supOr.push({ supervisor: { $in: teamCanon } });
        supOr.push({ supervisorName: { $in: teamCanon } });
      }

      // Si no se pudieron resolver agentes para el supervisor, en `costumers_unified` casi nunca existen
      // campos supervisor/team. En ese caso, filtramos por el propio usuario (self) para evitar regresar 0.
      if (!supOr.length) {
        const ownName = String(supervisorUsername || '').trim();
        const ownNameRegex = ownName ? makeExactAnyRegex([ownName]) : null;

        let ownOid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) ownOid = new ObjectId(currentUserId); } catch (_) { ownOid = null; }

        // Derivar team/supervisor real para costumers_unified (ej. lead.team="JOHANA")
        // Usar user.supervisor (string) o supervisorId (apunta a un supervisor padre)
        const leadTeamCandidates = [];
        const rawSup = String(req.user?.supervisor || '').trim();
        if (rawSup) leadTeamCandidates.push(rawSup);
        try {
          const selfLookupOr = [];
          if (ownOid) selfLookupOr.push({ _id: ownOid });
          if (currentUserId) selfLookupOr.push({ _id: currentUserId });
          if (supervisorUsername) selfLookupOr.push({ username: supervisorUsername });
          if (supervisorName) selfLookupOr.push({ name: supervisorName });
          if (supervisorName) selfLookupOr.push({ nombre: supervisorName });
          if (supervisorUsername) selfLookupOr.push({ email: supervisorUsername });
          if (supervisorUsername) selfLookupOr.push({ correo: supervisorUsername });

          const selfDbUser = await db.collection('users').findOne(
            selfLookupOr.length ? { $or: selfLookupOr } : { username: supervisorUsername },
            { projection: { supervisorId: 1 } }
          );
          console.log('[API /leads] Fallback(unified): selfDbUser supervisorId:', selfDbUser?.supervisorId);
          const supId = selfDbUser?.supervisorId;
          if (supId) {
            let parent = null;
            let supObj = supId;
            try {
              supObj = (typeof supId === 'string' && /^[a-fA-F0-9]{24}$/.test(supId)) ? new ObjectId(supId) : supId;
              parent = await db.collection('users').findOne(
                { _id: supObj },
                { projection: { username: 1, name: 1, nombre: 1 } }
              );
            } catch (_) { parent = null; }
            const parentName = String(parent?.name || parent?.nombre || parent?.username || '').trim();
            console.log('[API /leads] Fallback(unified): parentName:', parentName);
            if (parentName) leadTeamCandidates.push(parentName);

            // Fallback extra: si el supervisor padre no tiene name/username, derivar team/supervisor
            // desde los agentes que cuelgan de ese supervisorId.
            if (!parentName) {
              try {
                const agentsBySup = await db.collection('users').find(
                  {
                    $and: [
                      { $or: [ { supervisorId: supObj }, { supervisorId: (supObj?.toString ? supObj.toString() : supObj) } ] },
                      { role: { $not: /supervisor/i } }
                    ]
                  },
                  { projection: { team: 1, supervisor: 1, supervisorName: 1, manager: 1, username: 1, name: 1, nombre: 1 } }
                ).limit(50).toArray();

                const derived = (agentsBySup || [])
                  .flatMap(a => [a?.team, a?.supervisor, a?.supervisorName, a?.manager])
                  .map(v => String(v || '').trim())
                  .filter(Boolean);

                if (derived.length) {
                  console.log('[API /leads] Fallback(unified): derived team/sup from agents:', Array.from(new Set(derived)).slice(0, 20));
                  derived.forEach(v => leadTeamCandidates.push(v));
                } else {
                  console.log('[API /leads] Fallback(unified): no derived team/sup from agents');
                }
              } catch (e) {
                console.log('[API /leads] Fallback(unified): error deriving from agents:', e?.message || e);
              }
            }
          }
        } catch (_) {}

        const leadTeamCanon = Array.from(new Set(
          leadTeamCandidates
            .map(s => String(s || '').trim())
            .filter(Boolean)
            .flatMap(s => {
              const raw = String(s || '').trim();
              const upper = raw.toUpperCase();
              const rawNoTeam = raw.replace(/^TEAM\s+/i, '').trim();
              const upperNoTeam = upper.replace(/^TEAM\s+/, '').trim();
              const tokens = upper.split(/\s+/).filter(Boolean);
              const first = (tokens[0] && tokens[0] !== 'TEAM') ? tokens[0] : '';
              const firstNoTeam = (upperNoTeam.split(/\s+/).filter(Boolean)[0] || '');
              return [
                raw,
                upper,
                rawNoTeam,
                upperNoTeam,
                first,
                firstNoTeam
              ].filter(Boolean);
            })
        ));

        console.log('[API /leads] Fallback(unified): leadTeamCanon:', leadTeamCanon);

        if (currentUserId) supOr.push({ agenteId: currentUserId });
        if (ownOid) supOr.push({ agenteId: ownOid });
        if (ownNameRegex) {
          supOr.push({ agenteNombre: { $regex: ownNameRegex } });
          supOr.push({ agente: { $regex: ownNameRegex } });
          supOr.push({ createdBy: { $regex: ownNameRegex } });
          supOr.push({ creadoPor: { $regex: ownNameRegex } });
        }

        if (leadTeamCanon.length) {
          supOr.push({ team: { $in: leadTeamCanon } });
          supOr.push({ supervisor: { $in: leadTeamCanon } });
          supOr.push({ supervisorName: { $in: leadTeamCanon } });
        }

        console.log('[API /leads] Fallback supervisor->self aplicado (no se resolvieron agentes)');
      }

      console.log('[API /leads] Filtro supervisor $or:', supOr);

      if (supOr.length) {
        const supFilter = { $or: supOr };
        console.log('[API /leads] Aplicando filtro supervisor:', JSON.stringify(supFilter, null, 2));
        if (query && query.$and && Array.isArray(query.$and)) {
          query.$and.push(supFilter);
        } else if (query && Object.keys(query).length) {
          query = { $and: [query, supFilter] };
        } else {
          query = supFilter;
        }
      } else {
        console.log('[API /leads] No se encontraron agentes, usando fallback...');
        const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameParts = [supervisorUsername, supervisorName].filter(v => v && String(v).trim().length > 0);
        const nameRegex = nameParts.length ? new RegExp(nameParts.map(escapeRe).join('|'), 'i') : null;
        const teamRegex = supervisorTeam ? new RegExp(escapeRe(supervisorTeam), 'i') : null;

        const fallbackOr = [];
        if (nameRegex) {
          fallbackOr.push({ supervisor: { $regex: nameRegex } });
          fallbackOr.push({ supervisorName: { $regex: nameRegex } });
          fallbackOr.push({ manager: { $regex: nameRegex } });
        }
        if (teamRegex) {
          fallbackOr.push({ team: { $regex: teamRegex } });
          fallbackOr.push({ equipo: { $regex: teamRegex } });
        }
        if (fallbackOr.length) {
          const supFilter = { $or: fallbackOr };
          if (query && query.$and && Array.isArray(query.$and)) {
            query.$and.push(supFilter);
          } else if (query && Object.keys(query).length) {
            query = { $and: [query, supFilter] };
          } else {
            query = supFilter;
          }
        }
      }
    }

    const debugQuery = String(req.query.debugQuery || '') === '1';
    if (debugQuery) {
      let s = '';
      try { s = JSON.stringify(query, null, 2); } catch (_) { s = String(query); }
      console.log('[API /leads] Query final antes de ejecutar:', s.length > 5000 ? (s.slice(0, 5000) + '...<truncated>') : s);
    } else {
      const andLen = (query && query.$and && Array.isArray(query.$and)) ? query.$and.length : 0;
      console.log('[API /leads] Query final antes de ejecutar: $and=', andLen);
    }

    let collectionNamesList = unifiedAvailableFinal
      ? [unifiedCollectionName]
      : allNames
          .filter(n => /^costumers(_|$)/i.test(n));

    // Para supervisores: limitar a colecciones de sus agentes (equipo) SOLO cuando no hay colección unificada
    if (isSupervisor && !unifiedAvailableFinal) {
      const supervisorUsername = String(req.user?.username || '').trim();
      const supervisorName = String(req.user?.name || req.user?.nombre || req.user?.fullName || '').trim();
      const supervisorTeam = String(req.user?.team || '').trim();
      const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || '')).trim();

      const sanitize = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
      const shortId = (id) => String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6);

      // Resolver agentes asignados
      let agentes = [];
      try {
        let supOid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) supOid = new ObjectId(currentUserId); } catch (_) {}

        const supNameCandidates = [supervisorUsername, supervisorName].filter(v => v && String(v).trim().length > 0);
        const supNameRegex = supNameCandidates.length
          ? new RegExp(supNameCandidates.map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
          : null;

        const or = [
          ...(currentUserId ? [{ supervisorId: currentUserId }] : []),
          ...(supOid ? [{ supervisorId: supOid }] : [])
        ];
        if (supNameRegex) {
          or.push({ supervisor: { $regex: supNameRegex } });
          or.push({ supervisorName: { $regex: supNameRegex } });
          or.push({ manager: { $regex: supNameRegex } });
        }
        if (supervisorTeam) {
          or.push({ team: supervisorTeam });
        }

        agentes = await db.collection('users').find(or.length ? { $or: or } : {}).toArray();
        console.log('[API /leads] Supervisor agentes detectados:', {
          supervisorUsername,
          supervisorTeam,
          count: Array.isArray(agentes) ? agentes.length : 0,
          sample: (agentes || []).slice(0, 5).map(a => ({ username: a.username, name: a.name || a.nombre, supervisorId: a.supervisorId, supervisor: a.supervisor, team: a.team }))
        });
      } catch (e) {
        console.warn('[API /leads] Supervisor: error resolviendo agentes:', e?.message || e);
      }

      // Resolver colecciones de esos agentes
      const agentCollections = new Set();
      try {
        const uc = db.collection('user_collections');
        for (const a of (agentes || [])) {
          const aidStr = a && a._id ? (a._id.toString ? a._id.toString() : String(a._id)) : '';
          const aidObj = (a && a._id && typeof a._id === 'object') ? a._id : null;
          // 1) Mapping ownerId
          try {
            const mapping = await uc.findOne({
              $or: [
                { ownerId: aidStr },
                ...(aidObj ? [{ ownerId: aidObj }] : []),
                { userId: aidStr },
                ...(aidObj ? [{ userId: aidObj }] : [])
              ]
            });
            if (mapping && mapping.collectionName) {
              agentCollections.add(mapping.collectionName);
              continue;
            }
          } catch (_) {}
          // 2) Convención costumers_<username>
          const uname = sanitize(a?.username || a?.name || a?.nombre || '');
          if (uname) {
            const candidates = [];
            const sid = shortId(aidStr);
            if (sid) candidates.push(`costumers_${uname}_${sid}`);
            candidates.push(`costumers_${uname}`);
            for (const proposed of candidates) {
              if (allNames.includes(proposed)) {
                agentCollections.add(proposed);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[API /leads] Supervisor: error resolviendo colecciones de agentes:', e?.message || e);
      }

      if (agentCollections.size === 0) {
        // Fallback seguro: no limitar por colecciones (porque no pudimos resolverlas), pero SÍ limitar por
        // campos en documentos (supervisor/team) para no filtrar a vacío y no exponer otros equipos.
        console.warn('[API /leads] Supervisor sin colecciones detectadas. Usando fallback por campos supervisor/team.', {
          supervisorUsername,
          supervisorTeam,
          agentes: (agentes || []).length
        });

        const nameParts = [supervisorUsername, supervisorName].filter(v => v && String(v).trim().length > 0);
        const nameRegex = nameParts.length
          ? new RegExp(nameParts.map(s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
          : null;
        const teamRegex = supervisorTeam ? new RegExp(String(supervisorTeam).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

        const supervisorDocOr = [];
        if (nameRegex) {
          supervisorDocOr.push({ supervisor: { $regex: nameRegex } });
          supervisorDocOr.push({ supervisorName: { $regex: nameRegex } });
          supervisorDocOr.push({ manager: { $regex: nameRegex } });
        }
        if (teamRegex) {
          supervisorDocOr.push({ team: { $regex: teamRegex } });
        }

        if (supervisorDocOr.length) {
          const supFilter = { $or: supervisorDocOr };
          if (query && query.$and && Array.isArray(query.$and)) {
            query.$and.push(supFilter);
          } else if (query && Object.keys(query).length) {
            query = { $and: [query, supFilter] };
          } else {
            query = supFilter;
          }
        }
      } else {
        const allowed = new Set(Array.from(agentCollections));
        collectionNamesList = collectionNamesList.filter(n => allowed.has(n));
        console.log('[API /leads] Supervisor: colecciones resueltas:', Array.from(agentCollections));
        console.log('[API /leads] Supervisor: colecciones finales a iterar:', collectionNamesList);
      }
    }

    try {
      allCollections.length = 0;
      for (const n of (collectionNamesList || [])) {
        if (!n) continue;
        allCollections.push({ db, name: n });
      }
    } catch (e) {
      console.warn('[API /leads] Error armando allCollections:', e?.message || e);
    }

    console.log(`[API /leads] Source mode: ${unifiedAvailableFinal ? 'costumers_unified' : 'costumers* + TEAM_LINEAS'} (legacy=${String(legacy || '')})`);

    // Paginación a través de colecciones: calcular total y tomar la ventana [offsetGlobal, offsetGlobal+limit)
    let remaining = limit;
    let offset = offsetGlobal;
    const collected = [];
    let totalCount = 0;

    const debugSource = String(req.query.debugSource || '') === '1';

    for (const collInfo of allCollections) {
      const colName = collInfo.name;
      try {
        const col = collInfo.db.collection(colName);
        // Contar documentos que coinciden con la query en esta colección
        const cnt = await col.countDocuments(query);
        if (debugSource) console.log(`[API /leads] Colección ${colName} -> count=${cnt}`);
        totalCount += cnt;

        if (offset >= cnt) {
          // aún saltamos esta colección completa
          if (debugSource) console.log(`[API /leads] Saltando colección ${colName} (offset remaining=${offset} >= count=${cnt})`);
          offset -= cnt;
          continue;
        }

        // calcular skip para esta colección
        const skip = offset > 0 ? offset : 0;
        const fetchLimit = Math.max(0, remaining);
        if (debugSource) console.log(`[API /leads] Preparando fetch en ${colName}: skip=${skip} limit=${fetchLimit} (remaining global=${remaining})`);

        const pipeline = [
          { $match: query },
          // Orden robusto: algunas colecciones no tienen createdAt pero sí creadoEn/actualizadoEn
          { $sort: { createdAt: -1, creadoEn: -1, actualizadoEn: -1 } },
          { $skip: skip },
          { $limit: fetchLimit },
          { $addFields: {
              // Usar $convert para manejar de forma segura IDs inválidos, nulos o ausentes
              agenteObjId: { 
                $convert: {
                  input: "$agenteId",
                  to: "objectId",
                  onError: null,
                  onNull: null
                }
              },
              supervisorObjId: {
                $convert: {
                  input: "$supervisorId",
                  to: "objectId",
                  onError: null,
                  onNull: null
                }
              }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'agenteObjId',
              foreignField: '_id',
              as: 'agenteDetails'
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'supervisorObjId',
              foreignField: '_id',
              as: 'supervisorDetails'
            }
          },
          {
            $addFields: {
              agenteNombre: { $ifNull: [ { $arrayElemAt: ['$agenteDetails.username', 0] }, '$agenteNombre', '$agente' ] },
              // Respetar el valor almacenado en el lead (p.ej. 'ROBERTO') y usar lookup solo como fallback
              supervisor: { $ifNull: [ '$supervisor', { $arrayElemAt: ['$supervisorDetails.username', 0] } ] }
            }
          }
        ];

        if (Object.keys(projection).length > 0) {
          pipeline.push({ $project: projection });
        }

        let docs = await col.aggregate(pipeline).toArray();
        if (debugSource && docs && docs.length) {
          const dbName = (collInfo.db && (collInfo.db.databaseName || collInfo.db.s && collInfo.db.s.databaseName)) || '';
          docs = docs.map(d => ({
            ...d,
            __sourceDb: dbName,
            __sourceCollection: colName
          }));
        }
        if (debugSource) console.log(`[API /leads] ${colName} -> docsFetched=${docs?.length||0}`);
        if (docs && docs.length) {
          collected.push(...docs);
          remaining -= docs.length;
        }

        // reset offset una vez consumida la primera colección que requería skipping
        offset = 0;
        if (remaining <= 0) {
          if (debugSource) console.log('[API /leads] Ventana completada — remaining <= 0, deteniendo iteración de colecciones');
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

    // Normalizar _id a string para que el frontend pueda borrar con DELETE /api/leads/:id
    const normalized = (collected || []).map(d => ({
      ...d,
      _id: d && d._id ? String(d._id) : d?._id,
      id: (d && d.id) ? String(d.id) : (d && d._id ? String(d._id) : '')
    }));

    return res.json(Object.assign(
      { success: true, data: normalized, total: totalCount, page, pages },
      debugQuery ? { queryUsed: query } : {}
    ));
    // ====== FIN AGREGACIÓN MULTI-COLECCIÓN (PAGINADA) ======

  } catch (error) {
    console.error('[API] Error en GET /api/leads:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

/**
 * @route GET /api/leads/agents-summary
 * @desc Resumen por agente (ventas y puntos) para un mes (YYYY-MM)
 * @access Private
 */
router.get('/leads/agents-summary', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'Error de conexión a DB' });

    const monthRaw = String(req.query?.month || '').trim();
    const yearRaw = String(req.query?.year || '').trim();
    const agentNameRaw = String(req.query?.agentName || '').trim();
    const agentsRaw = String(req.query?.agents || '').trim();

    const parseMonth = (m, y) => {
      if (/^\d{4}-\d{2}$/.test(m)) {
        const [yy, mm] = m.split('-').map(Number);
        if (yy > 2000 && mm >= 1 && mm <= 12) return { year: yy, month: mm };
      }
      if (/^\d{1,2}$/.test(m) && /^\d{4}$/.test(y)) {
        const yy = Number(y);
        const mm = Number(m);
        if (yy > 2000 && mm >= 1 && mm <= 12) return { year: yy, month: mm };
      }
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    };
    const { year, month } = parseMonth(monthRaw, yearRaw);
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const ymPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const reYM = new RegExp(`^${ymPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');

    const normalizeList = (v) => {
      if (!v) return [];
      return String(v).split(',').map(s => s.trim()).filter(Boolean);
    };

    const roleLower = String(req.user?.role || '').toLowerCase();
    const isSupervisor = roleLower === 'supervisor' || roleLower.includes('supervisor');

    let agents = [];
    if (agentNameRaw) {
      agents = [agentNameRaw];
    } else {
      agents = normalizeList(agentsRaw);
    }

    if ((!agents || agents.length === 0) && isSupervisor) {
      try {
        const usersCol = db.collection('users');
        const supervisorUsername = String(req.user?.username || '').trim();
        const supervisorName = String(req.user?.name || req.user?.nombre || req.user?.fullName || '').trim();
        const supervisorTeam = String(req.user?.team || '').trim();
        const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || '')).trim();

        const or = [];
        if (currentUserId) or.push({ supervisorId: currentUserId });
        if (supervisorUsername) or.push({ supervisor: { $regex: supervisorUsername, $options: 'i' } });
        if (supervisorName) {
          or.push({ supervisor: { $regex: supervisorName, $options: 'i' } });
          or.push({ supervisorName: { $regex: supervisorName, $options: 'i' } });
          or.push({ manager: { $regex: supervisorName, $options: 'i' } });
        }
        if (supervisorTeam) or.push({ team: supervisorTeam });

        const and = [];
        if (or.length) and.push({ $or: or });
        and.push({ role: { $not: /supervisor/i } });

        const found = await usersCol.find(and.length ? { $and: and } : { role: { $not: /supervisor/i } }).project({ username: 1, name: 1, nombre: 1, fullName: 1 }).toArray();
        agents = (found || [])
          .flatMap(u => [u?.name, u?.nombre, u?.fullName, u?.username])
          .map(v => String(v || '').trim())
          .filter(Boolean);
      } catch (_) {
        agents = [];
      }
    }

    if (!Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ success: false, message: 'Parámetro requerido: agents (csv) o agentName (o ser supervisor con agentes asignados)' });
    }

    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const uniq = Array.from(new Set(agents.map(a => String(a || '').trim()).filter(Boolean)));
    const agentRegex = uniq.length ? new RegExp(`^(${uniq.map(esc).join('|')})$`, 'i') : null;

    const unifiedCollectionName = 'costumers_unified';
    let collectionName = 'costumers';
    try {
      const exists = await db.listCollections({ name: unifiedCollectionName }).toArray();
      if (Array.isArray(exists) && exists.length) collectionName = unifiedCollectionName;
    } catch (_) {}

    const col = db.collection(collectionName);
    const pipeline = [
      {
        $addFields: {
          _agentName: {
            $ifNull: [
              { $ifNull: ['$agenteNombre', '$agente'] },
              { $ifNull: ['$usuario', { $ifNull: ['$nombreAgente', '$vendedor'] }] }
            ]
          },
          _points: {
            $convert: {
              input: {
                $ifNull: [
                  '$puntaje',
                  { $ifNull: ['$puntos', { $ifNull: ['$_raw.puntaje', { $ifNull: ['$_raw.puntos', 0] }] }] }
                ]
              },
              to: 'double',
              onError: 0,
              onNull: 0
            }
          }
        }
      },
      { $match: { _agentName: { $regex: agentRegex } } },
      {
        $match: {
          $or: [
            { dia_venta: { $regex: reYM } },
            { fecha_contratacion: { $regex: reYM } },
            { '_raw.dia_venta': { $regex: reYM } },
            { '_raw.fecha_contratacion': { $regex: reYM } },
            { createdAt: { $gte: monthStart, $lte: monthEnd } },
            { creadoEn: { $gte: monthStart, $lte: monthEnd } }
          ]
        }
      },
      {
        $group: {
          _id: '$_agentName',
          ventas: { $sum: 1 },
          puntos: { $sum: '$_points' }
        }
      },
      { $sort: { ventas: -1, puntos: -1 } },
      {
        $project: {
          _id: 0,
          agente: '$_id',
          ventas: 1,
          puntos: { $round: ['$puntos', 2] }
        }
      }
    ];

    const data = await col.aggregate(pipeline, { maxTimeMS: 15_000 }).toArray();
    return res.json({ success: true, data, meta: { month: ymPrefix, collection: collectionName, agents: uniq.length } });
  } catch (e) {
    console.error('[API /leads/agents-summary] Error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * @route GET /api/leads/kpis
 * @desc KPIs de leads (totales del mes sin paginación)
 * @access Private
 */
router.get('/leads/kpis', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'Error de conexión a DB' });

    const { month, status, noAutoMonth, agentName, agents, vendedor, debug } = req.query;
    const isDebug = String(debug || '') === '1' || String(debug || '').toLowerCase() === 'true';
    let query = {};
    const andConditions = [];
    const baseAndConditions = [];

    const roleLowerMarket = String(req.user?.role || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const mercadoRestrict = (() => {
      if (roleLowerMarket === 'rol_icon' || roleLowerMarket === 'icon' || roleLowerMarket.includes('rol icon')) return 'ICON';
      if (roleLowerMarket === 'rol_bamo' || roleLowerMarket === 'bamo' || roleLowerMarket.includes('rol bamo')) return 'BAMO';
      return '';
    })();

    const mercadoCondition = (m) => ({
      $or: [
        { mercado: String(m).toUpperCase() },
        { mercado: String(m).toLowerCase() },
        { mercado: String(m) },
        { 'mercado': { $regex: `^${String(m)}$`, $options: 'i' } },
        { '_raw.mercado': { $regex: `^${String(m)}$`, $options: 'i' } }
      ]
    });

    if (mercadoRestrict) {
      andConditions.push(mercadoCondition(mercadoRestrict));
      baseAndConditions.push(mercadoCondition(mercadoRestrict));
    }

    if (status && String(status).toLowerCase() !== 'todos') {
      andConditions.push({ status: status });
      baseAndConditions.push({ status: status });
    }

    const roleLower0 = String(req.user?.role || '').toLowerCase();
    const isSupervisor0 = roleLower0 === 'supervisor' || roleLower0.includes('supervisor');
    const normalizeList = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
      return String(v).split(',').map(s => s.trim()).filter(Boolean);
    };
    const agentListRaw = normalizeList(agents);

    const toComparable = (s) => String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '');

    const rawVendor = String(vendedor || '').trim();
    let singleAgent = String(agentName || rawVendor || '').trim();
    if (isSupervisor0 && rawVendor) {
      const u1 = toComparable(req.user?.username || '');
      const u2 = toComparable(req.user?.name || req.user?.nombre || '');
      const v = toComparable(rawVendor);
      if (v && (v === u1 || v === u2)) singleAgent = '';
    }

    const agentList = (isSupervisor0 && !String(agentName || '').trim()) ? [] : agentListRaw;
    const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const makeExactAnyRegex = (names) => {
      const uniq = Array.from(new Set((names || []).map(s => String(s).trim()).filter(Boolean)));
      if (!uniq.length) return null;
      return new RegExp(`^(${uniq.map(escaped).join('|')})$`, 'i');
    };
    const agentRegex = singleAgent ? makeExactAnyRegex([singleAgent]) : (agentList.length ? makeExactAnyRegex(agentList) : null);
    if (isSupervisor0 && agentRegex) {
      const agentCond = {
        $or: [
          { agenteNombre: { $regex: agentRegex } },
          { agente: { $regex: agentRegex } },
          { createdBy: { $regex: agentRegex } },
          { creadoPor: { $regex: agentRegex } }
        ]
      };
      andConditions.push(agentCond);
      baseAndConditions.push(agentCond);
    }

    const disableAutoMonth = String(noAutoMonth || '').toLowerCase() === '1' || String(noAutoMonth || '').toLowerCase() === 'true';

    let querySale = null;
    let queryInstall = null;
    let queryColchon = null;
    let __colchonApplicable = false;
    let __targetYear = null;
    let __targetMonth = null;
    let __daysInMonth = null;

    if (!disableAutoMonth) {
      let targetYear;
      let targetMonth;

      if (month) {
        if (/^\d{4}-\d{2}$/.test(String(month))) {
          const [year, monthNum] = String(month).split('-').map(Number);
          targetYear = year;
          targetMonth = monthNum;
        } else if (/^\d{1,2}$/.test(String(month)) && req.query.year && /^\d{4}$/.test(String(req.query.year))) {
          targetYear = Number(req.query.year);
          targetMonth = Number(month);
        }
      }

      if (!Number.isInteger(targetYear) || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
        const now = new Date();
        targetYear = now.getFullYear();
        targetMonth = now.getMonth() + 1;
      }

      const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
      __targetYear = targetYear;
      __targetMonth = targetMonth;
      __daysInMonth = daysInMonth;
      const monthStr = String(targetMonth).padStart(2, '0');
      const monthNoPad = String(targetMonth);
      const dayVals = [];
      for (let d = 1; d <= daysInMonth; d++) {
        dayVals.push(String(d));
        dayVals.push(String(d).padStart(2, '0'));
      }
      const uniqDayVals = Array.from(new Set(dayVals)).sort((a, b) => a.length - b.length || a.localeCompare(b));
      const dayAlt = uniqDayVals.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const mAlt = [monthStr, monthNoPad].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const yEsc = String(targetYear).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const reYMD = new RegExp(`^${yEsc}-(?:${mAlt})-(?:${dayAlt})(?:\\b|T|\\s|$)`, 'i');
      const reYMDSlash = new RegExp(`^${yEsc}\\/(?:${mAlt})\\/(?:${dayAlt})(?:\\b|T|\\s|$)`, 'i');
      const reDMYSlash = new RegExp(`^(?:${dayAlt})\\/(?:${mAlt})\\/${yEsc}(?:\\b|\\s|$)`, 'i');
      const reDMYDash = new RegExp(`^(?:${dayAlt})-(?:${mAlt})-${yEsc}(?:\\b|\\s|$)`, 'i');
      const reMDYSlash = new RegExp(`^(?:${mAlt})\\/(?:${dayAlt})\\/${yEsc}(?:\\b|\\s|$)`, 'i');

      const monthStart = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(targetYear, targetMonth - 1, daysInMonth, 23, 59, 59, 999);

      const buildDateOr = (fields) => {
        const out = [];
        const paths = (fields || []).flatMap(f => [f, `_raw.${f}`]);
        for (const p of paths) {
          out.push({ [p]: { $regex: reYMD.source, $options: 'i' } });
          out.push({ [p]: { $regex: reYMDSlash.source, $options: 'i' } });
          out.push({ [p]: { $regex: reDMYSlash.source, $options: 'i' } });
          out.push({ [p]: { $regex: reDMYDash.source, $options: 'i' } });
          out.push({ [p]: { $regex: reMDYSlash.source, $options: 'i' } });
          out.push({ [p]: { $gte: monthStart, $lte: monthEnd } });
        }
        return out;
      };

      const saleDateOrConditions = [
        ...buildDateOr(['dia_venta', 'fecha_contratacion', 'diaVenta', 'fechaVenta', 'fecha_venta', 'fechaDeVenta', 'saleDate', 'sale_date']),
        { createdAt: { $gte: monthStart, $lte: monthEnd } },
        { creadoEn: { $gte: monthStart, $lte: monthEnd } },
        { actualizadoEn: { $gte: monthStart, $lte: monthEnd } }
      ];

      const installDateOrConditions = [
        ...buildDateOr(['dia_instalacion', 'fecha_instalacion', 'diaInstalacion', 'fechaInstalacion'])
      ];

      const saleQueryObj = baseAndConditions.length
        ? { $and: [...baseAndConditions, { $or: saleDateOrConditions }] }
        : { $or: saleDateOrConditions };

      const installQueryObj = baseAndConditions.length
        ? { $and: [...baseAndConditions, { $or: installDateOrConditions }] }
        : { $or: installDateOrConditions };

      querySale = saleQueryObj;
      queryInstall = installQueryObj;

      andConditions.push({ $or: saleDateOrConditions });

      try {
        const prev = new Date(targetYear, targetMonth - 2, 1);
        const prevYear = prev.getFullYear();
        const prevMonth = prev.getMonth() + 1;
        const prevDays = new Date(prevYear, prevMonth, 0).getDate();
        const prevMonthStr = String(prevMonth).padStart(2, '0');
        const prevMonthNoPad = String(prevMonth);
        const prevDayVals = [];
        for (let d = 1; d <= prevDays; d++) {
          prevDayVals.push(String(d));
          prevDayVals.push(String(d).padStart(2, '0'));
        }
        const prevUniqDayVals = Array.from(new Set(prevDayVals)).sort((a, b) => a.length - b.length || a.localeCompare(b));
        const prevDayAlt = prevUniqDayVals.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const prevMAlt = [prevMonthStr, prevMonthNoPad].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const prevYEsc = String(prevYear).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prevReYMD = new RegExp(`^${prevYEsc}-(?:${prevMAlt})-(?:${prevDayAlt})(?:\\b|T|\\s|$)`, 'i');
        const prevReYMDSlash = new RegExp(`^${prevYEsc}\\/(?:${prevMAlt})\\/(?:${prevDayAlt})(?:\\b|T|\\s|$)`, 'i');
        const prevReDMYSlash = new RegExp(`^(?:${prevDayAlt})\\/(?:${prevMAlt})\\/${prevYEsc}(?:\\b|\\s|$)`, 'i');
        const prevReDMYDash = new RegExp(`^(?:${prevDayAlt})-(?:${prevMAlt})-${prevYEsc}(?:\\b|\\s|$)`, 'i');
        const prevReMDYSlash = new RegExp(`^(?:${prevMAlt})\\/(?:${prevDayAlt})\\/${prevYEsc}(?:\\b|\\s|$)`, 'i');
        const prevMonthStart = new Date(prevYear, prevMonth - 1, 1, 0, 0, 0, 0);
        const prevMonthEnd = new Date(prevYear, prevMonth - 1, prevDays, 23, 59, 59, 999);

        const buildPrevDateOr = (fields) => {
          const out = [];
          const paths = (fields || []).flatMap(f => [f, `_raw.${f}`]);
          for (const p of paths) {
            out.push({ [p]: { $regex: prevReYMD.source, $options: 'i' } });
            out.push({ [p]: { $regex: prevReYMDSlash.source, $options: 'i' } });
            out.push({ [p]: { $regex: prevReDMYSlash.source, $options: 'i' } });
            out.push({ [p]: { $regex: prevReDMYDash.source, $options: 'i' } });
            out.push({ [p]: { $regex: prevReMDYSlash.source, $options: 'i' } });
            out.push({ [p]: { $gte: prevMonthStart, $lte: prevMonthEnd } });
          }
          return out;
        };

        const prevSaleOr = [
          ...buildPrevDateOr(['dia_venta', 'fecha_contratacion', 'diaVenta', 'fechaVenta', 'fecha_venta', 'fechaDeVenta', 'saleDate', 'sale_date']),
          { createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd } },
          { creadoEn: { $gte: prevMonthStart, $lte: prevMonthEnd } },
          { actualizadoEn: { $gte: prevMonthStart, $lte: prevMonthEnd } }
        ];

        __colchonApplicable = !(status && String(status).toLowerCase() !== 'todos');
        if (__colchonApplicable) {
          queryColchon = baseAndConditions.length
            ? { $and: [...baseAndConditions, { $or: prevSaleOr }, { $or: installDateOrConditions }] }
            : { $and: [{ $or: prevSaleOr }, { $or: installDateOrConditions }] };
        }
      } catch (_) {
        queryColchon = null;
        __colchonApplicable = false;
      }
    }

    if (andConditions.length > 0) query = { $and: andConditions };
    if (!querySale) querySale = (andConditions.length > 0) ? { $and: andConditions } : {};
    if (!queryInstall) queryInstall = (andConditions.length > 0) ? { $and: andConditions } : {};

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';

    const collectionsList = await db.listCollections().toArray();
    const allNames = collectionsList.map(c => c.name);
    const unifiedAvailable = preferUnified && allNames.includes(unifiedCollectionName);

    const collectionNamesList = unifiedAvailable
      ? [unifiedCollectionName]
      : allNames.filter(n => /^costumers(_|$)/i.test(n));

    let total = 0;
    let canceladas = 0;
    let activas = 0;
    let activasEfectivas = 0;
    let activasIcon = 0;
    let activasBamo = 0;
    let pendientes = 0;
    let puntajeMes = 0;
    let puntajeColchonExtra = 0;

    if (isDebug) {
      try {
        const srcName = (unifiedAvailable && unifiedCollectionName) ? unifiedCollectionName : (collectionNamesList && collectionNamesList[0]);
        const dbgColName = srcName || unifiedCollectionName;
        const dbgCol = dbgColName ? db.collection(dbgColName) : null;
        if (dbgCol) {
          const agentTeamAgg = await dbgCol.aggregate([
            { $match: querySale },
            {
              $addFields: {
                __agent: {
                  $ifNull: [
                    { $ifNull: [
                      '$agenteNombre',
                      { $ifNull: [
                        '$agente',
                        { $ifNull: [
                          '$usuario',
                          { $ifNull: [
                            '$nombreAgente',
                            { $ifNull: [
                              '$vendedor',
                              { $ifNull: [
                                '$createdBy',
                                { $ifNull: ['$creadoPor', { $ifNull: ['$_raw.agenteNombre', { $ifNull: ['$_raw.agente', { $ifNull: ['$_raw.vendedor', ''] }] }] }] }
                              ] }
                            ] }
                          ] }
                        ] }
                      ] }
                    ] },
                    ''
                  ]
                },
                __team: {
                  $ifNull: [
                    '$supervisor',
                    { $ifNull: ['$team', { $ifNull: ['$equipo', { $ifNull: ['$TEAM', { $ifNull: ['$_raw.supervisor', { $ifNull: ['$_raw.team', { $ifNull: ['$_raw.equipo', 'SIN EQUIPO'] }] }] }] }] }] }
                  ]
                }
              }
            },
            {
              $group: {
                _id: {
                  team: { $toUpper: { $trim: { input: { $toString: '$__team' } } } },
                  agent: { $trim: { input: { $toString: '$__agent' } } }
                },
                ventas: { $sum: 1 }
              }
            },
            { $sort: { '_id.team': 1, ventas: -1, '_id.agent': 1 } }
          ], { allowDiskUse: true, maxTimeMS: 20_000 }).toArray();

          const teamTotals = new Map();
          for (const r of (agentTeamAgg || [])) {
            const t = String(r?._id?.team || 'SIN EQUIPO');
            const v = Number(r?.ventas || 0) || 0;
            teamTotals.set(t, (teamTotals.get(t) || 0) + v);
          }

          console.log('[KPI DEBUG /api/leads/kpis] Params:', {
            month,
            status,
            agentName,
            agents,
            vendedor,
            mercadoRestrict,
            unifiedAvailable,
            dbgCollection: dbgColName
          });
          console.log('[KPI DEBUG /api/leads/kpis] querySale:', JSON.stringify(querySale));

          const preview = (agentTeamAgg || []).slice(0, 60).map(x => ({
            team: x?._id?.team,
            agent: x?._id?.agent,
            ventas: x?.ventas
          }));
          console.log('[KPI DEBUG /api/leads/kpis] Ventas por agente (primeros 60):', preview);
          console.log('[KPI DEBUG /api/leads/kpis] Totales por team (sumatoria agentes):', Array.from(teamTotals.entries()).sort((a, b) => b[1] - a[1]).map(([team, ventas]) => ({ team, ventas })));
        }
      } catch (e) {
        console.warn('[KPI DEBUG /api/leads/kpis] Error generando debug por agente/team:', e?.message);
      }
    }

    for (const colName of (collectionNamesList || [])) {
      try {
        const col = db.collection(colName);
        const reCancel = /cancel|anulad|no instalado/;
        const rePending = /pendient|pending/;
        const reActive = /\bcompleted\b|\bcompletad[ao]\b|\bterminad[ao]\b|\bactive\b|\bactiv[ao]\b/;
        const reReserva = /reserva/;
        const aggSale = await col.aggregate([
          { $match: querySale },
          {
            $project: {
              _status: {
                $toLower: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: [
                          '$status',
                          { $ifNull: ['$_raw.status', ''] }
                        ]
                      }
                    }
                  }
                }
              },
              _puntaje: {
                $convert: {
                  input: {
                    $ifNull: [
                      '$puntaje',
                      {
                        $ifNull: [
                          '$puntaje_calculado',
                          { $ifNull: ['$_raw.puntaje', { $ifNull: ['$_raw.puntaje_calculado', 0] }] }
                        ]
                      }
                    ]
                  },
                  to: 'double',
                  onError: 0,
                  onNull: 0
                }
              }
            }
          },
          {
            $group: {
              _id: null,
              total: {
                $sum: {
                  $cond: [
                    { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                    1,
                    0
                  ]
                }
              },
              canceladas: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                        { $regexMatch: { input: '$_status', regex: reCancel } }
                      ]
                    },
                    1,
                    0
                  ]
                }
              },
              pendientes: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                        { $regexMatch: { input: '$_status', regex: rePending } }
                      ]
                    },
                    1,
                    0
                  ]
                }
              },
              puntajeMes: {
                $sum: {
                  $cond: [
                    // Puntaje mensual cuenta todas las ventas del mes, excepto las que están en reserva.
                    { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                    '$_puntaje',
                    0
                  ]
                }
              }
            }
          }
        ]).toArray();

        const saleRow = aggSale && aggSale[0] ? aggSale[0] : null;
        total += Number(saleRow?.total || 0);
        canceladas += Number(saleRow?.canceladas || 0);
        pendientes += Number(saleRow?.pendientes || 0);
        puntajeMes += Number(saleRow?.puntajeMes || 0);

        const aggInstall = await col.aggregate([
          { $match: queryInstall },
          {
            $project: {
              _status: {
                $toLower: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: [
                          '$status',
                          { $ifNull: ['$_raw.status', ''] }
                        ]
                      }
                    }
                  }
                }
              },
              _mercado: {
                $toUpper: {
                  $trim: {
                    input: {
                      $toString: {
                        $ifNull: [
                          '$mercado',
                          { $ifNull: ['$_raw.mercado', ''] }
                        ]
                      }
                    }
                  }
                }
              }
            }
          },
          {
            $group: {
              _id: null,
              activas: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                        { $regexMatch: { input: '$_status', regex: reActive } }
                      ]
                    },
                    1,
                    0
                  ]
                }
              },
              activasEfectivas: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                        { $regexMatch: { input: '$_status', regex: reActive } },
                        { $not: [{ $regexMatch: { input: '$_status', regex: reCancel } }] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              },
              activasIcon: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                        { $regexMatch: { input: '$_status', regex: reActive } },
                        { $not: [{ $regexMatch: { input: '$_status', regex: reCancel } }] },
                        { $eq: ['$_mercado', 'ICON'] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              },
              activasBamo: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $not: [{ $regexMatch: { input: '$_status', regex: reReserva } }] },
                        { $regexMatch: { input: '$_status', regex: reActive } },
                        { $not: [{ $regexMatch: { input: '$_status', regex: reCancel } }] },
                        { $eq: ['$_mercado', 'BAMO'] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ]).toArray();

        const instRow = aggInstall && aggInstall[0] ? aggInstall[0] : null;
        activas += Number(instRow?.activas || 0);
        activasEfectivas += Number(instRow?.activasEfectivas || 0);
        activasIcon += Number(instRow?.activasIcon || 0);
        activasBamo += Number(instRow?.activasBamo || 0);

        if (__colchonApplicable && queryColchon) {
          const aggColchon = await col.aggregate([
            { $match: queryColchon },
            {
              $project: {
                _status: {
                  $toLower: {
                    $trim: {
                      input: {
                        $toString: {
                          $ifNull: [
                            '$status',
                            { $ifNull: ['$_raw.status', ''] }
                          ]
                        }
                      }
                    }
                  }
                },
                _puntaje: {
                  $convert: {
                    input: {
                      $ifNull: [
                        '$puntaje',
                        {
                          $ifNull: [
                            '$puntaje_calculado',
                            { $ifNull: ['$_raw.puntaje', { $ifNull: ['$_raw.puntaje_calculado', 0] }] }
                          ]
                        }
                      ]
                    },
                    to: 'double',
                    onError: 0,
                    onNull: 0
                  }
                }
              }
            },
            {
              $group: {
                _id: null,
                puntajeColchonExtra: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $regexMatch: { input: '$_status', regex: reActive } },
                          { $not: [{ $regexMatch: { input: '$_status', regex: reCancel } }] }
                        ]
                      },
                      '$_puntaje',
                      0
                    ]
                  }
                }
              }
            }
          ]).toArray();
          const cRow = aggColchon && aggColchon[0] ? aggColchon[0] : null;
          puntajeColchonExtra += Number(cRow?.puntajeColchonExtra || 0);
        }
      } catch (e) {
        console.warn('[API /leads/kpis] Error en colección', colName, e?.message || e);
      }
    }

    puntajeMes = Math.round(puntajeMes * 100) / 100;
    puntajeColchonExtra = Math.round(puntajeColchonExtra * 100) / 100;
    const puntajeMensual = Math.round((puntajeMes + puntajeColchonExtra) * 100) / 100;

    return res.json({
      success: true,
      kpis: {
        totalMes: total,
        canceladas,
        pendientes,
        activas,
        activasEfectivas,
        activasIcon,
        activasBamo,
        puntajeMensual,
        puntajeColchonExtra,
        puntajeBaseMes: puntajeMes,
        ventasEfectivasMes: Math.max(0, total - canceladas)
      }
    });
  } catch (e) {
    console.error('[API] Error en GET /api/leads/kpis:', e);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});



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

// Diagnóstico: comparar conteos en costumers_unified (mes completo vs 1..hoy) y ver samples de fechas
router.get('/leads/unified-month-debug', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'No DB' });

    const month = String(req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: 'month debe ser YYYY-MM' });
    }

    const [targetYear, targetMonth] = month.split('-').map(Number);
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const now = new Date();
    const isCurrentTargetMonth = (targetYear === now.getFullYear()) && (targetMonth === (now.getMonth() + 1));
    const lastDay = isCurrentTargetMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;

    const monthStartFull = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
    const monthEndFull = new Date(targetYear, targetMonth - 1, daysInMonth, 23, 59, 59, 999);
    const monthStartToday = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
    const monthEndToday = new Date(targetYear, targetMonth - 1, lastDay, 23, 59, 59, 999);

    const monthStr = String(targetMonth).padStart(2, '0');
    const monthNoPad = String(targetMonth);
    const yEsc = String(targetYear).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mAlt = [monthStr, monthNoPad].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const reMonthYMD = new RegExp(`^${yEsc}-(?:${mAlt})-`, 'i');
    const reMonthYMDSlash = new RegExp(`^${yEsc}\\/(?:${mAlt})\\/`, 'i');

    const unifiedCol = db.collection('costumers_unified');

    const fieldsToCheck = [
      'dia_venta',
      'fecha_contratacion',
      'diaVenta',
      'fechaVenta',
      'fecha_venta',
      'saleDate',
      'sale_date',
      'dia_instalacion',
      'fecha_instalacion',
      'diaInstalacion',
      'fechaInstalacion',
      '_raw.dia_venta',
      '_raw.fecha_contratacion',
      '_raw.diaVenta',
      '_raw.fechaContratacion',
      '_raw.fechaVenta',
      '_raw.fecha_venta',
      '_raw.saleDate',
      '_raw.sale_date',
      '_raw.dia_instalacion',
      '_raw.fecha_instalacion'
    ];

    const monthFieldOr = [];
    for (const p of fieldsToCheck) {
      monthFieldOr.push({ [p]: { $regex: reMonthYMD.source, $options: 'i' } });
      monthFieldOr.push({ [p]: { $regex: reMonthYMDSlash.source, $options: 'i' } });
    }

    const queryFullMonth = {
      $or: [
        ...monthFieldOr,
        { createdAt: { $gte: monthStartFull, $lte: monthEndFull } },
        { creadoEn: { $gte: monthStartFull, $lte: monthEndFull } },
        { actualizadoEn: { $gte: monthStartFull, $lte: monthEndFull } }
      ]
    };

    const queryUptoToday = {
      $or: [
        ...monthFieldOr,
        { createdAt: { $gte: monthStartToday, $lte: monthEndToday } },
        { creadoEn: { $gte: monthStartToday, $lte: monthEndToday } },
        { actualizadoEn: { $gte: monthStartToday, $lte: monthEndToday } }
      ]
    };

    const [countFull, countUptoToday] = await Promise.all([
      unifiedCol.countDocuments(queryFullMonth),
      unifiedCol.countDocuments(queryUptoToday)
    ]);

    const samples = await unifiedCol
      .find(queryFullMonth, {
        projection: {
          dia_venta: 1,
          fecha_contratacion: 1,
          diaVenta: 1,
          fechaVenta: 1,
          fecha_venta: 1,
          saleDate: 1,
          sale_date: 1,
          dia_instalacion: 1,
          fecha_instalacion: 1,
          diaInstalacion: 1,
          fechaInstalacion: 1,
          _raw: 1,
          createdAt: 1,
          creadoEn: 1,
          actualizadoEn: 1
        }
      })
      .limit(10)
      .toArray();

    return res.json({
      success: true,
      month,
      isCurrentTargetMonth,
      lastDay,
      counts: {
        fullMonth: countFull,
        uptoToday: countUptoToday
      },
      samples
    });
  } catch (error) {
    console.error('[API /leads/unified-month-debug] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
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
    unifiedAvailable = await __collectionExists(db, unifiedCollectionName);

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
            activas: agentData.filter(d => {
              const st = String(d?.status || '').toLowerCase();
              return st.includes('complet') || st.includes('active') || st.includes('activ');
            }).length
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
router.put('/leads/:id/status', protect, authorize('Administrador','Backoffice'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    unifiedAvailable = await __collectionExists(db, unifiedCollectionName);

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

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    unifiedAvailable = await __collectionExists(db, unifiedCollectionName);

    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    
    const allCostumersCollections = await __getCostumersCollectionsCached(db);
    const costumersCollections = (preferUnified && unifiedAvailable)
      ? [unifiedCollectionName, ...allCostumersCollections.filter(n => n !== unifiedCollectionName)]
      : allCostumersCollections;
    
    let lead = null;
    let foundInCollection = null;
    
    if (preferUnified && unifiedAvailable) {
      try {
        const unifiedCol = db.collection(unifiedCollectionName);
        lead = await __findLeadInCollection(unifiedCol, recordId, objId);
        if (lead) {
          foundInCollection = unifiedCollectionName;
          console.log(`[GET /leads/:id] Lead encontrado en ${unifiedCollectionName}`);
        }
      } catch (e) {
        console.warn('[GET /leads/:id] Error buscando en unificada:', e && e.message);
      }
    }

    if (!lead) {
      try {
        const primaryCol = db.collection('costumers');
        lead = await __findLeadInCollection(primaryCol, recordId, objId);
        if (lead) {
          foundInCollection = 'costumers';
          console.log('[GET /leads/:id] Lead encontrado en costumers');
        }
      } catch (e) {
        console.warn('[GET /leads/:id] Error buscando en costumers:', e && e.message);
      }
    }

    if (!lead) {
      for (const colName of costumersCollections) {
        if (colName === unifiedCollectionName || colName === 'costumers') continue;
        const collection = db.collection(colName);
        lead = await __findLeadInCollection(collection, recordId, objId);
        if (lead) {
          foundInCollection = colName;
          console.log(`[GET /leads/:id] Lead encontrado en ${colName}`);
          break;
        }
      }
    }

    if (!lead) {
      console.warn(`[GET /leads/:id] Lead ${recordId} no encontrado en ninguna colección`);
      // Fallback: TEAM_LINEAS
      const tl = await __findLeadInTeamLineasDb(req, recordId, objId);
      if (!tl || !tl.lead) {
        return res.status(404).json({ success: false, message: 'Lead no encontrado' });
      }

      console.log(`[GET /leads/:id] Lead encontrado en TEAM_LINEAS.${tl.collectionName}`);
      return res.json({ success: true, data: tl.lead, lead: tl.lead, foundInCollection: `TEAM_LINEAS.${tl.collectionName}` });
    }

    console.log(`[GET /leads/:id] Lead encontrado en ${foundInCollection}. Enriqueciendo con datos de usuario...`);

    // Una vez encontrado el lead, enriquecerlo con una agregación para obtener nombres
    try {
      const collection = db.collection(foundInCollection);
      const pipeline = [
        { $match: { _id: lead._id } },
        {
          $addFields: {
            agenteObjId: { $convert: { input: "$agenteId", to: "objectId", onError: null, onNull: null } },
            supervisorObjId: { $convert: { input: "$supervisorId", to: "objectId", onError: null, onNull: null } }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'agenteObjId',
            foreignField: '_id',
            as: 'agenteDetails'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'supervisorObjId',
            foreignField: '_id',
            as: 'supervisorDetails'
          }
        },
        {
          $addFields: {
            // Usar el valor más reciente de agenteNombre que se guardó en PUT
            // Si tiene el campo actualizado, usarlo. Si no, usar fallback.
            agenteNombre: { $coalesce: [ '$agenteNombre', { $arrayElemAt: ['$agenteDetails.username', 0] }, '$agente' ] },
            // Limpiar el campo antiguo 'representante' para evitar confusión
            representante: '$$REMOVE',
            supervisor: { $ifNull: [ '$supervisor', { $arrayElemAt: ['$supervisorDetails.username', 0] } ] }
          }
        },
        {
          $project: {
            agenteDetails: 0,
            supervisorDetails: 0,
            agenteObjId: 0,
            supervisorObjId: 0
          }
        }
      ];

      const enrichedResult = await collection.aggregate(pipeline, { maxTimeMS: 10_000 }).toArray();

      if (enrichedResult.length > 0) {
        const enrichedLead = enrichedResult[0];
        console.log(`[GET /leads/:id] Lead enriquecido exitosamente.`);
        return res.json({ success: true, data: enrichedLead, lead: enrichedLead, foundInCollection });
      } else {
        console.warn(`[GET /leads/:id] No se pudo enriquecer el lead, devolviendo datos originales.`);
        return res.json({ success: true, data: lead, lead: lead, foundInCollection });
      }
    } catch (enrichError) {
      console.error(`[GET /leads/:id] Error durante el enriquecimiento del lead:`, enrichError);
      // Fallback: devolver el lead original si el enriquecimiento falla
      return res.json({ success: true, data: lead, lead: lead, foundInCollection });
    }
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
router.put('/leads/:id', protect, authorize('Administrador','Backoffice','Supervisor','Supervisor Team Lineas','Agente'), async (req, res, next) => {
  try {
    const { id: recordId } = req.params;

    try {
      console.log('[PUT /api/leads/:id][ROUTES_API] hit', {
        recordId,
        bodyKeys: Object.keys(req.body || {}),
        supervisor: req.body?.supervisor,
        supervisorId: req.body?.supervisorId,
        team: req.body?.team,
        user: req.user?.username
      });
    } catch (_) {}
    
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

    // SOLUCIÓN DEFINITIVA: Guardar el representante en TODOS los posibles nombres de campo
    // para asegurar que funciona sin importar qué nombre use el sistema
    if (updateData.representante) {
      const repValue = updateData.representante;
      updateData.agenteNombre = repValue;  // Campo oficial
      updateData.agente = repValue;         // Alternativa 1
      updateData.rep = repValue;            // Alternativa 2
      updateData.agent = repValue;          // Alternativa 3
      updateData.representante = repValue;  // Mantener original también
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'No hay datos para actualizar' });
    }

    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }

    try {
      const keys = Object.keys(updateData || {});
      const onlyNotas = keys.length === 1 && keys[0] === 'notas';
      if (onlyNotas) {
        const q = __buildLeadOrQuery(recordId, objId);

        const hint = String((req.query && (req.query.collection || req.query.collectionName)) || req.headers['x-collection-hint'] || '').trim();
        const tasks = [];
        const wrap = async (label, fn) => {
          try {
            const r = await fn();
            return { label, r };
          } catch (e) {
            return { label, error: e };
          }
        };

        tasks.push(wrap('costumers_unified', async () => {
          return await db.collection('costumers_unified').updateOne(q, { $set: updateData }, { maxTimeMS: 3_500 });
        }));

        tasks.push(wrap('costumers', async () => {
          return await db.collection('costumers').updateOne(q, { $set: updateData }, { maxTimeMS: 3_500 });
        }));

        if (hint) {
          tasks.push(wrap(`TEAM_LINEAS.${hint}`, async () => {
            const dbTL = getDbFor('TEAM_LINEAS');
            if (!dbTL) throw new Error('TEAM_LINEAS DB no disponible');
            return await dbTL.collection(hint).updateOne(q, { $set: updateData }, { maxTimeMS: 3_500 });
          }));
        }

        // Ejecutar en paralelo para que el wall time sea ~maxTimeMS (no la suma)
        const results = await Promise.all(tasks);
        const hit = results.find(x => x && x.r && x.r.matchedCount && x.r.matchedCount > 0);
        if (hit) {
          return res.json({ success: true, message: 'Lead actualizado correctamente', data: { id: recordId, ...updateData }, updatedCollection: hit.label });
        }

        // Fallback rápido: buscar en otras colecciones costumers* (sin escaneo largo)
        try {
          const idOnlyOr = (() => {
            const or = [];
            if (objId) or.push({ _id: objId });
            or.push({ _id: recordId });
            return { $or: or };
          })();

          const collections = await __getCostumersCollectionsCached(db);
          const start = Date.now();
          for (const colName of collections) {
            if (colName === 'costumers' || colName === 'costumers_unified') continue;
            if ((Date.now() - start) > 6_000) break;
            try {
              const rX = await db.collection(colName).updateOne(idOnlyOr, { $set: updateData }, { maxTimeMS: 900 });
              if (rX && rX.matchedCount && rX.matchedCount > 0) {
                return res.json({ success: true, message: 'Lead actualizado correctamente', data: { id: recordId, ...updateData }, updatedCollection: colName });
              }
            } catch (_) {
              // continue
            }
          }
        } catch (_) {
          // ignore
        }

        return res.status(404).json({ success: false, message: 'Lead no encontrado' });
      }
    } catch (_) {
      // continuar flujo normal
    }

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    unifiedAvailable = await __collectionExists(db, unifiedCollectionName);
    
    // Actualizar en TODAS las colecciones costumers*; si existe unificada, priorizarla primero.
    const allCostumersCollections = await __getCostumersCollectionsCached(db);

    const costumersCollections = (preferUnified && unifiedAvailable)
      ? [unifiedCollectionName, ...allCostumersCollections.filter(n => n !== unifiedCollectionName)]
      : allCostumersCollections;
    
    let result = null;
    let updatedCollection = null;
    let matchedFilter = null;

    // Primero localizar el lead (find) en las colecciones para evitar múltiples escrituras
    let foundLead = null;
    if (preferUnified && unifiedAvailable) {
      try {
        const unifiedCol = db.collection(unifiedCollectionName);
        foundLead = await __findLeadInCollection(unifiedCol, recordId, objId);
        if (foundLead) {
          updatedCollection = unifiedCollectionName;
          matchedFilter = (foundLead && foundLead._id !== undefined) ? { _id: foundLead._id } : (objId ? { _id: objId } : { _id: recordId });
          console.log(`[PUT /leads/:id] Lead encontrado en ${unifiedCollectionName}`);
        }
      } catch (e) {
        console.warn('[PUT /leads/:id] Error buscando en unificada:', e && e.message);
      }
    }

    if (!foundLead) {
      try {
        const primaryCol = db.collection('costumers');
        foundLead = await __findLeadInCollection(primaryCol, recordId, objId);
        if (foundLead) {
          updatedCollection = 'costumers';
          matchedFilter = (foundLead && foundLead._id !== undefined) ? { _id: foundLead._id } : (objId ? { _id: objId } : { _id: recordId });
          console.log('[PUT /leads/:id] Lead encontrado en costumers');
        }
      } catch (e) {
        console.warn('[PUT /leads/:id] Error buscando en costumers:', e && e.message);
      }
    }

    if (!foundLead) {
      for (const colName of costumersCollections) {
        if (colName === unifiedCollectionName || colName === 'costumers') continue;
        const collection = db.collection(colName);
        foundLead = await __findLeadInCollection(collection, recordId, objId);
        if (foundLead) {
          updatedCollection = colName;
          matchedFilter = (foundLead && foundLead._id !== undefined) ? { _id: foundLead._id } : (objId ? { _id: objId } : { _id: recordId });
          console.log(`[PUT /leads/:id] Lead encontrado en ${colName}`);
          break;
        }
      }
    }

    if (!foundLead) {
      console.log('[PUT /leads/:id] Lead no encontrado en ninguna colección');
      // Fallback: TEAM_LINEAS (principalmente para guardar notas)
      const tl = await __findLeadInTeamLineasDb(req, recordId, objId);
      if (!tl || !tl.lead) {
        return res.status(404).json({ success: false, message: 'Lead no encontrado' });
      }

      const dbTL = getDbFor('TEAM_LINEAS');
      try {
        const targetCol = dbTL.collection(tl.collectionName);
        const filter = (tl.lead && tl.lead._id !== undefined) ? { _id: tl.lead._id } : (objId ? { _id: objId } : { _id: recordId });
        const r = await targetCol.updateOne(filter, { $set: updateData }, { maxTimeMS: 12_000 });
        console.log(`[PUT /leads/:id] updateOne ejecutado en TEAM_LINEAS.${tl.collectionName}`, { matched: r.matchedCount, modified: r.modifiedCount });
        return res.json({
          success: true,
          message: 'Lead actualizado correctamente',
          data: { id: recordId, ...updateData },
          updatedCollection: `TEAM_LINEAS.${tl.collectionName}`
        });
      } catch (e) {
        console.error('[PUT /leads/:id] Error actualizando en TEAM_LINEAS:', e && e.message);
        return res.status(500).json({ success: false, message: 'Error interno al actualizar lead', error: e && e.message });
      }
    }

    // Si el documento encontrado en la colección unificada indica la colección origen,
    // preferir actualizar en esa colección si existe (evita inconsistencias).
    try {
      if (foundLead && foundLead.sourceCollection && foundLead.sourceId) {
        const possible = String(foundLead.sourceCollection || '').trim();
        if (possible) {
          const exists = (await db.listCollections({ name: possible }).toArray()).length > 0;
          if (exists) {
            // Preferir la colección origen
            const srcIdRaw = String(foundLead.sourceId || '').trim();
            let srcFilter = { sourceId: srcIdRaw };
            try {
              if (/^[a-fA-F0-9]{24}$/.test(srcIdRaw)) srcFilter = { _id: new ObjectId(srcIdRaw) };
            } catch (e) { /* noop */ }
            updatedCollection = possible;
            matchedFilter = srcFilter;
            console.log('[PUT /leads/:id] Usando sourceCollection para update:', possible, matchedFilter);
          }
        }
      }
    } catch (e) {
      console.warn('[PUT /leads/:id] Error comprobando sourceCollection:', e && e.message);
    }

    // Ejecutar una sola actualización en la colección encontrada
    try {
      if (!matchedFilter) {
        // Si matchedFilter no fue establecido en altKeys, inferirlo desde el documento encontrado
        if (foundLead && foundLead._id) matchedFilter = { _id: foundLead._id };
        else if (foundLead && foundLead.id) matchedFilter = { id: foundLead.id };
        else matchedFilter = { _id: recordId };
      }
      
      // Paso 1: Actualizar con $set
      result = await db.collection(updatedCollection).updateOne(matchedFilter, { $set: updateData }, { maxTimeMS: 12_000 });
      
      // Paso 2: Si actualizamos agenteNombre, eliminar el campo representante antiguo para evitar conflicto
      if (updateData.agenteNombre) {
        try {
          await db.collection(updatedCollection).updateOne(matchedFilter, { $unset: { representante: '' } }, { maxTimeMS: 3_000 });
        } catch (e) {
          // ignore
        }
      }

      // Considerar exitosa la actualización si se encontró el documento (matched=1), aunque no haya cambios (modified=0)
      // Esto ocurre cuando los valores nuevos son iguales a los viejos
      const updateSuccess = result.matchedCount > 0;

      // Si estamos actualizando en una colección origen distinta, sincronizar también en costumers_unified.
      // De lo contrario, el GET /api/leads/:id puede seguir devolviendo datos antiguos desde la unificada.
      try {
        if (unifiedAvailable && updatedCollection && updatedCollection !== unifiedCollectionName) {
          const unifiedCol = db.collection(unifiedCollectionName);
          const qId = __buildLeadOrQuery(recordId, objId);
          const tasks = [];
          const wrap = async (label, fn) => {
            try {
              const r = await fn();
              return { label, r };
            } catch (e) {
              return { label, error: e };
            }
          };

          // 1) Si el ID de edición corresponde al documento unificado, esto lo actualiza.
          tasks.push(wrap('unified.byId', async () => {
            return await unifiedCol.updateOne(qId, { $set: updateData }, { maxTimeMS: 6_000 });
          }));

          // 2) Si el lead unificado tiene referencia a origen, intentar por sourceCollection/sourceId.
          if (foundLead && foundLead.sourceCollection && foundLead.sourceId) {
            const sc = String(foundLead.sourceCollection || '').trim();
            const sid = String(foundLead.sourceId || '').trim();
            if (sc && sid) {
              tasks.push(wrap('unified.bySource', async () => {
                return await unifiedCol.updateOne({ sourceCollection: sc, sourceId: sid }, { $set: updateData }, { maxTimeMS: 6_000 });
              }));
            }
          } else {
            // 3) Fallback: intentar relacionar por (sourceCollection = updatedCollection, sourceId = recordId)
            tasks.push(wrap('unified.bySourceFallback', async () => {
              return await unifiedCol.updateOne({ sourceCollection: String(updatedCollection), sourceId: String(recordId) }, { $set: updateData }, { maxTimeMS: 6_000 });
            }));
          }

          const uniResults = await Promise.all(tasks);
          const uniHit = uniResults.find(x => x && x.r && x.r.matchedCount && x.r.matchedCount > 0);
          if (uniHit) {
            console.log('[PUT /leads/:id] Sincronizado en costumers_unified:', uniHit.label, { matched: uniHit.r.matchedCount, modified: uniHit.r.modifiedCount });
            
            // Si actualizamos agenteNombre, eliminar representante antiguo en unified también
            if (updateData.agenteNombre) {
              try {
                const filter = uniHit.label === 'unified.byId' ? qId :
                  uniHit.label === 'unified.bySource' ? { sourceCollection: foundLead.sourceCollection, sourceId: foundLead.sourceId } :
                  { sourceCollection: String(updatedCollection), sourceId: String(recordId) };
                const unsetRes = await unifiedCol.updateOne(filter, { $unset: { representante: '' } }, { maxTimeMS: 3_000 });
              } catch (e) {
                // ignore
              }
            }
          }
        }
      } catch (syncErr) {
        // ignore
      }
    } catch (uErr) {
      console.error('[PUT /leads/:id] Error realizando updateOne en la colección encontrada:', uErr && uErr.message);
      return res.status(500).json({ success: false, message: 'Error interno al actualizar lead', error: uErr && uErr.message });
    }

    // Emitir notificación Socket.io si se actualizaron notas
    if (updateData.notas && global.io) {
      (async () => {
        try {
          const collection = db.collection(updatedCollection || 'costumers');
          const lead = await collection.findOne(matchedFilter || (objId ? { _id: objId } : { _id: recordId }));
          if (lead) {
            const ownerId = lead.agenteId || lead.agente || lead.odigo || lead.createdBy;
            const clientName = lead.nombre_cliente || lead.nombre || 'Cliente';
            const author = req.user?.username || req.user?.name || 'Usuario';
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
      })();
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
    const role = (user?.role || '').toLowerCase().trim();
    const allowedRoles = ['admin', 'administrador', 'administrator', 'backoffice', 'back office', 'back_office', 'b.o', 'b:o', 'b-o', 'bo'];
    
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

    const { legacy } = req.query || {};
    const preferUnified = String(legacy) !== '1';
    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      unifiedAvailable = Array.isArray(u) && u.length > 0;
    } catch (_) {}

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
    
    const isBackoffice = role === 'backoffice' || role === 'back office' || role === 'back_office';
    const isVendedor = role === 'vendedor' || role === 'agente' || role === 'agent' || role === 'seller';
    const isTeamLineas = team.includes('lineas') || role === 'lineas-agentes' || role === 'supervisor team lineas' || (role === 'supervisor' && team.includes('lineas')) || role === 'admin' || role === 'administrador' || role === 'rol_icon' || role === 'rol-icon' || role === 'rolicon' || isBackoffice || isVendedor;
    
    console.log('[API /lineas-team] isTeamLineas:', isTeamLineas, 'isVendedor:', isVendedor, 'isBackoffice:', isBackoffice);
    
    if (!isTeamLineas) {
      console.log('[API /lineas-team] Acceso denegado para usuario:', username);
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
    
    // Admin y BackOffice ven TODO
    if (role === 'admin' || role === 'administrador' || role === 'rol_icon' || role === 'rol-icon' || role === 'rolicon' || isBackoffice) {
      const collections = await db.listCollections().toArray();
      console.log('[API /lineas-team] Admin/BackOffice/rol_icon - Colecciones disponibles:', collections.map(c => c.name));
      
      for (const coll of collections) {
        const docs = await db.collection(coll.name).find({}).toArray();
        console.log(`[API /lineas-team] Colección ${coll.name}: ${docs.length} documentos`);
        leads = leads.concat(docs.map(d => ({ ...d, _collectionName: coll.name })));
      }
      console.log('[API /lineas-team] Total leads para admin/backoffice/rol_icon:', leads.length);
    } else if (role === 'supervisor' || role === 'supervisor team lineas') {
      // Supervisor ve solo leads de sus agentes asignados
      const collections = await db.listCollections().toArray();
      console.log('[API /lineas-team] Supervisor - Buscando leads de agentes asignados');
      
      for (const coll of collections) {
        const docs = await db.collection(coll.name).find({}).toArray();
        // Filtrar por supervisor
        const filteredDocs = docs.filter(doc => {
          const supervisor = String(doc.supervisor || '').toUpperCase();
          return supervisor.includes(username.toUpperCase()) || supervisor === username.toUpperCase();
        });
        leads = leads.concat(filteredDocs.map(d => ({ ...d, _collectionName: coll.name })));
      }
    } else {
      // Agente ve solo su colección (sus propios leads)
      const collection = db.collection(collectionName);
      leads = await collection.find({}).toArray();
      leads = leads.map(d => ({ ...d, _collectionName: collectionName }));
    }

    const normalizeKey = (v) => {
      try {
        return String(v || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
      } catch {
        return String(v || '').trim().toLowerCase();
      }
    };

    const supervisorMap = {
      'alexis_rodrigues': 'JONATHAN F',
      'alexis_rodriguez': 'JONATHAN F',
      'cristian_rivera': 'JONATHAN F',
      'dennis_vasquez': 'JONATHAN F',
      'edward_ramirez': 'JONATHAN F',
      'jocelyn_reyes': 'JONATHAN F',
      'melanie_hurtado': 'JONATHAN F',
      'nancy_lopez': 'JONATHAN F',
      'oscar_rivera': 'JONATHAN F',
      'victor_hurtado': 'JONATHAN F',
      'jonathan_f': 'JONATHAN F',
      'cesar_claros': 'LUIS G',
      'daniel_del_cid': 'LUIS G',
      'fernando_beltran': 'LUIS G',
      'jonathan_garcia': 'LUIS G',
      'karla_rodriguez': 'LUIS G',
      'karla_ponce': 'LUIS G',
      'luis_g': 'LUIS G',
      'manuel_flores': 'LUIS G',
      'tatiana_giron': 'LUIS G'
    };

    const toAgentUpper = (col) => String(col || '').replace(/_/g, ' ').trim().toUpperCase();
    const resolveSupervisor = (col) => {
      const k = normalizeKey(col);
      if (!k) return '';
      if (supervisorMap[k]) return supervisorMap[k];
      for (const [key, sup] of Object.entries(supervisorMap)) {
        const firstToken = key.split('_')[0];
        if (firstToken && k.includes(firstToken)) return sup;
      }
      return '';
    };
    
    // Normalizar _id a string para que el frontend reciba IDs válidos
    // Enviar el campo ID del lead si existe, y no sobrescribirlo con el _id
    leads = leads.map(d => ({
      ...d,
      supervisor: d.supervisor || resolveSupervisor(d._collectionName || collectionName),
      agenteAsignado: d.agenteAsignado || d.agenteNombre || d.agente || toAgentUpper(d._collectionName || collectionName),
      agenteNombre: d.agenteNombre || d.agenteAsignado || d.agente || toAgentUpper(d._collectionName || collectionName),
      agente: d.agente || d.agenteAsignado || d.agenteNombre || toAgentUpper(d._collectionName || collectionName),
      _id: d._id ? String(d._id) : d._id,
      id: d.id ? String(d.id) : (d._id ? String(d._id) : ''),
      ID: d.ID ? String(d.ID) : (d.id ? String(d.id) : '')
    }));
    console.log('[API /lineas-team] Leads encontrados:', leads.length);
    res.json({ success: true, data: leads });
  } catch (error) {
    console.error('[API /lineas-team] Error:', error.message);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
});

// PUT /lineas-team/status - Actualizar STATUS de registro de Team Líneas
router.put('/lineas-team/status', protect, async (req, res) => {
  try {
    const user = req.user;
    const username = user?.username || '';
    const role = (user?.role || '').toLowerCase();
    const team = (user?.team || '').toLowerCase();
    
    console.log('[API PUT /lineas-team/status] Usuario:', username, 'Rol:', role);
    
    // Verificar permisos
    const canEdit = role.includes('admin') || role.includes('administrador') || role.includes('backoffice') || role.includes('rol_icon') || role.includes('supervisor') || team.includes('lineas');
    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para cambiar el STATUS' });
    }
    
    const { id, status } = req.body;
    
    if (!id || !status) {
      return res.status(400).json({ success: false, message: 'ID y STATUS son requeridos' });
    }
    
    // Conectar a la base de datos TEAM_LINEAS
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      console.error('[API PUT /lineas-team/status] No se pudo conectar a TEAM_LINEAS');
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }
    
    const { ObjectId } = require('mongodb');
    
    // Buscar y actualizar en todas las colecciones de agentes
    let updated = false;
    let collections = [];
    try {
      const cols = await db.listCollections().toArray();
      collections = cols.map(c => c.name);
    } catch (e) {
      // Fallback a lista conocida si listCollections falla
      collections = ['JOCELYN_REYES', 'EDWARD_RAMIREZ', 'VICTOR_HURTADO', 'CRISTIAN_RIVERA', 'NANCY_LOPEZ', 'OSCAR_RIVERA', 'DANIEL_DEL_CID', 'FERNANDO_BELTRAN', 'KARLA_RODRIGUEZ', 'KARLA_PONCE'];
    }

    console.log('[API PUT /lineas-team/status] Collections to search:', collections);
    for (const colName of collections) {
      try {
        const collection = db.collection(colName);
        // Intent 1: _id como ObjectId
        let tried = [];
        try {
          const objId = new ObjectId(id);
          const result = await collection.updateOne(
            { _id: objId },
            { $set: { status: String(status).toUpperCase(), actualizadoEn: new Date() } }
          );
          tried.push({ method: '_id:ObjectId', matched: result.matchedCount, modified: result.modifiedCount });
          if (result.modifiedCount > 0) {
            updated = true;
            console.log(`[API PUT /lineas-team/status] Status actualizado en colección ${colName} para ID ${id} (ObjectId)`);
            break;
          }
        } catch (e) {
          // id no es ObjectId válido o fallo, continuamos con otros intentos
          tried.push({ method: '_id:ObjectId', error: String(e) });
        }

        // Intent 2: _id como string
        try {
          const result2 = await collection.updateOne(
            { _id: id },
            { $set: { status: String(status).toUpperCase(), actualizadoEn: new Date() } }
          );
          tried.push({ method: '_id:string', matched: result2.matchedCount, modified: result2.modifiedCount });
          if (result2.modifiedCount > 0) {
            updated = true;
            console.log(`[API PUT /lineas-team/status] Status actualizado en colección ${colName} para ID ${id} (string _id)`);
            break;
          }
        } catch (e) {
          tried.push({ method: '_id:string', error: String(e) });
        }

        // Intent 3: campo id (algunos documentos usan 'id')
        try {
          const result3 = await collection.updateOne(
            { id: id },
            { $set: { status: String(status).toUpperCase(), actualizadoEn: new Date() } }
          );
          tried.push({ method: 'field:id', matched: result3.matchedCount, modified: result3.modifiedCount });
          if (result3.modifiedCount > 0) {
            updated = true;
            console.log(`[API PUT /lineas-team/status] Status actualizado en colección ${colName} para ID ${id} (field id)`);
            break;
          }
        } catch (e) {
          tried.push({ method: 'field:id', error: String(e) });
        }

        // Para diagnóstico, loguear intentos en esta colección
        console.log(`[API PUT /lineas-team/status] intentos en ${colName}:`, tried);
      } catch (e) {
        // Continuar con siguiente colección
        console.error(`[API PUT /lineas-team/status] Error iterando colección ${colName}:`, e);
      }
    }
    
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'STATUS actualizado correctamente'
    });
    
  } catch (error) {
    console.error('[API PUT /lineas-team/status] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar el STATUS', error: error.message });
  }
});

// PUT /lineas-team/line-status - Actualizar STATUS de una línea individual
router.put('/lineas-team/line-status', protect, async (req, res) => {
  try {
    const user = req.user;
    const username = user?.username || '';
    const role = (user?.role || '').toLowerCase();
    const team = (user?.team || '').toLowerCase();
    
    console.log('[API PUT /lineas-team/line-status] Usuario:', username, 'Rol:', role);
    
    // Verificar permisos
    const canEdit = role.includes('admin') || role.includes('administrador') || role.includes('backoffice') || role.includes('rol_icon') || role.includes('supervisor') || team.includes('lineas');
    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para cambiar el STATUS' });
    }
    
    const { clientId, lineIndex, status } = req.body;
    
    if (!clientId || lineIndex === undefined || !status) {
      return res.status(400).json({ success: false, message: 'clientId, lineIndex y status son requeridos' });
    }
    
    // Conectar a la base de datos TEAM_LINEAS
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      console.error('[API PUT /lineas-team/line-status] No se pudo conectar a TEAM_LINEAS');
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }
    
    const { ObjectId } = require('mongodb');
    
    // Buscar y actualizar en todas las colecciones de agentes
    let updated = false;
    let collections = [];
    try {
      const cols = await db.listCollections().toArray();
      collections = cols.map(c => c.name);
    } catch (e) {
      collections = ['JOCELYN_REYES', 'EDWARD_RAMIREZ', 'VICTOR_HURTADO', 'CRISTIAN_RIVERA', 'NANCY_LOPEZ', 'OSCAR_RIVERA', 'DANIEL_DEL_CID', 'FERNANDO_BELTRAN', 'KARLA_RODRIGUEZ', 'KARLA_PONCE'];
    }

    console.log('[API PUT /lineas-team/line-status] Buscando cliente:', clientId, 'para actualizar línea', lineIndex);
    
    for (const colName of collections) {
      try {
        const collection = db.collection(colName);
        
        // Intentar con ObjectId
        let result = null;
        try {
          const objId = new ObjectId(clientId);
          result = await collection.updateOne(
            { _id: objId },
            { 
              $set: { 
                [`lineas_status.${lineIndex}`]: String(status).toUpperCase(),
                actualizadoEn: new Date() 
              } 
            }
          );
          if (result.modifiedCount > 0) {
            updated = true;
            console.log(`[API PUT /lineas-team/line-status] Status de línea ${lineIndex} actualizado en ${colName}`);
            break;
          }
        } catch (e) {
          // Intentar con string
          result = await collection.updateOne(
            { _id: clientId },
            { 
              $set: { 
                [`lineas_status.${lineIndex}`]: String(status).toUpperCase(),
                actualizadoEn: new Date() 
              } 
            }
          );
          if (result.modifiedCount > 0) {
            updated = true;
            console.log(`[API PUT /lineas-team/line-status] Status de línea ${lineIndex} actualizado en ${colName}`);
            break;
          }
        }
      } catch (e) {
        console.error(`[API PUT /lineas-team/line-status] Error en colección ${colName}:`, e);
      }
    }
    
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
    
    return res.status(200).json({ 
      success: true, 
      message: `Status de línea ${lineIndex + 1} actualizado a ${status}`
    });
    
  } catch (error) {
    console.error('[API PUT /lineas-team/line-status] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar el status de la línea', error: error.message });
  }
});

router.post('/lineas-team/backfill-lineas-status', protect, async (req, res) => {
  try {
    const user = req.user;
    const role = String(user?.role || '').toLowerCase();
    const canRun = role.includes('admin') || role.includes('administrador');
    if (!canRun) {
      return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para administradores.' });
    }

    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }

    const normalizeLineStatus = (v) => {
      const s = String(v || '').trim().toUpperCase();
      return s || '';
    };

    const getLineStatusForIdx = (doc, idx) => {
      try {
        const ls = doc?.lineas_status;
        if (ls && typeof ls === 'object' && Object.prototype.hasOwnProperty.call(ls, idx)) {
          const norm = normalizeLineStatus(ls[idx]);
          if (norm) return norm;
        }
      } catch (_) {}

      try {
        const rawLs = doc?._raw?.lineas_status;
        if (rawLs && typeof rawLs === 'object' && Object.prototype.hasOwnProperty.call(rawLs, idx)) {
          const norm = normalizeLineStatus(rawLs[idx]);
          if (norm) return norm;
        }
      } catch (_) {}

      try {
        const lines = Array.isArray(doc?.lines) ? doc.lines : null;
        const row = lines && lines[idx] ? lines[idx] : null;
        if (row) {
          const norm = normalizeLineStatus(row.estado ?? row.status ?? row.STATUS ?? row.state);
          if (norm) return norm;
        }
      } catch (_) {}

      try {
        const rawLines = Array.isArray(doc?._raw?.lines) ? doc._raw.lines : (Array.isArray(doc?._raw?.lineas) ? doc._raw.lineas : null);
        const row = rawLines && rawLines[idx] ? rawLines[idx] : null;
        if (row) {
          const norm = normalizeLineStatus(row.estado ?? row.status ?? row.STATUS ?? row.state);
          if (norm) return norm;
        }
      } catch (_) {}

      const global = normalizeLineStatus(doc?.status ?? doc?.STATUS ?? doc?._raw?.status ?? doc?._raw?.STATUS);
      if (global) return global;
      return 'PENDING';
    };

    const getLineDataForIdx = (doc, idx) => {
      let telefono = '';
      let servicio = '';

      try {
        const arr = Array.isArray(doc?.telefonos) ? doc.telefonos : null;
        if (arr && arr[idx] != null) telefono = String(arr[idx] || '');
      } catch (_) {}

      try {
        const arr = Array.isArray(doc?._raw?.telefonos) ? doc._raw.telefonos : null;
        if (!telefono && arr && arr[idx] != null) telefono = String(arr[idx] || '');
      } catch (_) {}

      try {
        const arr = Array.isArray(doc?.servicios) ? doc.servicios : null;
        if (arr && arr[idx] != null) servicio = String(arr[idx] || '');
      } catch (_) {}

      try {
        const arr = Array.isArray(doc?._raw?.servicios) ? doc._raw.servicios : null;
        if (!servicio && arr && arr[idx] != null) servicio = String(arr[idx] || '');
      } catch (_) {}

      try {
        const arr = Array.isArray(doc?.lines) ? doc.lines : null;
        const row = arr && arr[idx] ? arr[idx] : null;
        if (row) {
          if (!telefono && row.telefono != null) telefono = String(row.telefono || '');
          if (!servicio && row.servicio != null) servicio = String(row.servicio || '');
        }
      } catch (_) {}

      try {
        const arr = Array.isArray(doc?._raw?.lines) ? doc._raw.lines : (Array.isArray(doc?._raw?.lineas) ? doc._raw.lineas : null);
        const row = arr && arr[idx] ? arr[idx] : null;
        if (row) {
          if (!telefono && row.telefono != null) telefono = String(row.telefono || '');
          if (!servicio && row.servicio != null) servicio = String(row.servicio || '');
        }
      } catch (_) {}

      return { telefono, servicio };
    };

    let collections = [];
    try {
      collections = (await db.listCollections().toArray()).map(c => c && c.name).filter(Boolean);
    } catch (_) {
      collections = [];
    }

    const stats = {
      collections: collections.length,
      scanned: 0,
      matched: 0,
      updated: 0,
      errors: 0
    };

    for (const colName of collections) {
      const col = db.collection(colName);

      let cursor;
      try {
        cursor = col.find({ $or: [{ lineas_status: { $exists: false } }, { lineas_status: null }, { lineas_status: {} }] });
      } catch (_) {
        cursor = col.find({});
      }

      const ops = [];
      const maxOps = 500;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        stats.scanned++;

        const cantidadLineas = Number(doc?.cantidad_lineas || doc?._raw?.cantidad_lineas || 0) || 0;
        if (!cantidadLineas || cantidadLineas < 1) continue;

        const hasLineasStatus = doc?.lineas_status && typeof doc.lineas_status === 'object' && Object.keys(doc.lineas_status).length > 0;
        if (hasLineasStatus) continue;

        stats.matched++;

        const newLineasStatus = {};
        const newLines = [];
        let anyStatus = false;

        const globalNorm = normalizeLineStatus(doc?.status ?? doc?.STATUS ?? doc?._raw?.status ?? doc?._raw?.STATUS);
        const hasExplicitLineasStatus = (() => {
          try {
            const ls = doc?.lineas_status;
            if (ls && typeof ls === 'object' && Object.keys(ls).length > 0) return true;
          } catch (_) {}
          try {
            const rls = doc?._raw?.lineas_status;
            if (rls && typeof rls === 'object' && Object.keys(rls).length > 0) return true;
          } catch (_) {}
          return false;
        })();

        for (let i = 0; i < cantidadLineas; i++) {
          let st = getLineStatusForIdx(doc, i);

          // Heurística segura:
          // Si el lead global está PENDING y NO hay lineas_status explícito, no confiar en estados "ACTIVE"
          // que vienen de _raw.lines (históricamente el frontend enviaba ACTIVE por defecto).
          if (!hasExplicitLineasStatus && globalNorm === 'PENDING' && st === 'ACTIVE') {
            st = 'PENDING';
          }

          if (!st) st = globalNorm || 'PENDING';
          if (st) anyStatus = true;
          newLineasStatus[i] = st || 'PENDING';

          const ld = getLineDataForIdx(doc, i);
          newLines.push({ telefono: ld.telefono || '', servicio: ld.servicio || '', estado: newLineasStatus[i] });
        }

        if (!anyStatus) continue;

        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                lineas_status: newLineasStatus,
                lines: newLines,
                actualizadoEn: new Date()
              }
            }
          }
        });

        if (ops.length >= maxOps) {
          try {
            const r = await col.bulkWrite(ops, { ordered: false });
            stats.updated += (r.modifiedCount || 0);
          } catch (_) {
            stats.errors++;
          }
          ops.length = 0;
        }
      }

      if (ops.length) {
        try {
          const r = await col.bulkWrite(ops, { ordered: false });
          stats.updated += (r.modifiedCount || 0);
        } catch (_) {
          stats.errors++;
        }
      }
    }

    return res.json({ success: true, stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error en backfill', error: error.message });
  }
});

/**
 * @route POST /api/lineas-team/set-all-lines-pending
 * @desc Cambiar TODAS las líneas de TODOS los leads a PENDING (masivo)
 * @access Private (admin only)
 */
router.post('/lineas-team/set-all-lines-pending', protect, async (req, res) => {
  try {
    console.log('[SET-ALL-LINES-PENDING] Iniciando proceso...');
    const user = req.user;
    console.log('[SET-ALL-LINES-PENDING] Usuario:', user?.username, 'Role:', user?.role);
    
    const role = String(user?.role || '').toLowerCase();
    const canRun = role.includes('admin') || role.includes('administrador');
    if (!canRun) {
      console.log('[SET-ALL-LINES-PENDING] Acceso denegado para:', user?.username);
      return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para administradores.' });
    }

    console.log('[SET-ALL-LINES-PENDING] Acceso autorizado, conectando a DB...');
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      console.error('[SET-ALL-LINES-PENDING] Error de conexión a DB');
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }

    let collections = [];
    try {
      collections = (await db.listCollections().toArray()).map(c => c && c.name).filter(Boolean);
      console.log('[SET-ALL-LINES-PENDING] Colecciones encontradas:', collections.length);
    } catch (_) {
      collections = [];
    }

    const stats = {
      collections: collections.length,
      scanned: 0,
      updated: 0,
      errors: 0,
      totalLinesChanged: 0
    };

    console.log('[SET-ALL-LINES-PENDING] Procesando', collections.length, 'colecciones...');

    // Aumentar timeout para esta operación larga
    req.socket.setTimeout(10 * 60 * 1000); // 10 minutos
    res.setTimeout(10 * 60 * 1000); // 10 minutos

    for (const colName of collections) {
      console.log(`[SET-ALL-LINES-PENDING] Procesando colección: ${colName}`);
      const col = db.collection(colName);
      
      // Obtener TODOS los documentos que tengan líneas
      const cursor = col.find({
        $or: [
          { cantidad_lineas: { $gt: 0 } },
          { lineas_status: { $exists: true } },
          { lines: { $exists: true } }
        ]
      });

      const ops = [];
      const maxOps = 500;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        stats.scanned++;

        const cantidadLineas = Number(doc?.cantidad_lineas || doc?._raw?.cantidad_lineas || 0) || 0;
        if (!cantidadLineas || cantidadLineas < 1) continue;

        stats.matched = (stats.matched || 0) + 1;

        // Crear lineas_status todo en PENDING
        const newLineasStatus = {};
        const newLines = Array.isArray(doc?.lines) ? doc.lines.map(x => ({ ...x })) : [];
        
        for (let i = 0; i < cantidadLineas; i++) {
          newLineasStatus[i] = 'PENDING';
          if (newLines[i]) newLines[i].estado = 'PENDING';
          stats.totalLinesChanged++;
        }

        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                lineas_status: newLineasStatus,
                ...(newLines.length ? { lines: newLines } : {}),
                actualizadoEn: new Date()
              }
            }
          }
        });

        if (ops.length >= maxOps) {
          try {
            const r = await col.bulkWrite(ops, { ordered: false });
            stats.updated += (r.modifiedCount || 0);
            console.log(`[SET-ALL-LINES-PENDING] Batch actualizado: ${r.modifiedCount} documentos`);
          } catch (e) {
            console.error('Error bulkWrite:', e);
            stats.errors++;
          }
          ops.length = 0;
        }
      }

      // Procesar ops restantes
      if (ops.length > 0) {
        try {
          const r = await col.bulkWrite(ops, { ordered: false });
          stats.updated += (r.modifiedCount || 0);
          console.log(`[SET-ALL-LINES-PENDING] Batch final actualizado: ${r.modifiedCount} documentos`);
        } catch (e) {
          console.error('Error bulkWrite final:', e);
          stats.errors++;
        }
      }
    }

    console.log('[SET-ALL-LINES-PENDING] Proceso completado:', stats);
    res.json({
      success: true,
      message: `Proceso completado. ${stats.updated} documentos actualizados. ${stats.totalLinesChanged} líneas cambiadas a PENDING.`,
      stats
    });

  } catch (error) {
    console.error('[SET-ALL-LINES-PENDING] Error fatal:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/lineas-team/collections
 * @desc Obtener lista de colecciones de TEAM_LINEAS
 * @access Private (admin only)
 */
router.get('/lineas-team/collections', protect, async (req, res) => {
  try {
    const user = req.user;
    const role = String(user?.role || '').toLowerCase();
    const canRun = role.includes('admin') || role.includes('administrador');
    if (!canRun) {
      return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para administradores.' });
    }

    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }

    let collections = [];
    try {
      collections = (await db.listCollections().toArray()).map(c => c && c.name).filter(Boolean);
    } catch (_) {
      collections = [];
    }

    res.json({
      success: true,
      collections
    });

  } catch (error) {
    console.error('[GET COLLECTIONS] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route POST /api/lineas-team/set-all-lines-pending-batch
 * @desc Cambiar líneas a PENDING para una colección específica
 * @access Private (admin only)
 */
router.post('/lineas-team/set-all-lines-pending-batch', protect, async (req, res) => {
  try {
    const user = req.user;
    const role = String(user?.role || '').toLowerCase();
    const canRun = role.includes('admin') || role.includes('administrador');
    if (!canRun) {
      return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para administradores.' });
    }

    const { collection } = req.body;
    if (!collection) {
      return res.status(400).json({ success: false, message: 'Se requiere el nombre de la colección' });
    }

    console.log(`[BATCH-PENDING] Procesando colección: ${collection}`);
    
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }

    const col = db.collection(collection);
    
    // Obtener todos los documentos con líneas
    const cursor = col.find({
      $or: [
        { cantidad_lineas: { $gt: 0 } },
        { lineas_status: { $exists: true } },
        { lines: { $exists: true } }
      ]
    });

    const ops = [];
    const maxOps = 100; // Más pequeño para procesar más rápido
    const stats = {
      scanned: 0,
      updated: 0,
      errors: 0,
      totalLinesChanged: 0
    };

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      stats.scanned++;

      const cantidadLineas = Number(doc?.cantidad_lineas || doc?._raw?.cantidad_lineas || 0) || 0;
      if (!cantidadLineas || cantidadLineas < 1) continue;

      // Crear lineas_status todo en PENDING
      const newLineasStatus = {};
      const newLines = Array.isArray(doc?.lines) ? doc.lines.map(x => ({ ...x })) : [];
      
      for (let i = 0; i < cantidadLineas; i++) {
        newLineasStatus[i] = 'PENDING';
        if (newLines[i]) newLines[i].estado = 'PENDING';
        stats.totalLinesChanged++;
      }

      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              lineas_status: newLineasStatus,
              ...(newLines.length ? { lines: newLines } : {}),
              actualizadoEn: new Date()
            }
          }
        }
      });

      if (ops.length >= maxOps) {
        try {
          const r = await col.bulkWrite(ops, { ordered: false });
          stats.updated += (r.modifiedCount || 0);
        } catch (e) {
          console.error('Error bulkWrite:', e);
          stats.errors++;
        }
        ops.length = 0;
      }
    }

    // Procesar ops restantes
    if (ops.length > 0) {
      try {
        const r = await col.bulkWrite(ops, { ordered: false });
        stats.updated += (r.modifiedCount || 0);
      } catch (e) {
        console.error('Error bulkWrite final:', e);
        stats.errors++;
      }
    }

    console.log(`[BATCH-PENDING] ${collection} completado:`, stats);
    
    res.json({
      success: true,
      message: `Colección ${collection} procesada. ${stats.updated} documentos actualizados.`,
      stats
    });

  } catch (error) {
    console.error('[BATCH-PENDING] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/lineas-team/repair-lineas-status-pending', protect, async (req, res) => {
  try {
    const user = req.user;
    const role = String(user?.role || '').toLowerCase();
    const canRun = role.includes('admin') || role.includes('administrador');
    if (!canRun) {
      return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para administradores.' });
    }

    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB TEAM_LINEAS' });
    }

    const normalizeLineStatus = (v) => {
      const s = String(v || '').trim().toUpperCase();
      return s || '';
    };

    let collections = [];
    try {
      collections = (await db.listCollections().toArray()).map(c => c && c.name).filter(Boolean);
    } catch (_) {
      collections = [];
    }

    const stats = {
      collections: collections.length,
      scanned: 0,
      matched: 0,
      updated: 0,
      errors: 0
    };

    for (const colName of collections) {
      const col = db.collection(colName);

      const cursor = col.find({
        $or: [{ status: 'PENDING' }, { status: 'pending' }, { status: { $regex: /^pending$/i } }]
      });

      const ops = [];
      const maxOps = 500;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        stats.scanned++;

        const cantidadLineas = Number(doc?.cantidad_lineas || doc?._raw?.cantidad_lineas || 0) || 0;
        if (!cantidadLineas || cantidadLineas < 1) continue;

        const ls = doc?.lineas_status;
        if (!ls || typeof ls !== 'object') continue;

        const vals = [];
        for (let i = 0; i < cantidadLineas; i++) {
          const v = normalizeLineStatus(ls[i]);
          if (v) vals.push(v);
        }

        if (!vals.length) continue;

        // Solo reparar casos claramente incorrectos: lead global PENDING y TODAS las líneas quedaron ACTIVE.
        const allActive = vals.length === cantidadLineas && vals.every(v => v === 'ACTIVE');
        if (!allActive) continue;

        // Evitar tocar casos donde existía lineas_status explícito original en _raw
        const rawLs = doc?._raw?.lineas_status;
        if (rawLs && typeof rawLs === 'object' && Object.keys(rawLs).length > 0) continue;

        stats.matched++;

        const newLineasStatus = {};
        const newLines = Array.isArray(doc?.lines) ? doc.lines.map(x => ({ ...x })) : [];
        for (let i = 0; i < cantidadLineas; i++) {
          newLineasStatus[i] = 'PENDING';
          if (newLines[i]) newLines[i].estado = 'PENDING';
        }

        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                lineas_status: newLineasStatus,
                ...(newLines.length ? { lines: newLines } : {}),
                actualizadoEn: new Date()
              }
            }
          }
        });

        if (ops.length >= maxOps) {
          try {
            const r = await col.bulkWrite(ops, { ordered: false });
            stats.updated += (r.modifiedCount || 0);
          } catch (_) {
            stats.errors++;
          }
          ops.length = 0;
        }
      }

      if (ops.length) {
        try {
          const r = await col.bulkWrite(ops, { ordered: false });
          stats.updated += (r.modifiedCount || 0);
        } catch (_) {
          stats.errors++;
        }
      }
    }

    return res.json({ success: true, stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error en repair', error: error.message });
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

// TEMPORAL: Verificar campos de leads de un agente y datos del usuario
router.get('/temp-check-leads', async (req, res) => {
  try {
    const { getDbFor } = require('../config/db');
    const dbTL = getDbFor('TEAM_LINEAS');
    const dbMain = getDb();
    
    // Buscar info de un usuario por nombre/username (ej: Manuel Flores, Nancy Lopez)
    let userInfo = null;
    if (dbMain) {
      const userSearch = String(req.query.user || req.query.search || 'manuel flores');
      const userRegex = new RegExp(userSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const user = await dbMain.collection('users').findOne({
        $or: [
          { username: userRegex },
          { name: userRegex }
        ]
      });
      if (user) {
        userInfo = {
          id: user._id?.toString(),
          username: user.username,
          name: user.name,
          role: user.role,
          team: user.team,
          supervisor: user.supervisor
        };
      }
    }
    
    if (!dbTL) return res.status(500).json({ success: false, message: 'DB TEAM_LINEAS no disponible', userInfo });
    
    const collectionName = req.query.collection || 'MANUEL_FLORES';
    const leads = await dbTL.collection(collectionName).find({}).limit(3).toArray();
    const totalLeads = await dbTL.collection(collectionName).countDocuments();
    
    return res.json({
      success: true,
      collection: collectionName,
      totalLeads,
      userInfo,
      sample: leads.map(l => ({
        id: l._id?.toString(),
        agente: l.agente,
        agenteAsignado: l.agenteAsignado,
        agenteNombre: l.agenteNombre,
        _collectionName: l._collectionName,
        userId: l.userId?.toString(),
        nombre_cliente: l.nombre_cliente,
        dia_venta: l.dia_venta,
        status: l.status
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// TEMPORAL: Buscar usuarios por nombre/username (útil para detectar duplicados)
// Uso: /api/temp-find-users?search=manuel%20flores
router.get('/temp-find-users', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const search = String(req.query.search || req.query.q || '').trim();
    if (!search) {
      return res.status(400).json({ success: false, message: 'Parámetro requerido: search' });
    }

    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');

    const users = await db.collection('users')
      .find({ $or: [{ username: rx }, { name: rx }] })
      .project({ username: 1, name: 1, role: 1, team: 1, supervisor: 1, createdAt: 1 })
      .limit(50)
      .toArray();

    return res.json({
      success: true,
      search,
      count: users.length,
      users: users.map(u => ({
        id: u._id?.toString(),
        username: u.username,
        name: u.name,
        role: u.role,
        team: u.team,
        supervisor: u.supervisor,
        createdAt: u.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// TEMPORAL: Vincular leads de un agente a un usuario (ELIMINAR DESPUÉS DE USAR)
router.get('/temp-link-leads', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });
    
    // También buscar en la DB de Team Líneas
    const { getDbFor } = require('../config/db');
    const dbTL = getDbFor('TEAM_LINEAS');
    
    const agentName = req.query.agent || 'Manuel Flores';
    let userId = req.query.userId;
    const execute = req.query.execute === 'true';

    // Si no se pasa userId, intentar resolverlo desde la colección users
    if (!userId) {
      try {
        const agentRegex = new RegExp(String(agentName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const u = await db.collection('users').findOne({
          $or: [
            { username: agentRegex },
            { name: agentRegex }
          ]
        });
        if (u?._id) userId = String(u._id);
      } catch (_) {}
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: `No se encontró userId para el agente "${agentName}". Pasa ?userId=... o asegúrate que el usuario exista en users.`
      });
    }
    
    // Convertir nombre a formato de colección (MANUEL_FLORES)
    const collectionName = agentName.toUpperCase().replace(/\s+/g, '_');
    
    let allLeads = [];
    let collectionsFound = [];
    
    // Buscar en Team Líneas por nombre de colección (cada agente tiene su propia colección)
    if (dbTL) {
      const tlCollections = await dbTL.listCollections().toArray();
      const tlColNames = tlCollections.map(c => c.name);
      
      // Buscar colección que coincida con el nombre del agente
      const matchingCol = tlColNames.find(name => 
        name.toUpperCase().includes(collectionName) || 
        collectionName.includes(name.toUpperCase().replace(/_/g, ' ').trim())
      );
      
      if (matchingCol) {
        const found = await dbTL.collection(matchingCol).find({}).toArray();
        if (found.length > 0) {
          allLeads.push(...found.map(l => ({ ...l, _collection: matchingCol, _db: 'team_lineas' })));
          collectionsFound.push({ db: 'team_lineas', collection: matchingCol, count: found.length });
        }
      }
      
      // Si no encontramos colección exacta, listar todas las disponibles
      if (collectionsFound.length === 0) {
        return res.json({ 
          success: false, 
          message: `No se encontró colección para: ${agentName} (buscando: ${collectionName})`,
          availableCollections: tlColNames,
          teamLineasAvailable: true
        });
      }
    }
    
    if (allLeads.length === 0) {
      return res.json({ 
        success: false, 
        message: 'No se encontraron leads para: ' + agentName,
        searchedCollections: collectionsFound.length,
        teamLineasAvailable: !!dbTL
      });
    }
    
    if (!execute) {
      return res.json({
        success: true,
        message: `Se encontraron ${allLeads.length} leads en la colección "${collectionsFound[0]?.collection}" para "${agentName}". Agrega &execute=true para vincularlos al usuario ${userId}`,
        count: allLeads.length,
        collectionsFound,
        sample: allLeads.slice(0, 5).map(l => ({ 
          id: l._id.toString(), 
          nombre: l.nombre || l.name || l.cliente || l.customer_name, 
          collection: l._collection,
          db: l._db
        }))
      });
    }
    
    // Ejecutar la actualización
    const { ObjectId } = require('mongodb');
    const userObjId = new ObjectId(userId);
    let totalModified = 0;
    
    for (const colInfo of collectionsFound) {
      const targetDb = colInfo.db === 'team_lineas' ? dbTL : db;
      if (!targetDb) continue;
      
      const result = await targetDb.collection(colInfo.collection).updateMany(
        {},
        {
          $set: {
            userId: userObjId,
            agente: agentName,
            updatedAt: new Date()
          }
        }
      );
      totalModified += result.modifiedCount;
    }
    
    return res.json({
      success: true,
      message: `${totalModified} leads vinculados al usuario ${userId}`,
      modifiedCount: totalModified,
      collectionsUpdated: collectionsFound
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// TEMPORAL: Cambiar contraseña de un usuario (ELIMINAR DESPUÉS DE USAR)
// Uso: /api/temp-change-password?search=flores&newpass=ManuFlo26@
router.get('/temp-change-password', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });
    
    const search = req.query.search || 'manuel';
    const newpass = req.query.newpass;
    const bcrypt = require('bcryptjs');
    
    // Obtener TODAS las colecciones de la base de datos
    const allCollections = await db.listCollections().toArray();
    const collectionNames = allCollections.map(c => c.name);
    
    // Buscar usuarios que coincidan en TODAS las colecciones
    const regex = new RegExp(search, 'i');
    let allUsers = [];
    
    for (const col of collectionNames) {
      try {
        const found = await db.collection(col).find({ 
          $or: [
            { username: regex }, 
            { name: regex }, 
            { nombre: regex }, 
            { agente: regex },
            { vendedor: regex },
            { seller: regex },
            { agent_name: regex }
          ] 
        }).toArray();
        if (found.length > 0) {
          allUsers.push(...found.map(u => ({ ...u, _collection: col })));
        }
      } catch (e) { /* error en colección */ }
    }
    
    const users = allUsers;
    
    if (users.length === 0) {
      return res.json({ success: false, message: 'No se encontraron usuarios con: ' + search });
    }
    
    if (users.length > 1 && newpass) {
      return res.json({ 
        success: false, 
        message: 'Múltiples usuarios encontrados. Sé más específico.',
        usuarios: users.map(u => ({ id: u._id.toString(), username: u.username, name: u.name || u.nombre, collection: u._collection }))
      });
    }
    
    if (!newpass) {
      return res.json({ 
        success: true, 
        message: 'Usuarios encontrados (agrega &newpass=CONTRASEÑA para cambiar)',
        usuarios: users.map(u => ({ id: u._id.toString(), username: u.username, name: u.name || u.nombre, collection: u._collection }))
      });
    }
    
    const user = users[0];
    const hash = await bcrypt.hash(newpass, 10);
    const collection = user._collection || 'users';
    await db.collection(collection).updateOne({ _id: user._id }, { $set: { password: hash } });
    
    return res.json({ 
      success: true, 
      message: 'Contraseña actualizada a: ' + newpass,
      usuario: { id: user._id.toString(), username: user.username, name: user.name }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Listar usuarios básicos para administración (sin password)
router.get('/users/admin-list', protect, async (req, res) => {
  console.log('[ADMIN-LIST] Endpoint llamado por usuario:', req.user?.username, 'rol:', req.user?.role);
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const role = (req.user?.role || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isAdmin = role.includes('admin') || role.includes('backoffice');
    if (!isAdmin) {
      console.log('[ADMIN-LIST] Acceso denegado para rol:', req.user?.role);
      return res.status(403).json({ success: false, message: 'No autorizado para listar usuarios' });
    }
    console.log('[ADMIN-LIST] Acceso permitido para rol:', req.user?.role);

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
      equipo: u.equipo || null,
      TEAM: u.TEAM || null,
      Team: u.Team || null,
      supervisor: u.supervisor || null,
      supervisorName: u.supervisorName || u.supervisor_nombre || u.supervisorNombre || null,
      supervisorId: (u.supervisorId && u.supervisorId.toString) ? u.supervisorId.toString() : (u.supervisorId || null),
      supervisor_id: (u.supervisor_id && u.supervisor_id.toString) ? u.supervisor_id.toString() : (u.supervisor_id || null),
      supervisorObjId: (u.supervisorObjId && u.supervisorObjId.toString) ? u.supervisorObjId.toString() : (u.supervisorObjId || null),
      supervisorObjectId: (u.supervisorObjectId && u.supervisorObjectId.toString) ? u.supervisorObjectId.toString() : (u.supervisorObjectId || null)
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

    const allowedRoles = [
      'admin', 'Administrador', 'administrador', 'Administrativo', 
      'supervisor', 'supervisora',
      'vendedor', 'usuario', 'agente', 'agent',
      'backoffice', 'back office', 'Back Office', 'back_office', 'bo', 'BO', 'b.o', 'b:o'
    ];
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

// POST /api/crm_agente -> guardar lead en colección del agente asignado
router.post('/crm_agente', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const leadData = req.body || {};
    const agenteAsignado = leadData.agenteAsignado;
    const agente = leadData.agente;

    let targetAgentName = agenteAsignado || agente;
    if (!targetAgentName) {
      return res.status(400).json({ success: false, message: 'Se requiere agente o agenteAsignado' });
    }

    targetAgentName = String(targetAgentName).replace(/_/g, ' ').trim();
    console.log(`[API /crm_agente] Intentando asignar lead a: ${targetAgentName}`);

    const usersCol = db.collection('users');
    const agentUser = await usersCol.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${targetAgentName}$`, 'i') } },
        { name: { $regex: new RegExp(`^${targetAgentName}$`, 'i') } },
        { username: { $regex: new RegExp(targetAgentName, 'i') } },
        { name: { $regex: new RegExp(targetAgentName, 'i') } }
      ]
    });

    if (!agentUser) {
      console.warn(`[API /crm_agente] No se encontró usuario para: ${targetAgentName}`);
      return res.status(404).json({ success: false, message: 'Agente no encontrado en el sistema' });
    }

    const agentId = agentUser._id || agentUser.id;
    const agentUsername = agentUser.username || agentUser.name;
    console.log(`[API /crm_agente] Usuario encontrado: ${agentUsername} (${agentId})`);

    let targetCollection = null;
    try {
      const mapping = await db.collection('user_collections').findOne({
        $or: [{ ownerId: agentId }, { ownerId: String(agentId) }]
      });
      if (mapping && mapping.collectionName) {
        targetCollection = mapping.collectionName;
      }
    } catch (_) {}

    if (!targetCollection) {
      const allCols = await db.listCollections().toArray();
      const potentialCols = allCols.filter(c => String(c.name || '').startsWith('costumers_'));
      for (const col of potentialCols) {
        const simplifiedCol = String(col.name || '').replace('costumers_', '').toLowerCase();
        const simplifiedAgent = String(agentUsername).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (simplifiedAgent && simplifiedCol.includes(simplifiedAgent.slice(0, 5))) {
          targetCollection = col.name;
          break;
        }
      }
    }

    if (!targetCollection) {
      const shortId = String(agentId).slice(-6);
      const normName = String(agentUsername)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_');
      targetCollection = `costumers_${normName}_${shortId}`.slice(0, 60);
    }

    console.log(`[API /crm_agente] Guardando en colección: ${targetCollection}`);

    const newLead = {
      ...leadData,
      agente: agentUsername,
      agenteId: agentId,
      agenteNombre: agentUsername,
      ownerId: agentId,
      asignadoPor: req.user?.username,
      fecha_asignacion: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      fecha_creacion: new Date(),
      status: leadData.status || 'PENDING',
      _source: 'crm_agente_assignment'
    };
    delete newLead._id;

    const result = await db.collection(targetCollection).insertOne(newLead);
    return res.json({
      success: true,
      message: `Lead asignado correctamente a ${agentUsername}`,
      collection: targetCollection,
      id: result.insertedId
    });
  } catch (error) {
    console.error('[API /crm_agente] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/semaforo', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const parseStatuses = (raw) => {
      try {
        if (!raw) return [];
        const parts = String(raw)
          .split(',')
          .map(s => String(s || '').trim())
          .filter(Boolean);
        return parts
          .map(s => s.toUpperCase())
          .filter(Boolean);
      } catch (_) {
        return [];
      }
    };

    const allowedStatuses = (() => {
      const parsed = parseStatuses(req.query?.statuses);
      return parsed.length ? parsed : [];
    })();

    const toYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = String(req.query.fechaInicio || '').trim() || toYMD(startOfMonth);
    const endDate = String(req.query.fechaFin || '').trim() || toYMD(now);

    const unifiedCollectionName = 'costumers_unified';
    let unifiedAvailable = false;
    try {
      const u = await db.listCollections({ name: unifiedCollectionName }).toArray();
      unifiedAvailable = Array.isArray(u) && u.length > 0;
    } catch (_) {}
    if (!unifiedAvailable) {
      return res.status(500).json({ success: false, message: 'No existe la colección costumers_unified' });
    }

    const pipeline = [
      {
        $addFields: {
          _agenteFuente: { $ifNull: ["$agenteNombre", "$agente"] },
          _statusStr: { $toUpper: { $trim: { input: { $ifNull: ["$status", ""] } } } }
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
                  { $regexMatch: { input: "$_statusStr", regex: /COMPLET/ } },
                  "COMPLETED",
                  {
                    $cond: [
                      { $regexMatch: { input: "$_statusStr", regex: /ACTIVE/ } },
                      "ACTIVE",
                      {
                        $cond: [
                          { $regexMatch: { input: "$_statusStr", regex: /PENDIENT|PENDING/ } },
                          "PENDING",
                          "$_statusStr"
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      {
        $addFields: {
          isCancel: { $eq: ["$_statusNorm", "CANCEL"] },
          puntajeEfectivo: {
            $cond: [
              { $eq: ["$_statusNorm", "CANCEL"] },
              0,
              { $toDouble: { $ifNull: ["$puntaje", 0] } }
            ]
          }
        }
      },
      ...(allowedStatuses.length
        ? [
          {
            $match: {
              _statusNorm: { $in: allowedStatuses }
            }
          }
        ]
        : []),
      {
        $addFields: {
          _diaParsed: {
            $cond: [
              { $eq: [{ $type: "$dia_venta" }, "date"] },
              "$dia_venta",
              {
                $let: {
                  vars: { s: { $toString: "$dia_venta" } },
                  in: {
                    $cond: [
                      { $regexMatch: { input: "$$s", regex: /^\d{4}-\d{2}-\d{2}$/ } },
                      { $dateFromString: { dateString: "$$s", format: "%Y-%m-%d", timezone: "-06:00" } },
                      {
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
                          { $dateFromString: { dateString: "$$s", timezone: "-06:00" } }
                        ]
                      }
                    ]
                  }
                }
              }
            ]
          }
        }
      },
      {
        $match: {
          $and: [
            {
              $or: [
                { agenteNombre: { $exists: true, $ne: null, $ne: "" } },
                { agente: { $exists: true, $ne: null, $ne: "" } }
              ]
            },
            { excluirDeReporte: { $ne: true } }
          ]
        }
      },
      {
        $match: {
          $expr: {
            $and: [
              {
                $gte: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: { $ifNull: ["$_diaParsed", "$createdAt"] },
                      timezone: "-06:00"
                    }
                  },
                  startDate
                ]
              },
              {
                $lte: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: { $ifNull: ["$_diaParsed", "$createdAt"] },
                      timezone: "-06:00"
                    }
                  },
                  endDate
                ]
              }
            ]
          }
        }
      },
      {
        $addFields: {
          _nameNormLower: {
            $toLower: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: {
                      $replaceAll: {
                        input: "$_agenteFuente",
                        find: "_",
                        replacement: ""
                      }
                    },
                    find: ".",
                    replacement: ""
                  }
                },
                find: " ",
                replacement: ""
              }
            }
          }
        }
      },
      {
        $group: {
          _id: "$_nameNormLower",
          nombre: { $first: "$_agenteFuente" },
          ventas: { $sum: 1 },
          puntos: { $sum: "$puntajeEfectivo" },
          lastSaleDate: { $max: { $ifNull: ["$_diaParsed", "$createdAt"] } }
        }
      },
      {
        $project: {
          _id: 0,
          nombreNormalizado: "$_id",
          nombre: 1,
          ventas: 1,
          puntos: 1,
          lastSaleYMD: {
            $cond: [
              { $ne: ["$lastSaleDate", null] },
              { $dateToString: { format: "%Y-%m-%d", date: "$lastSaleDate", timezone: "-06:00" } },
              null
            ]
          }
        }
      }
    ];

    const rows = await db.collection(unifiedCollectionName).aggregate(pipeline, { allowDiskUse: true }).toArray();

    const normalizeNameKey = (value) => {
      if (!value) return '';
      return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
    };

    const usersDocs = await db.collection('users').find({}, {
      projection: { username: 1, name: 1, email: 1, aliases: 1 }
    }).toArray();

    const userMap = new Map();
    for (const userDoc of usersDocs) {
      const keys = new Set();
      [userDoc.username, userDoc.name, userDoc.email && String(userDoc.email).split('@')[0]].forEach((val) => {
        const k = normalizeNameKey(val);
        if (k) keys.add(k);
      });
      if (Array.isArray(userDoc.aliases)) {
        userDoc.aliases.forEach((alias) => {
          const k = normalizeNameKey(alias);
          if (k) keys.add(k);
        });
      }
      keys.forEach((k) => {
        if (!userMap.has(k)) userMap.set(k, userDoc);
      });
    }

    const safeNoon = (ymd) => {
      const [y, m, d] = String(ymd).split('-').map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1);
      dt.setHours(12, 0, 0, 0);
      return dt;
    };
    const todayNoon = new Date(now);
    todayNoon.setHours(12, 0, 0, 0);
    const startNoon = safeNoon(startDate);

    const data = rows.map((row) => {
      const candidates = [row.nombreNormalizado, row.nombre].filter(Boolean).map(normalizeNameKey);
      let matchedUser = null;
      for (const c of candidates) {
        matchedUser = userMap.get(c);
        if (matchedUser) break;
      }
      const last = row.lastSaleYMD ? safeNoon(row.lastSaleYMD) : null;
      const daysWithout = last
        ? Math.max(0, Math.floor((todayNoon.getTime() - last.getTime()) / (24 * 60 * 60 * 1000)))
        : Math.max(0, Math.floor((todayNoon.getTime() - startNoon.getTime()) / (24 * 60 * 60 * 1000))) + 1;

      let status = 'green';
      if (daysWithout >= 4) status = 'black';
      else if (daysWithout === 3) status = 'red';
      else if (daysWithout === 2) status = 'yellow';
      else if (daysWithout === 1) status = 'greenlight';
      else status = 'green';

      return {
        userId: matchedUser?._id ? String(matchedUser._id) : null,
        username: matchedUser?.username || null,
        name: matchedUser?.name || row.nombre || null,
        ventas: Number(row.ventas || 0) || 0,
        puntos: Number(row.puntos || 0) || 0,
        lastSaleYMD: row.lastSaleYMD || null,
        daysWithout,
        status
      };
    });

    return res.json({
      success: true,
      data,
      meta: { startDate, endDate, today: toYMD(now) }
    });
  } catch (error) {
    console.error('[API /semaforo] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/users/agents
 * @desc Obtener lista de agentes para asignaci��n (endpoint de soporte para dropdown)
 * @access Private
 */
router.get('/users/agents', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    // Devolver lista de usuarios con campos m��nimos para el selector
    const users = await db.collection('users')
      .find({}) // Traer todos para que el frontend filtre por supervisor/equipo
      .project({ 
        username: 1, 
        name: 1, 
        role: 1, 
        team: 1, 
        supervisor: 1, 
        supervisorName: 1, 
        supervisorId: 1,
        manager: 1,
        managerId: 1,
        avatarUrl: 1,
        avatarFileId: 1,
        avatarUpdatedAt: 1,
        photoUrl: 1,
        photo: 1,
        imageUrl: 1,
        picture: 1,
        profilePhoto: 1,
        avatar: 1,
        _id: 1,
        id: 1 
      })
      .sort({ name: 1 })
      .toArray();

    return res.json({ 
      success: true, 
      agents: users,
      count: users.length 
    });
  } catch (error) {
    console.error('[API /users/agents] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/comisiones/agents
 * @desc Obtener puntaje por agente SOLO de ventas con status "completed" (rango opcional)
 * @access Private
 */
router.get('/comisiones/agents', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const { fechaInicio, fechaFin, debug, month, year } = req.query;
    const parseMonthQuery = (qMonth, qYear) => {
      const raw = (qMonth ?? '').toString().trim();
      const rawYear = (qYear ?? '').toString().trim();

      // Prefer YYYY-MM
      if (/^\d{4}-\d{2}$/.test(raw)) {
        const [y, m] = raw.split('-').map(Number);
        if (y > 2000 && m >= 1 && m <= 12) return { year: y, month: m };
      }

      // Support month=1..12 & year=YYYY
      if (raw && rawYear && /^\d{4}$/.test(rawYear)) {
        const y = Number(rawYear);
        const m = Number(raw);
        if (y > 2000 && m >= 1 && m <= 12) return { year: y, month: m };
      }

      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    };
    const { year: y, month: m } = parseMonthQuery(month, year);
    const toYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    let startDate = (fechaInicio || '').toString().trim();
    let endDate = (fechaFin || '').toString().trim();

    if (!startDate || !endDate) {
      const now = new Date();
      const start = new Date(Number(y), Number(m) - 1, 1);
      const endOfMonth = new Date(Number(y), Number(m), 0);
      const isCurrentMonth = now.getFullYear() === Number(y) && (now.getMonth() + 1) === Number(m);
      startDate = toYMD(start);
      endDate = toYMD(isCurrentMonth ? now : endOfMonth);
    }

    const unifiedCollectionName = 'costumers_unified';
    const unifiedAvailable = await db.listCollections({ name: unifiedCollectionName }).toArray();
    if (!Array.isArray(unifiedAvailable) || unifiedAvailable.length === 0) {
      return res.status(500).json({ success: false, message: 'No existe la colección costumers_unified' });
    }

    const pipeline = [
      {
        $addFields: {
          _statusLower: {
            $toLower: {
              $toString: {
                $ifNull: [
                  '$status',
                  { $ifNull: ['$estatus', { $ifNull: ['$estado', { $ifNull: ['$Status', { $ifNull: ['$STATUS', ''] }] }] }] }
                ]
              }
            }
          },
          _agentName: {
            $ifNull: [
              { $ifNull: ['$agenteNombre', '$agente'] },
              { $ifNull: ['$usuario', { $ifNull: ['$nombreAgente', '$vendedor'] }] }
            ]
          },
          _dateRaw: {
            $ifNull: [
              '$dia_venta',
              { $ifNull: ['$fecha_contratacion', { $ifNull: ['$creadoEn', { $ifNull: ['$createdAt', { $ifNull: ['$fecha', null] }] }] }] }
            ]
          }
        }
      },
      {
        $addFields: {
          _date: {
            $cond: [
              { $eq: [{ $type: '$_dateRaw' }, 'date'] },
              '$_dateRaw',
              {
                $cond: [
                  {
                    $in: [
                      { $type: '$_dateRaw' },
                      ['int', 'long', 'double', 'decimal']
                    ]
                  },
                  { $toDate: '$_dateRaw' },
                  {
                    $cond: [
                      { $eq: [{ $type: '$_dateRaw' }, 'string'] },
                      {
                        $let: {
                          vars: {
                            rawStr: { $trim: { input: { $toString: '$_dateRaw' } } },
                            asDate: {
                              $dateFromString: {
                                dateString: { $toString: '$_dateRaw' },
                                timezone: '-06:00',
                                onError: null,
                                onNull: null
                              }
                            }
                          },
                          in: {
                            $ifNull: [
                              '$$asDate',
                              {
                                $cond: [
                                  { $regexMatch: { input: '$$rawStr', regex: /^\d{10,13}$/ } },
                                  { $toDate: { $toLong: '$$rawStr' } },
                                  null
                                ]
                              }
                            ]
                          }
                        }
                      },
                      null
                    ]
                  }
                ]
              }
            ]
          },
          _points: {
            $convert: {
              input: {
                $ifNull: [
                  '$puntaje',
                  { $ifNull: ['$puntajeEfectivo', { $ifNull: ['$puntos', { $ifNull: ['$score', 0] }] }] }
                ]
              },
              to: 'double',
              onError: 0,
              onNull: 0
            }
          }
        }
      },
      ...(String(debug || '').trim() === '1' ? [
        {
          $facet: {
            total: [ { $count: 'count' } ],
            statusTop: [
              { $group: { _id: '$_statusLower', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 12 }
            ],
            completedAllTime: [
              {
                $match: {
                  _agentName: { $ne: null },
                  _date: { $ne: null },
                  $expr: { $regexMatch: { input: '$_statusLower', regex: /(completed|completado|complete|active|activo|activa)/ } }
                }
              },
              { $count: 'count' }
            ],
            completedInRange: [
              {
                $match: {
                  _agentName: { $ne: null },
                  _date: { $ne: null },
                  $expr: {
                    $and: [
                      { $regexMatch: { input: '$_statusLower', regex: /(completed|completado|complete|active|activo|activa)/ } },
                      { $gte: [{ $dateToString: { format: '%Y-%m-%d', date: '$_date' } }, startDate] },
                      { $lte: [{ $dateToString: { format: '%Y-%m-%d', date: '$_date' } }, endDate] }
                    ]
                  }
                }
              },
              { $count: 'count' }
            ],
            sample: [
              {
                $project: {
                  status: 1,
                  estatus: 1,
                  estado: 1,
                  agenteNombre: 1,
                  agente: 1,
                  usuario: 1,
                  nombreAgente: 1,
                  vendedor: 1,
                  puntaje: 1,
                  puntajeEfectivo: 1,
                  puntos: 1,
                  createdAt: 1,
                  creadoEn: 1,
                  dia_venta: 1,
                  fecha_contratacion: 1,
                  fecha: 1,
                  _statusLower: 1,
                  _agentName: 1,
                  _dateRaw: 1,
                  _date: 1,
                  _points: 1
                }
              },
              { $limit: 5 }
            ]
          }
        }
      ] : []),
      ...(String(debug || '').trim() === '1' ? [] : [
      {
        $match: {
          _agentName: { $ne: null },
          _date: { $ne: null },
          $expr: {
            $and: [
              { $regexMatch: { input: "$_statusLower", regex: /(completed|completado|complete|active|activo|activa)/ } },
              { $gte: [{ $dateToString: { format: '%Y-%m-%d', date: "$_date" } }, startDate] },
              { $lte: [{ $dateToString: { format: '%Y-%m-%d', date: "$_date" } }, endDate] }
            ]
          }
        }
      },
      {
        $group: {
          _id: { $toString: '$_agentName' },
          ventas: { $sum: 1 },
          puntos: { $sum: '$_points' }
        }
      },
      { $project: { _id: 0, nombre: '$_id', ventas: 1, puntos: 1 } },
      { $sort: { puntos: -1, ventas: -1, nombre: 1 } },
      { $limit: 500 }
      ])
    ];

    const rows = await db.collection(unifiedCollectionName).aggregate(pipeline, { allowDiskUse: true }).toArray();
    if (String(debug || '').trim() === '1') {
      return res.json({
        success: true,
        debug: true,
        meta: { startDate, endDate, month: `${String(y)}-${String(m).padStart(2, '0')}` },
        data: rows && rows[0] ? rows[0] : {}
      });
    }

    const normalizeKey = (v) => String(v || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

    // Mapear resultados agregados por nombre normalizado
    const aggMap = new Map();
    for (const r of (rows || [])) {
      const k = normalizeKey(r?.nombre);
      if (!k) continue;
      aggMap.set(k, {
        ventas: Number(r?.ventas || 0) || 0,
        puntos: Number(r?.puntos || 0) || 0
      });
    }

    // Obtener SOLO usuarios con rol de agente (y no supervisores/admin)
    // Nota: en algunas BD el rol puede venir como role/rol/roles/cargo (string o array).
    const usersAll = await db.collection('users')
      .find(
        {},
        { projection: { username: 1, name: 1, nombre: 1, fullName: 1, email: 1, role: 1, rol: 1, roles: 1, cargo: 1 } }
      )
      .sort({ name: 1, username: 1 })
      .toArray();

    const getRoleBlob = (u) => {
      const parts = [];
      const pushVal = (v) => {
        if (!v) return;
        if (Array.isArray(v)) { v.forEach(pushVal); return; }
        parts.push(String(v));
      };
      pushVal(u?.role);
      pushVal(u?.rol);
      pushVal(u?.roles);
      pushVal(u?.cargo);
      return parts.join(' ');
    };
    const isAgentUser = (u) => {
      const blob = getRoleBlob(u).toLowerCase();
      if (!/(agente|agent|vendedor|seller)/.test(blob)) return false;
      if (/supervisor/.test(blob)) return false;
      if (/admin/.test(blob)) return false;
      if (/back\s*office/.test(blob)) return false;
      if (/backoffice/.test(blob)) return false;
      return true;
    };
    const usersAgents = (usersAll || []).filter(isAgentUser);

    const pickDisplayName = (u) => {
      const v = (u && (u.name || u.nombre || u.fullName || u.username || u.email)) ? (u.name || u.nombre || u.fullName || u.username || u.email) : '';
      return String(v || '').trim() || '—';
    };

    const data = (usersAgents || []).map((u) => {
      const displayName = pickDisplayName(u);
      const keys = [u.username, u.name, u.nombre, u.fullName, u.email, displayName].filter(Boolean).map(normalizeKey);
      let found = null;
      for (const k of keys) {
        if (aggMap.has(k)) {
          found = aggMap.get(k);
          break;
        }
      }
      return {
        nombre: displayName,
        ventas: Number(found?.ventas || 0) || 0,
        puntos: Number(found?.puntos || 0) || 0
      };
    });

    return res.json({ success: true, data, meta: { startDate, endDate, totalAgents: data.length } });
  } catch (error) {
    console.error('[API /comisiones/agents] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/comisiones/agentes-mes
 * @desc Obtener agentes con ventas y puntaje del mes actual (simplificado)
 * @access Private
 */
router.get('/comisiones/agentes-mes', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    // Permitir parámetros year/month o usar el mes actual por defecto
    const now = new Date();
    const requestedYear = req.query.year ? parseInt(req.query.year) : now.getFullYear();
    const requestedMonth = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
    
    const year = requestedYear;
    const monthIndex = requestedMonth - 1; // JavaScript months are 0-indexed
    const month = String(requestedMonth).padStart(2, '0');
    
    // Usar rango del mes exacto, igual que /api/ranking
    const startOfMonth = new Date(year, monthIndex, 1);
    const startOfNextMonth = new Date(year, monthIndex + 1, 1);
    
    const startDate = `${year}-${month}-01`;
    const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
    const endDate = `${year}-${month}-${lastDayOfMonth}`;
    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    // Obtener todos los agentes
    const usersAll = await db.collection('users')
      .find({}, { projection: { _id: 1, username: 1, name: 1, nombre: 1, fullName: 1, email: 1, role: 1, rol: 1, roles: 1, cargo: 1 } })
      .sort({ name: 1, username: 1 })
      .toArray();

    const getRoleBlob = (u) => {
      const parts = [];
      const pushVal = (v) => {
        if (!v) return;
        if (Array.isArray(v)) { v.forEach(pushVal); return; }
        parts.push(String(v));
      };
      pushVal(u?.role);
      pushVal(u?.rol);
      pushVal(u?.roles);
      pushVal(u?.cargo);
      return parts.join(' ');
    };
    
    const isAgentUser = (u) => {
      const blob = getRoleBlob(u).toLowerCase();
      if (!/(agente|agent|vendedor|seller)/.test(blob)) return false;
      if (/supervisor/.test(blob)) return false;
      if (/admin/.test(blob)) return false;
      if (/back\s*office/.test(blob)) return false;
      if (/backoffice/.test(blob)) return false;
      return true;
    };

    const usersAgents = (usersAll || []).filter(isAgentUser);
    console.log(`[API /comisiones/agentes-mes] Agentes encontrados: ${usersAgents.length}`);

    const pickDisplayName = (u) => {
      const v = (u && (u.name || u.nombre || u.fullName || u.username || u.email)) ? (u.name || u.nombre || u.fullName || u.username || u.email) : '';
      return String(v || '').trim() || '—';
    };

    // Calcular rango del mes anterior para el "colchón"
    const prevMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1;
    const prevYear = monthIndex === 0 ? year - 1 : year;
    const prevMonth = String(prevMonthIndex + 1).padStart(2, '0');
    const prevStartDate = `${prevYear}-${prevMonth}-01`;
    const prevLastDayOfMonth = new Date(prevYear, prevMonthIndex + 1, 0).getDate();
    const prevEndDate = `${prevYear}-${prevMonth}-${prevLastDayOfMonth}`;
    const prevMonthStart = new Date(prevYear, prevMonthIndex, 1);
    const prevMonthEnd = new Date(prevYear, prevMonthIndex + 1, 1);
    const prevStartIso = `${prevStartDate}T00:00:00.000Z`;
    const prevEndIso = `${prevEndDate}T23:59:59.999Z`;

    console.log(`[API /comisiones/agentes-mes] Rango MES ACTUAL: ${startDate} a ${endDate}`);
    console.log(`[API /comisiones/agentes-mes] Rango COLCHÓN (mes anterior): ${prevStartDate} a ${prevEndDate}`);
    console.log(`[API /comisiones/agentes-mes] LÓGICA: Incluir ventas del mes anterior con instalación en mes actual`);

    // Para cada agente, buscar sus ventas en costumers_unified SOLO DEL MES ACTUAL
    // Restando las ventas con status "Cancelled"
    // TAMBIÉN INCLUIR el "colchón": ventas del mes anterior con fecha de instalación en el mes actual
    const results = [];
    
    for (const agent of usersAgents) {
      const displayName = pickDisplayName(agent);
      
      // Query base para encontrar registros del agente en el rango de fechas
      const agentIdStr = agent?._id ? String(agent._id) : '';
      let agentIdObj = null;
      try { if (agentIdStr && /^[a-fA-F0-9]{24}$/.test(agentIdStr)) agentIdObj = new ObjectId(agentIdStr); } catch (_) { agentIdObj = null; }
      const baseQueryById = agentIdStr ? {
        $or: [
          { agenteId: agentIdStr },
          { agente_id: agentIdStr },
          { agentId: agentIdStr },
          { agent_id: agentIdStr },
          ...(agentIdObj ? [
            { agenteId: agentIdObj },
            { agente_id: agentIdObj },
            { agentId: agentIdObj },
            { agent_id: agentIdObj }
          ] : [])
        ]
      } : null;
      const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const accentInsensitive = (token) => {
        const map = {
          a: '[aáàäâã]',
          e: '[eéèëê]',
          i: '[iíìïî]',
          o: '[oóòöôõ]',
          u: '[uúùüû]',
          n: '[nñ]'
        };
        return String(token || '')
          .split('')
          .map((ch) => {
            const lower = ch.toLowerCase();
            const repl = map[lower];
            return repl ? repl : escaped(ch);
          })
          .join('');
      };
      const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
      const first = parts[0] || '';
      const last = parts.length > 1 ? parts[parts.length - 1] : '';
      // Match tolerante: primer nombre + apellido, permitiendo palabras extra y variaciones de acentos
      const looseNameRegex = (first && last)
        ? new RegExp(`\\b${accentInsensitive(first)}\\b[\\s\\S]*\\b${accentInsensitive(last)}\\b`, 'i')
        : (first ? new RegExp(`\\b${accentInsensitive(first)}\\b`, 'i') : new RegExp('^$', 'i'));
      const baseQueryByName = {
        $or: [
          { agenteNombre: looseNameRegex },
          { agente: looseNameRegex },
          { nombreAgente: looseNameRegex },
          { vendedor: looseNameRegex }
        ]
      };
      // Usar match por nombre cuando NO hay agentId usable (o cuando está en formato inválido)
      // Evita contaminar por coincidencias de texto cuando sí existe un ObjectId real en el documento.
      const objectIdLike = /^[a-fA-F0-9]{24}$/;
      const noUsableAgentIdInDoc = {
        $and: [
          {
            $or: [
              { agenteId: { $exists: false } },
              { agenteId: null },
              { agenteId: '' },
              { $and: [ { agenteId: { $type: 'string' } }, { agenteId: { $not: objectIdLike } } ] }
            ]
          },
          {
            $or: [
              { agente_id: { $exists: false } },
              { agente_id: null },
              { agente_id: '' },
              { $and: [ { agente_id: { $type: 'string' } }, { agente_id: { $not: objectIdLike } } ] }
            ]
          },
          {
            $or: [
              { agentId: { $exists: false } },
              { agentId: null },
              { agentId: '' },
              { $and: [ { agentId: { $type: 'string' } }, { agentId: { $not: objectIdLike } } ] }
            ]
          },
          {
            $or: [
              { agent_id: { $exists: false } },
              { agent_id: null },
              { agent_id: '' },
              { $and: [ { agent_id: { $type: 'string' } }, { agent_id: { $not: objectIdLike } } ] }
            ]
          }
        ]
      };
      // Evitar contaminar por coincidencia flexible de nombre cuando el documento YA tiene un agentId usable.
      // Solo usar match por nombre como fallback si el doc no trae agentId usable.
      const baseQuery = baseQueryById
        ? { $or: [ baseQueryById, { $and: [ noUsableAgentIdInDoc, baseQueryByName ] } ] }
        : baseQueryByName;
      
      const dateQuery = {
        $or: [
          { dia_venta: { $gte: startDate, $lte: endDate } },
          { fecha_contratacion: { $gte: startDate, $lte: endDate } },
          // Soportar fechas como Date
          { creadoEn: { $gte: startOfMonth, $lte: startOfNextMonth } },
          { createdAt: { $gte: startOfMonth, $lte: startOfNextMonth } },
          // Soportar fechas como string ISO
          { creadoEn: { $gte: startIso, $lte: endIso } },
          { createdAt: { $gte: startIso, $lte: endIso } },
          { fecha_creacion: { $gte: startIso, $lte: endIso } },
          { fechaCreacion: { $gte: startIso, $lte: endIso } },
          { fecha: { $gte: startDate, $lte: endDate } }
        ]
      };

      // Query para el "colchón": ventas del mes anterior con instalación en mes actual
      const colchonQuery = {
        $and: [
          baseQuery,
          {
            $or: [
              { dia_venta: { $gte: prevStartDate, $lte: prevEndDate } },
              { fecha_contratacion: { $gte: prevStartDate, $lte: prevEndDate } },
              // Soportar fechas como Date
              { creadoEn: { $gte: prevMonthStart, $lte: prevMonthEnd } },
              { createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd } },
              // Soportar fechas como string ISO
              { creadoEn: { $gte: prevStartIso, $lte: prevEndIso } },
              { createdAt: { $gte: prevStartIso, $lte: prevEndIso } },
              { fecha_creacion: { $gte: prevStartIso, $lte: prevEndIso } },
              { fechaCreacion: { $gte: prevStartIso, $lte: prevEndIso } }
            ]
          },
          {
            $or: [
              { dia_instalacion: { $gte: startDate, $lte: endDate } },
              { fecha_instalacion: { $gte: startDate, $lte: endDate } }
            ]
          }
        ]
      };

      // Agregar ventas y puntajes sumando los válidos y restando los cancelados
      const agentData = await db.collection('costumers_unified')
        .aggregate([
          {
            $match: {
              $and: [baseQuery, dateQuery]
            }
          },
          {
            $facet: {
              todos: [
                {
                  $addFields: {
                    __statusUpper: {
                      $toUpper: {
                        $ifNull: [
                          '$status',
                          {
                            $ifNull: [
                              '$estatus',
                              { $ifNull: ['$estado', ''] }
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                {
                  $group: {
                    _id: null,
                    totalRecords: { $sum: 1 },
                    cancelledCount: {
                      $sum: {
                        $cond: [
                          { $ne: [{ $indexOfCP: ['$__statusUpper', 'CANCELLED'] }, -1] },
                          1,
                          0
                        ]
                      }
                    },
                    ventasValidas: {
                      $sum: {
                        $cond: [
                          {
                            $or: [
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETED'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVE'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVA'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVADO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVADA'] }, -1] }
                            ]
                          },
                          1,
                          0
                        ]
                      }
                    },
                    ventasActivas: {
                      $sum: {
                        $cond: [
                          { 
                            $or: [
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETED'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETADA'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETADO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'TERMINADA'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'TERMINADO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVE'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVA'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVADO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVADA'] }, -1] }
                            ]
                          },
                          1,
                          0
                        ]
                      }
                    },
                    ventasPendientes: {
                      $sum: {
                        $cond: [
                          { $regexMatch: { input: '$__statusUpper', regex: 'PEND' } },
                          1,
                          0
                        ]
                      }
                    },
                    ventasCanceladas: {
                      $sum: {
                        $cond: [
                          { $ne: [{ $indexOfCP: ['$__statusUpper', 'CANCELLED'] }, -1] },
                          1,
                          0
                        ]
                      }
                    },
                    puntosValidos: {
                      $sum: {
                        $cond: [
                          {
                            $or: [
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETED'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVE'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVA'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVADO'] }, -1] },
                              { $ne: [{ $indexOfCP: ['$__statusUpper', 'ACTIVADA'] }, -1] }
                            ]
                          },
                          { $convert: { input: { $ifNull: ['$puntaje', { $ifNull: ['$puntos', 0] }] }, to: 'double', onError: 0, onNull: 0 } },
                          0
                        ]
                      }
                    },
                    puntosCancelados: {
                      $sum: {
                        $cond: [
                          { $ne: [{ $indexOfCP: ['$__statusUpper', 'CANCELLED'] }, -1] },
                          { $convert: { input: { $ifNull: ['$puntaje', { $ifNull: ['$puntos', 0] }] }, to: 'double', onError: 0, onNull: 0 } },
                          0
                        ]
                      }
                    }
                  }
                },
                {
                  $project: {
                    _id: 0,
                    totalRecords: 1,
                    cancelledCount: 1,
                    ventas: '$ventasValidas',
                    activas: '$ventasActivas',
                    puntos: '$puntosValidos',
                    pendientes: '$ventasPendientes'
                  }
                }
              ],
              cancelled: [
                { $match: { status: { $regex: 'completed|active|activo|activa', $options: 'i' } } },
                { $limit: 5 }
              ]
            }
          }
        ])
        .toArray();

      // Contar pendientes del mes actual (con filtro de fecha), igual que las ventas
      const pendingTotalAgg = await db.collection('costumers_unified')
        .aggregate([
          {
            $match: {
              $and: [baseQuery, dateQuery]
            }
          },
          {
            $addFields: {
              __statusUpper: {
                $toUpper: {
                  $ifNull: [
                    '$status',
                    {
                      $ifNull: [
                        '$estatus',
                        { $ifNull: ['$estado', ''] }
                      ]
                    }
                  ]
                }
              }
            }
          },
          {
            $group: {
              _id: null,
              pendientes: {
                $sum: {
                  $cond: [
                    { $regexMatch: { input: '$__statusUpper', regex: 'PEND' } },
                    1,
                    0
                  ]
                }
              }
            }
          },
          { $project: { _id: 0, pendientes: 1 } }
        ], { allowDiskUse: true })
        .toArray();

      // Contar activas TOTALES (sin filtro de fecha), como la tabla
      const activasTotalAgg = await db.collection('costumers_unified')
        .aggregate([
          { $match: baseQuery },
          {
            $addFields: {
              __statusUpper: {
                $toUpper: {
                  $ifNull: [
                    '$status',
                    {
                      $ifNull: [
                        '$estatus',
                        { $ifNull: ['$estado', ''] }
                      ]
                    }
                  ]
                }
              }
            }
          },
          {
            $group: {
              _id: null,
              activas: {
                $sum: {
                  $cond: [
                    { 
                      $or: [
                        { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETED'] }, -1] },
                        { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETADA'] }, -1] },
                        { $ne: [{ $indexOfCP: ['$__statusUpper', 'COMPLETADO'] }, -1] },
                        { $ne: [{ $indexOfCP: ['$__statusUpper', 'TERMINADA'] }, -1] },
                        { $ne: [{ $indexOfCP: ['$__statusUpper', 'TERMINADO'] }, -1] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          },
          { $project: { _id: 0, activas: 1 } }
        ], { allowDiskUse: true })
        .toArray();

      // Buscar también el "colchón" (ventas del mes anterior con instalación en mes actual)
      const colchonData = await db.collection('costumers_unified')
        .aggregate([
          {
            $match: colchonQuery
          },
          {
            $group: {
              _id: null,
              colchonVentas: {
                $sum: {
                  $cond: [
                    { $eq: [{ $toUpper: '$status' }, 'COMPLETED'] },
                    1,
                    0
                  ]
                }
              },
              colchonPuntos: {
                $sum: {
                  $cond: [
                    { $eq: [{ $toUpper: '$status' }, 'COMPLETED'] },
                    { $convert: { input: { $ifNull: ['$puntaje', { $ifNull: ['$puntos', 0] }] }, to: 'double', onError: 0, onNull: 0 } },
                    0
                  ]
                }
              }
            }
          },
          {
            $project: {
              _id: 0,
              colchonVentas: 1,
              colchonPuntos: 1
            }
          }
        ])
        .toArray();

      // Debug - mostrar registros cancelados para this agent
      if (displayName.toLowerCase().includes('julio')) {
        const facetResults = agentData && agentData.length > 0 ? agentData[0] : {};
        console.log(`[DEBUG JULIO] Facet results:`, JSON.stringify(facetResults, null, 2));
      }

      const stats = agentData && agentData.length > 0 && agentData[0].todos && agentData[0].todos.length > 0 ? agentData[0].todos[0] : { ventas: 0, activas: 0, puntos: 0 };
      const colchonStats = colchonData && colchonData.length > 0 ? colchonData[0] : { colchonVentas: 0, colchonPuntos: 0 };
      const pendingTotal = pendingTotalAgg && pendingTotalAgg.length > 0 ? Number(pendingTotalAgg[0].pendientes || 0) : 0;
      const activasTotal = activasTotalAgg && activasTotalAgg.length > 0 ? Number(activasTotalAgg[0].activas || 0) : 0;
      
      // Sumar ventas del mes actual + colchón
      const ventasActuales = Number(stats.ventas || 0);
      const puntosActuales = Number((stats.puntos || 0).toFixed(2));
      const ventasPendientes = pendingTotal;
      const ventasColchon = Number(colchonStats.colchonVentas || 0);
      const puntosColchon = Number((colchonStats.colchonPuntos || 0).toFixed(2));
      
      const result = {
        id: agent._id,
        email: agent.email || '',
        nombre: displayName,
        ventas: ventasActuales + ventasColchon,
        activas: activasTotal,
        puntos: Number((puntosActuales + puntosColchon).toFixed(2)),
        pendientes: ventasPendientes
      };
      
      // Debug para agentes específicos
      if (displayName.toLowerCase().includes('julio')) {
        console.log(`[JULIO - COLCHÓN] ${displayName}: Ventas=(${ventasActuales} + ${ventasColchon} colchón = ${result.ventas}), Puntos=(${puntosActuales} + ${puntosColchon} colchón = ${result.puntos})`);
      }
      if (displayName.toLowerCase().includes('luis')) {
        console.log(`[LUIS - COLCHÓN] ${displayName}: Ventas=(${ventasActuales} + ${ventasColchon} = ${result.ventas}), Puntos=(${puntosActuales} + ${puntosColchon} = ${result.puntos})`);
      }
      if (ventasColchon > 0) {
        console.log(`[COLCHÓN] ${displayName}: +${ventasColchon} ventas, +${puntosColchon} puntos (venta mes anterior, instalación mes actual)`);
      }
      
      results.push(result);
    }

    console.log(`[API /comisiones/agentes-mes] Retornando ${results.length} agentes`);
    return res.json({ success: true, data: results, meta: { startDate, endDate, month: `${year}-${month}` } });
  } catch (error) {
    console.error('[API /comisiones/agentes-mes] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/comisiones/agentes-lineas
 * @desc Obtener agentes de Team Lineas con ventas y puntaje del mes actual
 * @desc Cada agente tiene su propia colección en TEAM_LINEAS (ej: ALEXIS_RODRIGUES, CRISTIAN_RIVERA, etc.)
 * @access Private
 */
router.get('/comisiones/agentes-lineas', protect, async (req, res) => {
  try {
    const { getDbFor } = require('../config/db');
    const teamLineasDb = getDbFor('TEAM_LINEAS');
    
    if (!teamLineasDb) {
      return res.status(500).json({ success: false, message: 'No se pudo conectar a la base de datos TEAM_LINEAS' });
    }

    // Obtener mes actual o del query
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = String(req.query.month || (now.getMonth() + 1)).padStart(2, '0');
    
    // Rango de fechas del mes
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(year, parseInt(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate + 'T23:59:59.999Z');
    
    console.log(`[API /comisiones/agentes-lineas] Consultando mes: ${year}-${month}`);

    // Obtener todas las colecciones de TEAM_LINEAS (cada colección = un agente)
    const collections = await teamLineasDb.listCollections().toArray();
    const collectionNames = collections.map(c => c.name).filter(Boolean);
    
    console.log(`[API /comisiones/agentes-lineas] Colecciones (agentes) encontradas:`, collectionNames);

    // Mapeo de agentes a supervisores
    const supervisorMap = {
      // Team Jonathan F
      'alexis_rodrigues': 'JONATHAN F', 'alexis_rodriguez': 'JONATHAN F',
      'cristian_rivera': 'JONATHAN F',
      'dennis_vasquez': 'JONATHAN F',
      'edward_ramirez': 'JONATHAN F',
      'jocelyn_reyes': 'JONATHAN F',
      'melanie_hurtado': 'JONATHAN F',
      'nancy_lopez': 'JONATHAN F',
      'oscar_rivera': 'JONATHAN F',
      'victor_hurtado': 'JONATHAN F',
      'jonathan_f': 'JONATHAN F',
      // Team Luis G
      'cesar_claros': 'LUIS G',
      'daniel_del_cid': 'LUIS G',
      'fernando_beltran': 'LUIS G',
      'jonathan_garcia': 'LUIS G',
      'karla_rodriguez': 'LUIS G',
      'luis_g': 'LUIS G',
      'manuel_flores': 'LUIS G',
      'tatiana_giron': 'LUIS G'
    };

    // Procesar cada colección (cada colección = un agente)
    const agentes = [];

    const normalize = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isWirelessService = (svc) => {
      const s = normalize(svc).replace(/\s+/g, ' ');
      if (!s) return false;
      return s.includes('wire');
    };
    const toServiceArray = (reg) => {
      const svc = reg?.servicios ?? reg?._raw?.servicios;
      if (Array.isArray(svc)) return svc;
      if (typeof svc === 'string') {
        const raw = svc.trim();
        if (!raw) return [];
        if (raw.includes(',')) return raw.split(',').map(x => x.trim()).filter(Boolean);
        if (raw.includes('|')) return raw.split('|').map(x => x.trim()).filter(Boolean);
        return [raw];
      }
      return [];
    };
    const getTotalLines = (reg, serviciosArr) => {
      const c = Number(reg?.cantidad_lineas || 0);
      const t = Array.isArray(reg?.telefonos) ? reg.telefonos.length : (Array.isArray(reg?._raw?.telefonos) ? reg._raw.telefonos.length : 0);
      const s = Array.isArray(serviciosArr) ? serviciosArr.length : 0;
      return Math.max(c, t, s, 0);
    };
    const getWirelessRate = (wirelessLines) => {
      if (wirelessLines >= 29) return 25;
      if (wirelessLines >= 24) return 20;
      if (wirelessLines >= 19) return 15;
      if (wirelessLines >= 15) return 10;
      return 0;
    };
    const getNonWirelessRate = (nonWirelessLines) => {
      if (nonWirelessLines >= 18) return 5.5;
      if (nonWirelessLines >= 13) return 4.5;
      if (nonWirelessLines >= 7) return 3;
      return 0;
    };
    const calcCommissionLineas = (wirelessLines, nonWirelessLines) => {
      const rateW = getWirelessRate(wirelessLines);
      const rateN = getNonWirelessRate(nonWirelessLines);
      const cW = rateW > 0 ? wirelessLines * rateW : 0;
      const cN = rateN > 0 ? nonWirelessLines * rateN : 0;
      return Number((cW + cN).toFixed(2));
    };

    for (const colName of collectionNames) {
      try {
        const collection = teamLineasDb.collection(colName);
        
        // El nombre del agente es el nombre de la colección (ej: ALEXIS_RODRIGUES -> Alexis Rodrigues)
        const agentNameFromCol = colName.replace(/_/g, ' ').toLowerCase();
        const agentNameDisplay = colName.replace(/_/g, ' ').split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        
        // Determinar supervisor basado en el nombre de la colección
        const colNameLower = colName.toLowerCase();
        let supervisor = supervisorMap[colNameLower] || '';
        if (!supervisor) {
          // Fallback: buscar coincidencia parcial
          for (const [key, sup] of Object.entries(supervisorMap)) {
            if (colNameLower.includes(key.split('_')[0])) {
              supervisor = sup;
              break;
            }
          }
        }
        
        // Buscar TODOS los registros del mes actual en esta colección
        const registros = await collection.find({
          $or: [
            // Por dia_venta como Date
            { dia_venta: { $gte: startDateObj, $lte: endDateObj } },
            // Por dia_venta como string ISO
            { dia_venta: { $regex: `^${year}-${month}` } },
            // Por creadoEn como Date
            { creadoEn: { $gte: startDateObj, $lte: endDateObj } }
          ]
        }).toArray();

        // Contar ventas y líneas (Wireless vs Sin Wireless)
        let ventas = 0;
        let pendientes = 0;
        let cancelados = 0;
        let lineasWireless = 0;
        let lineasSinWireless = 0;
        let lineasTotal = 0;

        for (const reg of registros) {
          const status = String(reg.status || '').toLowerCase();
          const isCancelled = status.includes('cancel') || status.includes('anulad');
          const isCompleted = status.includes('completed') || status.includes('complet') || status.includes('active') || status.includes('activ');
          const isPending = status.includes('pending') || status.includes('pendiente');

          if (isCancelled) {
            cancelados++;
          } else if (isPending) {
            pendientes++;
          } else if (isCompleted) {
            ventas++;

            const serviciosArr = toServiceArray(reg);
            const totalLines = getTotalLines(reg, serviciosArr);
            let wirelessCount = 0;

            if (Array.isArray(serviciosArr) && serviciosArr.length > 0) {
              wirelessCount = serviciosArr.reduce((acc, svc) => acc + (isWirelessService(svc) ? 1 : 0), 0);
            }

            const nonWirelessCount = Math.max(0, totalLines - wirelessCount);
            lineasWireless += wirelessCount;
            lineasSinWireless += nonWirelessCount;
            lineasTotal += totalLines;
          }
        }

        const comision = calcCommissionLineas(lineasWireless, lineasSinWireless);
        console.log(`[API /comisiones/agentes-lineas] ${colName}: ${registros.length} registros, ${ventas} ventas, wireless=${lineasWireless}, sinWireless=${lineasSinWireless}, totalLineas=${lineasTotal}, comision=${comision}, supervisor: ${supervisor}`);

        agentes.push({
          nombre: agentNameDisplay,
          coleccion: colName,
          ventas,
          pendientes,
          cancelados,
          supervisor,
          lineasWireless,
          lineasSinWireless,
          lineasTotal,
          comision
        });

      } catch (colErr) {
        console.warn(`[API /comisiones/agentes-lineas] Error en colección ${colName}:`, colErr.message);
      }
    }

    // Ordenar por comisión descendente
    agentes.sort((a, b) => (b.comision || 0) - (a.comision || 0));

    console.log(`[API /comisiones/agentes-lineas] Retornando ${agentes.length} agentes de Team Lineas`);
    
    return res.json({ 
      success: true, 
      data: agentes, 
      meta: { 
        startDate, 
        endDate, 
        month: `${year}-${month}`,
        totalAgentes: agentes.length,
        totalVentas: agentes.reduce((s, a) => s + a.ventas, 0),
        totalLineasWireless: agentes.reduce((s, a) => s + (a.lineasWireless || 0), 0),
        totalLineasSinWireless: agentes.reduce((s, a) => s + (a.lineasSinWireless || 0), 0),
        totalLineas: agentes.reduce((s, a) => s + (a.lineasTotal || 0), 0),
        totalComision: agentes.reduce((s, a) => s + (a.comision || 0), 0)
      } 
    });
  } catch (error) {
    console.error('[API /comisiones/agentes-lineas] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route GET /api/leads-lineas
 * @desc Obtener datos de Team Líneas desde la base de datos TEAM_LINEAS
 * @access Private
 */
router.get('/leads-lineas', protect, async (req, res) => {
  console.log('[API /leads-lineas] ===== INICIO PETICIÓN =====');
  console.log('[API /leads-lineas] Usuario:', req.user?.username, 'Role:', req.user?.role);
  
  try {
    const dbTL = getDbFor('TEAM_LINEAS');
    if (!dbTL) {
      console.warn('[API /leads-lineas] No se pudo conectar a la base de datos TEAM_LINEAS');
      return res.status(500).json({ 
        success: false, 
        message: 'Base de datos TEAM_LINEAS no disponible' 
      });
    }

    // Obtener todas las colecciones de TEAM_LINEAS
    const collectionNames = await __getTeamLineasCollectionsCached(dbTL);
    console.log('[API /leads-lineas] Colecciones encontradas:', collectionNames);

    if (!collectionNames || collectionNames.length === 0) {
      console.warn('[API /leads-lineas] No hay colecciones en TEAM_LINEAS');
      return res.json({ success: true, data: [] });
    }

    // Obtener parámetros de filtro
    const { supervisor, fechaInicio, fechaFin, month, allData } = req.query;
    
    // Construir filtro de fechas
    let dateFilter = {};
    if (!allData) {
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [year, monthNum] = month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNum, 0).getDate();
        const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        dateFilter = {
          $or: [
            { dia_venta: { $gte: startDate, $lte: endDate } },
            { fecha_venta: { $gte: startDate, $lte: endDate } },
            { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } }
          ]
        };
      } else if (fechaInicio && fechaFin) {
        dateFilter = {
          $or: [
            { dia_venta: { $gte: fechaInicio, $lte: fechaFin } },
            { fecha_venta: { $gte: fechaInicio, $lte: fechaFin } },
            { createdAt: { $gte: new Date(fechaInicio), $lte: new Date(fechaFin) } }
          ]
        };
      }
    }

    // Recolectar datos de todas las colecciones
    const allLeads = [];
    
    for (const colName of collectionNames) {
      try {
        const col = dbTL.collection(colName);
        
        // Construir query
        let query = { ...dateFilter };
        
        // Filtrar por supervisor si se especifica
        if (supervisor) {
          query.supervisor = supervisor;
        }
        
        const docs = await col.find(query).toArray();
        
        // Agregar información de la colección (nombre del agente)
        const docsWithMeta = docs.map(doc => ({
          ...doc,
          _id: doc._id ? String(doc._id) : doc.id,
          nombre_agente: doc.nombre_agente || doc.agenteNombre || doc.agente || colName,
          _collection: colName
        }));
        
        allLeads.push(...docsWithMeta);
        
        console.log(`[API /leads-lineas] Colección ${colName}: ${docs.length} registros`);
      } catch (colErr) {
        console.warn(`[API /leads-lineas] Error en colección ${colName}:`, colErr.message);
      }
    }

    console.log(`[API /leads-lineas] Total de registros: ${allLeads.length}`);
    
    return res.json({ 
      success: true, 
      data: allLeads,
      meta: {
        totalRecords: allLeads.length,
        collections: collectionNames.length,
        filters: { supervisor, fechaInicio, fechaFin, month }
      }
    });

  } catch (error) {
    console.error('[API /leads-lineas] Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;
