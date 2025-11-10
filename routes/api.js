const express = require('express');
const router = express.Router();
const { getDb, getDbFor } = require('../config/db');

const { protect, authorize } = require('../middleware/auth');

/**
 * @route GET /api/dashboard
 * @desc Obtener datos del dashboard
 * @access Private
 */
router.get('/dashboard', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    // Aquí puedes agregar lógica específica para el dashboard
    res.json({
      success: true,
      message: 'Datos del dashboard',
      data: {
        // Agregar datos relevantes del dashboard
      }
    });
  } catch (error) {
    console.error('[API DASHBOARD] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route GET /api/stats
 * @desc Obtener estadísticas generales
 * @access Private
 */
router.get('/stats', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    // Aquí puedes agregar lógica para obtener estadísticas
    res.json({
      success: true,
      message: 'Estadísticas obtenidas',
      data: {
        // Agregar estadísticas relevantes
      }
    });
  } catch (error) {
    console.error('[API STATS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// GET /api/lineas-team -> lista registros desde TEAM_LINEAS.<USUARIO>
router.get('/lineas-team', protect, async (req, res) => {
  try {
    const dbTL = getDbFor('TEAM_LINEAS');
    if (!dbTL) return res.status(500).json({ success:false, message:'DB TEAM_LINEAS no disponible' });

    const roleLc = String(req.user?.role||'').toLowerCase();
    let targetName = (req.user?.name || req.user?.username || 'USUARIO');

    // Si es supervisor
    if (roleLc.includes('supervisor')) {
      const agenteParam = String(req.query.agente || '').trim();
      
      // Si no se especifica agente, devolver datos de TODOS sus agentes
      if (!agenteParam) {
        try {
          const db = getDb();
          const usersCol = db.collection('users');
          const supUser = String(req.user?.username || '').toUpperCase();
          
          // Buscar todos los agentes de este supervisor
          const agents = await usersCol.find({ 
            supervisor: supUser 
          }).toArray();
          
          // Si no tiene agentes, devolver array vacío
          if (!agents || agents.length === 0) {
            return res.json({ success:true, data:[], collection: 'supervisor-no-agents', count: 0 });
          }
          
          // Combinar datos de todos los agentes
          const allData = [];
          for (const agent of agents) {
            const colName = __normName(agent.username);
            const col = dbTL.collection(colName);
            const agentData = await col.find({}).sort({ createdAt: -1, creadoEn: -1, updatedAt: -1, actualizadoEn: -1 }).toArray();
            
            // Agregar campo del agente para identificar de quién es cada registro
            const dataWithAgent = agentData.map(item => {
              const itemCopy = { ...item };
              if (itemCopy._id) itemCopy._id = String(itemCopy._id);
              itemCopy.agenteAsignado = agent.username;
              itemCopy.supervisor = supUser;
              return itemCopy;
            });
            
            allData.push(...dataWithAgent);
          }
          
          // Ordenar todos los datos combinados por fecha
          allData.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.creadoEn || a.updatedAt || a.actualizadoEn || 0);
            const dateB = new Date(b.createdAt || b.creadoEn || b.updatedAt || b.actualizadoEn || 0);
            return dateB - dateA;
          });
          
          return res.json({ success:true, data:allData, collection: 'supervisor-all-agents', count: allData.length });
        } catch (e) {
          console.error('[API LINEAS TEAM] Error cargando agentes del supervisor:', e);
          return res.status(500).json({ success:false, message:'Error cargando datos de agentes', error: e.message });
        }
      }
      
      // Si se especifica agente, validar que pertenezca al supervisor
      try {
        const db = getDb();
        const usersCol = db.collection('users');
        const agentDoc = await usersCol.findOne({ username: agenteParam });
        const supUser = String(req.user?.username || '').toUpperCase();
        const agentSup = String(agentDoc?.supervisor || '').toUpperCase();
        if (!agentDoc || agentSup !== supUser) {
          return res.status(403).json({ success:false, message:'No autorizado para consultar este agente' });
        }
        targetName = agenteParam;
      } catch (e) {
        return res.status(500).json({ success:false, message:'Error validando agente', error: e.message });
      }
    }
    // Si NO es supervisor, ignorar cualquier intento de pasar ?agente

    const colName = __normName(targetName);
    const col = dbTL.collection(colName);

    const list = await col.find({}).sort({ createdAt: -1, creadoEn: -1, updatedAt: -1, actualizadoEn: -1 }).toArray();
    const listWithStringId = list.map(item => {
      const itemCopy = { ...item };
      if (itemCopy._id) itemCopy._id = String(itemCopy._id);
      return itemCopy;
    });
    return res.json({ success:true, data:listWithStringId, collection: colName, count: listWithStringId.length });
  } catch (e) {
    console.error('[API LINEAS TEAM GET] Error:', e);
    return res.status(500).json({ success:false, message:'Error interno', error:e.message });
  }
});

// Crear cliente/lead para Team Líneas (escribe SOLO en TEAM_LINEAS.<USUARIO>)
router.post('/lineas', protect, async (req, res) => {
  try {
    const roleLc = String(req.user?.role||'').toLowerCase();
    const allow = __isTeamLineas(req) || roleLc.includes('supervisor');
    if (!allow) return res.status(403).json({ success:false, message:'Solo disponible para Team Líneas/Supervisor' });

    const dbTL = getDbFor('TEAM_LINEAS');
    if (!dbTL) return res.status(500).json({ success:false, message:'DB TEAM_LINEAS no disponible' });

    const body = req.body || {};
    const base = sanitizePayload(body);
    const now = new Date();
    const ownerName = req.user?.name || req.user?.username || 'USUARIO';
    const ownerId = req.user?.id || req.user?._id || null;
    // Determinar el dueño/colección destino
    let targetName = ownerName;
    const agenteSel = String(body.agenteAsignado || '').trim();
    if (roleLc.includes('supervisor') && agenteSel) {
      try {
        const db = getDb();
        const usersCol = db.collection('users');
        const agentDoc = await usersCol.findOne({ username: agenteSel });
        const supUser = String(req.user?.username || '').toUpperCase();
        const agentSup = String(agentDoc?.supervisor || '').toUpperCase();
        
        // Validación más flexible: verificar si el supervisor del agente contiene el nombre del supervisor actual
        const isAuthorized = agentDoc && (agentSup === supUser || agentSup.includes(supUser) || supUser.includes(agentSup.split(' ')[0]));
        
        if (!isAuthorized) {
          console.log(`[ASIGNACIÓN] Rechazo: agente=${agenteSel}, supervisor del agente=${agentSup}, supervisor actual=${supUser}`);
          return res.status(403).json({ success:false, message:'No autorizado para asignar a este agente' });
        }
        
        console.log(`[ASIGNACIÓN] Autorizado: agente=${agenteSel}, supervisor=${supUser}`);
        targetName = agenteSel;
      } catch (e) {
        return res.status(500).json({ success:false, message:'Error validando agente asignado', error: e.message });
      }
    }

    // Derivar arrays de servicios/telefonos y cantidad de líneas exactamente como llegan del form
    const asArray = (v) => Array.isArray(v) ? v : (v != null ? [v] : []);
    const servicios = asArray(base.servicios).map(String);
    const telefonos = asArray(base.telefonos).map(v => String(v).replace(/\D+/g,''));
    let cantidad_lineas = Number(asArray(base.cantidad_lineas)[0] || telefonos.length || 0);
    if (!cantidad_lineas && servicios.length) cantidad_lineas = servicios.length;

    const doc = {
      ...base,
      agenteNombre: base.agenteNombre || targetName,
      agente: base.agente || targetName,
      ownerId: ownerId,
      supervisor: base.supervisor || (req.user?.username || req.user?.supervisor || ''),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      team: req.user?.team || 'team lineas',
      servicios,
      telefonos,
      cantidad_lineas,
      ID: base.ID || base.id || base.Id || undefined
    };

    const colName = __normName(targetName);
    const tcol = dbTL.collection(colName);
    console.log('[API LINEAS CREATE] Colección destino:', tcol.collectionName);
    const ins = await tcol.insertOne(doc);
    return res.json({ success:true, message:'Creado en TEAM_LINEAS', data:{ id: ins.insertedId } });
  } catch (e) {
    console.error('[API LINEAS CREATE] Error:', e);
    return res.status(500).json({ success:false, message:'Error interno', error:e.message });
  }
});

// Actualizar STATUS de un registro en Team Líneas
router.put('/lineas-team/status', protect, async (req, res) => {
  try {
    const roleLc = String(req.user?.role||'').toLowerCase();
    const allow = __isTeamLineas(req) || roleLc.includes('supervisor') || roleLc.includes('admin');
    if (!allow) return res.status(403).json({ success:false, message:'Sin permisos para actualizar STATUS' });

    const dbTL = getDbFor('TEAM_LINEAS');
    if (!dbTL) return res.status(500).json({ success:false, message:'DB TEAM_LINEAS no disponible' });

    const { id, status, statusUpper } = req.body;
    console.log('[STATUS UPDATE] Request body:', { id, status, statusUpper, idType: typeof id });
    if (!id) return res.status(400).json({ success:false, message:'Falta el ID del registro' });

    const { ObjectId } = require('mongodb');
    let objId;
    try {
      objId = new ObjectId(id);
      console.log('[STATUS UPDATE] ObjectId creado:', objId);
    } catch (err) {
      console.error('[STATUS UPDATE] Error creando ObjectId:', err.message);
      return res.status(400).json({ success:false, message:'ID inválido: ' + err.message });
    }

    // Determinar en qué colección buscar
    // Si es supervisor, buscar en todas las colecciones de sus agentes
    const userName = req.user?.username || req.user?.name || '';
    const colName = __normName(userName);
    
    let updated = false;
    
    if (roleLc.includes('supervisor')) {
      // Buscar en colecciones de todos los agentes del supervisor
      const db = getDb();
      const usersCol = db.collection('users');
      const supUser = String(req.user?.username || '').toUpperCase();
      const agents = await usersCol.find({ supervisor: supUser }).toArray();
      
      for (const agent of agents) {
        const agentCol = dbTL.collection(__normName(agent.username));
        const result = await agentCol.updateOne(
          { _id: objId },
          { $set: { status: statusUpper || status, updatedAt: new Date().toISOString() } }
        );
        if (result.matchedCount > 0) {
          updated = true;
          break;
        }
      }
    }
    
    // Si no se encontró en las colecciones de agentes, buscar en la propia
    if (!updated) {
      const col = dbTL.collection(colName);
      const result = await col.updateOne(
        { _id: objId },
        { $set: { status: statusUpper || status, updatedAt: new Date().toISOString() } }
      );
      updated = result.matchedCount > 0;
    }

    if (!updated) {
      return res.status(404).json({ success:false, message:'Registro no encontrado' });
    }

    return res.json({ success:true, message:'STATUS actualizado correctamente' });
  } catch (e) {
    console.error('[API LINEAS STATUS UPDATE] Error:', e);
    return res.status(500).json({ success:false, message:'Error interno', error:e.message });
  }
});

/**
 * @route GET /api/leads
 * @desc Obtener leads/clientes desde MongoDB
 * @access Private
 */
router.get('/leads', protect, async (req, res) => {

  try {
    console.log('[API LEADS] Solicitud recibida');
    console.log('[API LEADS] Usuario:', req.user?.username, 'Rol:', req.user?.role);
    
    const db = getDb();
    if (!db) {
      console.error('[API LEADS] No hay conexión a la base de datos');
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50000; // Aumentado a 50000 para asegurar TODOS los registros
    const skip = (page - 1) * limit;

    console.log(`[API LEADS] Parámetros - Página: ${page}, Límite: ${limit}, Skip: ${skip}`);
    const user = req.user;
    const role = (user?.role || '').toLowerCase();
    let filter = {};

    console.log(`[API LEADS] Usuario: ${user?.username}, Rol: ${role}`);

    // Validar que el usuario tenga username
    if (!user || !user.username) {
      console.error('[API LEADS] Error: Usuario sin username válido');
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado correctamente'
      });
    }

    // Si es agente, solo ver sus propios leads
    if (role === 'agente' || role === 'agent') {
      const unameRaw = (user?.username || '').toString().trim();
      const nameRaw = (user?.name || user?.fullName || user?.usuario?.name || '').toString().trim();
      const norm = (s) => (s || '').toString().trim();
      const expand = (s) => {
        const a = norm(s);
        if (!a) return [];
        const b = a.replace(/[._]+/g, ' ');
        return Array.from(new Set([a, b]));
      };
      const variants = Array.from(new Set([
        ...expand(unameRaw),
        ...expand(nameRaw)
      ].filter(Boolean)));
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactConds = [];
      variants.forEach(v => {
        exactConds.push({ agenteNombre: v }, { agente: v }, { usuario: v });
      });
      const regexConds = variants.flatMap(v => ([
        { agenteNombre: { $regex: `^${esc(v)}$`, $options: 'i' } },
        { agente: { $regex: `^${esc(v)}$`, $options: 'i' } },
        { usuario: { $regex: `^${esc(v)}$`, $options: 'i' } }
      ]));
      // ID-based matches
      const idRaw = (user?.id || user?._id || user?.usuario?._id || '').toString().trim();
      const { ObjectId } = require('mongodb');
      const idConds = [];
      if (idRaw) {
        const tryObj = (() => { try { return new ObjectId(idRaw); } catch { return null; } })();
        const idFields = [
          'ownerId','agentId','registeredById','createdBy','agenteId','creadoPor',
          '_raw.ownerId','_raw.agentId','_raw.registeredById','_raw.createdBy','_raw.agenteId','_raw.creadoPor'
        ];
        idFields.forEach(f => {
          const path = f.split('.');
          const mk = (val) => ({ [path.length === 2 ? `${path[0]}.${path[1]}` : path[0]]: val });
          idConds.push(mk(idRaw));
          if (tryObj) idConds.push(mk(tryObj));
        });
      }
      filter = { $or: [...exactConds, ...regexConds, ...idConds] };
      console.log('[API LEADS] Filtro aplicado para agente (variantes/IDs):', { variants, id: idRaw });
    }
    // Si es supervisor, ver leads de su equipo
    else if (role === 'supervisor') {
      filter = {
        $or: [
          { supervisor: user.username },
          { team: user.team }
        ]
      };
      console.log('[API LEADS] Filtro aplicado para supervisor:', user.username);
    }
    // Admin y Backoffice ven todo
    else {
      console.log('[API LEADS] Usuario admin/backoffice - sin filtros');
    }

    // Filtros explícitos por query (permiten reforzar búsqueda cuando el frontend pasa agente/agenteId)
    const extraAnd = [];
    try {
      const q = req.query || {};
      const esc = (x) => String(x||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const { ObjectId } = require('mongodb');
      if (q.agenteId) {
        const s = String(q.agenteId).trim();
        const oid = (()=>{ try { return new ObjectId(s);} catch { return null; } })();
        const idFields = [
          'ownerId','agentId','registeredById','createdBy','agenteId','creadoPor',
          '_raw.ownerId','_raw.agentId','_raw.registeredById','_raw.createdBy','_raw.agenteId','_raw.creadoPor'
        ];
        const or = [];
        idFields.forEach(f => {
          const path = f.includes('.') ? f : f;
          or.push({ [path]: s });
          if (oid) or.push({ [path]: oid });
        });
        if (or.length) extraAnd.push({ $or: or });
      }
      const nameParam = q.agente || q.usuario || '';
      if (nameParam) {
        const p = String(nameParam).trim();
        const or = [
          { agenteNombre: { $regex: `^${esc(p)}$`, $options: 'i' } },
          { agente: { $regex: `^${esc(p)}$`, $options: 'i' } },
          { usuario: { $regex: `^${esc(p)}$`, $options: 'i' } }
        ];
        extraAnd.push({ $or: or });
      }
    } catch(e) { console.warn('[API LEADS] extra query filters error:', e.message); }

    console.log(`[API LEADS] Consultando colección 'costumers'...`);

    // Obtener la colección de la base de datos
    const collection = db.collection('costumers');
 
    // Crear filtro de fecha usando SOLO dia_venta - POR DEFECTO MES ACTUAL
    let dateFilter = null;
    if (req.query.skipDate !== '1') {
      let startDate, endDate;
      if (req.query.fechaInicio || req.query.fechaFin) {
        if (req.query.fechaInicio) startDate = new Date(req.query.fechaInicio);
        if (req.query.fechaFin) { endDate = new Date(req.query.fechaFin); endDate.setHours(23,59,59,999); }
      } else {
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        console.log(`[API LEADS] Aplicando filtro (solo dia_venta) mes actual: ${startDate.toISOString()} a ${endDate.toISOString()}`);
      }

      const formatYMD = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const formatDMY = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

      const daysInRange = [];
      if (startDate && endDate) {
        const current = new Date(startDate);
        while (current <= endDate) {
          daysInRange.push(formatYMD(current));
          daysInRange.push(formatDMY(current));
          current.setDate(current.getDate() + 1);
        }
      }

      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthName = monthNames[startDate.getMonth()];
      const year = startDate.getFullYear();
      const monthYearPattern = `${monthName} \\d{1,2} ${year}`;

      // Solo dia_venta, en cualquiera de los formatos
      dateFilter = {
        $or: [
          { dia_venta: { $in: daysInRange } },
          { dia_venta: { $regex: monthYearPattern, $options: 'i' } }
        ]
      };
    } else {
      console.log('[API LEADS] Filtro de fecha deshabilitado (skipDate=1)');
    }

    // Combinar filtros de usuario y fecha
    let combinedFilter = {};
    
    let withUserAnd = (Object.keys(filter).length > 0) ? [filter] : [];
    if (extraAnd.length) withUserAnd = withUserAnd.concat(extraAnd);
    if (withUserAnd.length && dateFilter) {
      // Ambos filtros: usuario + fecha
      combinedFilter = {
        $and: [ ...withUserAnd, dateFilter ]
      };
    } else if (withUserAnd.length) {
      // Solo filtro de usuario
      combinedFilter = withUserAnd.length === 1 ? withUserAnd[0] : { $and: withUserAnd };
    } else if (dateFilter) {
      // Solo filtro de fecha
      combinedFilter = dateFilter;
    }

    console.log(`[API LEADS] Filtro aplicado:`, JSON.stringify(combinedFilter, null, 2));
    const total = await collection.countDocuments(combinedFilter);
    console.log(`[API LEADS] Total de documentos con filtro combinado: ${total}`);

    // TEMPORAL: Obtener TODOS los registros sin límite para debugging
    const leads = await collection.find(combinedFilter)
      .sort({ _id: -1 })
      .toArray(); // SIN LÍMITE para asegurar que llegan TODOS
    console.log(`[API LEADS] Leads obtenidos: ${leads.length} de ${total}`);

    // Log de registros sin fecha
    const sinFecha = leads.filter(lead => !lead.createdAt).length;
    if (sinFecha > 0) {
      console.log(`[API LEADS] Advertencia: ${sinFecha} registros sin fecha createdAt`);
    }

    res.json({
      success: true,
      data: leads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('[API LEADS] Error completo:', error);
    console.error('[API LEADS] Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route GET /api/leads-total
 * @desc Obtener total absoluto de leads sin filtros (para debugging)
 * @access Private
 */
router.get('/leads-total', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    const collection = db.collection('costumers');

    // Consulta sin filtros para ver total absoluto
    const totalAbsoluto = await collection.countDocuments({});
    const muestra = await collection.find({}).sort({ createdAt: -1 }).limit(3).toArray();

    res.json({
      success: true,
      totalAbsoluto,
      muestra,
      message: 'Consulta sin filtros aplicada'
    });

  } catch (error) {
    console.error('[API LEADS-TOTAL] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

// Actualizar status de un lead (admin/supervisor/backoffice)
router.put('/leads/:id/status', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const role = (req.user?.role || '').toLowerCase();
    const allowed = ['admin', 'supervisor', 'backoffice', 'bo'];
    if (!allowed.some(r => role.includes(r))) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }

    const { id } = req.params;
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ success: false, message: 'status requerido' });

    const { ObjectId } = require('mongodb');
    const collection = db.collection('costumers');
    const result = await collection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    return res.json({ success: true, message: 'Status actualizado', data: { id, status } });
  } catch (error) {
    console.error('[API UPDATE STATUS] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

// ============================
// Actualización de cliente/lead
// ============================
function __isTeamLineas(req){
  try{
    const t = String(req.user?.team||'').toLowerCase();
    const r = String(req.user?.role||'').toLowerCase();
    const u = String(req.user?.username||'').toLowerCase();
    return t.includes('lineas') || r.includes('teamlineas') || u.startsWith('lineas-');
  }catch{ return false; }
}
function __normName(s){
  try { return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'_') || 'UNKNOWN'; }
  catch { return String(s||'').toUpperCase().replace(/\s+/g,'_') || 'UNKNOWN'; }
}
function __getTeamLineasCollection(req){
  const dbTL = getDbFor('TEAM_LINEAS');
  if (!dbTL) return null;
  const ownerName = req.user?.name || req.user?.username || 'UNKNOWN';
  const colName = __normName(ownerName);
  return dbTL.collection(colName);
}
async function __findByIdGeneric(col, id){
  const { ObjectId } = require('mongodb');
  let objId = null; try { objId = new ObjectId(String(id)); } catch { objId = null; }
  const byObj = objId ? await col.findOne({ _id: objId }) : null;
  if (byObj) return byObj;
  return await col.findOne({ _id: String(id) }) || await col.findOne({ id: String(id) });
}
async function getCostumerById(db, id) {
  const { ObjectId } = require('mongodb');
  const collection = db.collection('costumers');
  let objId = null;
  try { objId = new ObjectId(id); } catch { objId = null; }
  const byObj = objId ? await collection.findOne({ _id: objId }) : null;
  if (byObj) return byObj;
  // fallback si se guardó como string
  return await collection.findOne({ _id: id });
}

function buildOwnershipCheck(userIdStr, doc) {
  try {
    const valEq = (v) => {
      if (!v) return false;
      if (typeof v === 'object') {
        const s = v.$oid || v._id || v.id || v.value || (v.toString ? v.toString() : '');
        return String(s) === userIdStr;
      }
      return String(v) === userIdStr;
    };
    const fields = [
      'agenteId','agentId','createdBy','ownerId','registeredById','creadoPor',
      '_raw.agenteId','_raw.agentId','_raw.createdBy','_raw.ownerId','_raw.registeredById','_raw.creadoPor'
    ];
    for (const f of fields) {
      const [a,b] = f.split('.');
      const v = b ? (doc?.[a]?.[b]) : doc?.[a];
      if (valEq(v)) return true;
    }
    return false;
  } catch { return false; }
}

function sanitizePayload(body) {
  const allowed = new Set([
    'nombre_cliente','telefono_principal','telefono_alterno','numero_cuenta','autopago','direccion','zip_code',
    'tipo_servicio','tipo_servicios','sistema','riesgo','dia_venta','dia_instalacion','status','servicios_texto',
    'mercado','supervisor','comentario','motivo_llamada','puntaje','agenteNombre','nombreAgente','agente','agenteId',
    // Team Líneas específicos
    'servicios','telefonos','cantidad_lineas','id','ID'
  ]);
  const set = {};
  Object.keys(body || {}).forEach(k => { if (allowed.has(k)) set[k] = body[k]; });
  // normalizaciones
  if (!set.tipo_servicio && set.tipo_servicios) set.tipo_servicio = set.tipo_servicios;
  if (!set.tipo_servicios && set.tipo_servicio) set.tipo_servicios = set.tipo_servicio;
  if (set.autopago != null) set.autopago = String(set.autopago).toUpperCase();
  if (set.puntaje != null) set.puntaje = Number(set.puntaje) || 0;
  return set;
}

async function commonUpdateHandler(req, res) {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success:false, message:'DB no disponible' });

    const { id } = req.params;
    const doc = await getCostumerById(db, id);
    if (!doc) return res.status(404).json({ success:false, message:'Registro no encontrado' });

    const role = String(req.user?.role || '').toLowerCase();
    const userIdStr = String(req.user?.id || req.user?._id || '').trim();
    const privileged = ['admin','supervisor','backoffice','bo'].some(r => role.includes(r));
    const owns = userIdStr && buildOwnershipCheck(userIdStr, doc);
    if (!privileged && !owns) {
      return res.status(403).json({ success:false, message:'No autorizado' });
    }

    const $set = sanitizePayload(req.body || {});
    if (!Object.keys($set).length) {
      return res.status(400).json({ success:false, message:'Faltan campos requeridos o son inválidos' });
    }

    // Si es Team Líneas: escribir SOLO en TEAM_LINEAS.<USUARIO>
    if (__isTeamLineas(req)) {
      const tcol = __getTeamLineasCollection(req);
      if (!tcol) return res.status(500).json({ success:false, message:'DB TEAM_LINEAS no disponible' });
      const { ObjectId } = require('mongodb');
      let objId = null; try { objId = new ObjectId(id); } catch { objId = null; }
      const filter = objId ? { _id: objId } : ({ $or: [{ _id: id }, { id: id }] });
      const result = await tcol.updateOne(filter, { $set }, { upsert: false });
      if (result.matchedCount === 0) return res.status(404).json({ success:false, message:'No se pudo actualizar (no encontrado en TEAM_LINEAS)' });
      return res.json({ success:true, message:'Registro actualizado (TEAM_LINEAS)', data:{ id, updated: Object.keys($set) } });
    }
    // Caso general (no Team Líneas): colección costumers
    else {
      const { ObjectId } = require('mongodb');
      const collection = db.collection('costumers');
      let objId = null; try { objId = new ObjectId(id); } catch { objId = null; }
      const filter = objId ? { _id: objId } : { _id: id };
      const result = await collection.updateOne(filter, { $set });
      if (result.matchedCount === 0) return res.status(404).json({ success:false, message:'No se pudo actualizar (no encontrado)' });
      return res.json({ success:true, message:'Registro actualizado', data:{ id, updated: Object.keys($set) } });
    }
  } catch (e) {
    console.error('[API UPDATE LEAD] Error:', e);
    return res.status(500).json({ success:false, message:'Error interno', error:e.message });
  }
}

// PUT /api/customers/:id
router.put('/customers/:id', protect, commonUpdateHandler);
// Alias compatible
router.put('/leads/:id', protect, commonUpdateHandler);

// ============================
// Notas: agregar a un lead/cliente
// ============================
async function commonAddNote(req, res) {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success:false, message:'DB no disponible' });
    const { id } = req.params;
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ success:false, message:'Texto de nota requerido' });

    const doc = await getCostumerById(db, id);
    if (!doc) return res.status(404).json({ success:false, message:'Registro no encontrado' });

    const role = String(req.user?.role || '').toLowerCase();
    const userIdStr = String(req.user?.id || req.user?._id || '').trim();
    const privileged = ['admin','supervisor','backoffice','bo'].some(r => role.includes(r));
    const owns = userIdStr && buildOwnershipCheck(userIdStr, doc);
    if (!privileged && !owns) {
      return res.status(403).json({ success:false, message:'No autorizado' });
    }

    const note = {
      text: String(text).trim(),
      author: req.user?.username || req.user?.name || 'Usuario',
      at: new Date().toISOString()
    };

    if (__isTeamLineas(req)) {
      const tcol = __getTeamLineasCollection(req);
      if (!tcol) return res.status(500).json({ success:false, message:'DB TEAM_LINEAS no disponible' });
      const { ObjectId } = require('mongodb');
      let objId = null; try { objId = new ObjectId(id); } catch { objId = null; }
      const filter = objId ? { _id: objId } : ({ $or: [{ _id: id }, { id: id }] });
      const result = await tcol.updateOne(filter, { $push: { notas: note } });
      if (result.matchedCount === 0) return res.status(404).json({ success:false, message:'No se pudo agregar la nota (no encontrado en TEAM_LINEAS)' });
      return res.json({ success:true, message:'Nota agregada (TEAM_LINEAS)', data: note });
    } else {
      const { ObjectId } = require('mongodb');
      const collection = db.collection('costumers');
      let objId = null; try { objId = new ObjectId(id); } catch { objId = null; }
      const filter = objId ? { _id: objId } : { _id: id };
      const result = await collection.updateOne(filter, { $push: { notas: note } });
      if (result.matchedCount === 0) return res.status(404).json({ success:false, message:'No se pudo agregar la nota (no encontrado)' });
      return res.json({ success:true, message:'Nota agregada', data: note });
    }
  } catch (e) {
    console.error('[API ADD NOTE] Error:', e);
    return res.status(500).json({ success:false, message:'Error interno', error:e.message });
  }
}

router.post('/customers/:id/notes', protect, commonAddNote);
router.post('/leads/:id/notes', protect, commonAddNote);

/**
 * @route POST /api/lineas-team/notes
 * @desc Agregar nota a una línea específica de un cliente en Team Lineas
 * @access Private (Supervisor/Admin)
 */
router.post('/lineas-team/notes', protect, async (req, res) => {
  try {
    console.log('[API LINEAS NOTES] Solicitud recibida');
    console.log('[API LINEAS NOTES] Usuario:', req.user?.username, 'Rol:', req.user?.role);
    console.log('[API LINEAS NOTES] Body:', req.body);

    const { clientId, lineIndex, noteText } = req.body;

    // Validar parámetros
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId requerido' });
    }
    if (lineIndex === undefined || lineIndex === null) {
      return res.status(400).json({ success: false, message: 'lineIndex requerido' });
    }
    if (!noteText || !String(noteText).trim()) {
      return res.status(400).json({ success: false, message: 'noteText requerido' });
    }

    const role = String(req.user?.role || '').toLowerCase();
    const username = req.user?.username;

    // Verificar permisos (supervisores y admins)
    if (!['supervisor', 'admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }

    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      console.error('[API LINEAS NOTES] No se pudo conectar a la base de datos TEAM_LINEAS');
      return res.status(500).json({ success: false, message: 'DB TEAM_LINEAS no disponible' });
    }
    
    console.log('[API LINEAS NOTES] Conectado a base de datos TEAM_LINEAS');

    // Para supervisores, buscar en las colecciones de sus agentes
    let agentsToSearch = [];
    if (role === 'supervisor') {
      const usersCol = db.collection('users');
      
      // Buscar agentes que tengan este supervisor
      const agents = await usersCol.find({ 
        $or: [
          { supervisor: username },
          { supervisor: { $regex: username, $options: 'i' } }
        ],
        role: { $regex: /agente/i }
      }).toArray();
      
      agentsToSearch = agents.map(a => a.username);
      console.log('[API LINEAS NOTES] Agentes del supervisor:', agentsToSearch);
      
      // Si no encuentra agentes, usar las colecciones directamente basándose en el equipo
      if (agentsToSearch.length === 0) {
        // Obtener las colecciones del equipo JONATHAN F
        const collections = await db.listCollections().toArray();
        if (username.includes('JONATHAN')) {
          agentsToSearch = ['VICTOR_HURTADO', 'EDWARD_RAMIREZ', 'CRISTIAN_RIVERA', 'OSCAR_RIVERA', 'JOCELYN_REYES', 'NANCY_LOPEZ'];
        } else if (username.includes('LUIS')) {
          agentsToSearch = ['DANIEL_DEL_CID', 'FERNANDO_BELTRAN', 'KARLA_RODRIGUEZ', 'JOCELYN_REYES', 'JONATHAN_GARCIA', 'NANCY_LOPEZ'];
        }
        console.log('[API LINEAS NOTES] Usando agentes predefinidos para', username, ':', agentsToSearch);
      }
    }

    // Buscar el documento en las colecciones correspondientes
    const { ObjectId } = require('mongodb');
    let objId = null;
    try { objId = new ObjectId(clientId); } catch { objId = null; }
    const filter = objId ? { _id: objId } : { _id: clientId };

    let updated = false;
    let collectionName = '';

    // Crear la nota
    const nota = {
      texto: String(noteText).trim(),
      fecha: new Date().toISOString(),
      autor: username
    };

    if (role === 'supervisor') {
      // Buscar en colecciones de agentes
      for (const agentUsername of agentsToSearch) {
        // Las colecciones están con guiones bajos y mayúsculas
        const colName = agentUsername.replace(/\s+/g, '_').toUpperCase();
        
        try {
          const collection = db.collection(colName);
          
          // Actualizar el array de notas de la línea específica
          const updateField = `lines.${lineIndex}.notas`;
          
          console.log(`[API LINEAS NOTES] Buscando en colección: ${colName} con filtro:`, filter);
          
          const result = await collection.updateOne(
            filter,
            { $push: { [updateField]: nota } }
          );
          
          if (result.matchedCount > 0) {
            updated = true;
            collectionName = colName;
            console.log(`[API LINEAS NOTES] Nota agregada en ${colName}, línea ${lineIndex}`);
            break;
          } else {
            console.log(`[API LINEAS NOTES] No encontrado en ${colName} con filtro:`, filter);
          }
        } catch (err) {
          console.log(`[API LINEAS NOTES] Error buscando en ${colName}:`, err.message);
        }
      }
    } else if (role === 'admin') {
      // Para admin, buscar en todas las colecciones de agentes
      const collections = await db.listCollections().toArray();
      const agentCollections = collections
        .filter(c => {
          // Filtrar colecciones que sean nombres de agentes (todas mayúsculas con guiones bajos)
          return /^[A-Z_]+$/.test(c.name) && !c.name.startsWith('system.');
        })
        .map(c => c.name);

      console.log('[API LINEAS NOTES] Colecciones de agentes encontradas:', agentCollections);

      for (const colName of agentCollections) {
        const collection = db.collection(colName);
        const updateField = `lines.${lineIndex}.notas`;
        const result = await collection.updateOne(
          filter,
          { $push: { [updateField]: nota } }
        );
        
        if (result.matchedCount > 0) {
          updated = true;
          collectionName = colName;
          console.log(`[API LINEAS NOTES] Nota agregada en ${colName}, línea ${lineIndex}`);
          break;
        }
      }
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    }

    return res.json({ 
      success: true, 
      message: 'Nota agregada correctamente',
      data: nota,
      collection: collectionName
    });
  } catch (e) {
    console.error('[API LINEAS NOTES] Error:', e);
    return res.status(500).json({ success: false, message: 'Error interno', error: e.message });
  }
});

module.exports = router;
