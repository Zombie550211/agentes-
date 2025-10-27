const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
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

    const { ObjectId } = require('mongodb');
    const collection = db.collection('costumers');
    let objId = null; try { objId = new ObjectId(id); } catch { objId = null; }
    const filter = objId ? { _id: objId } : { _id: id };
    const result = await collection.updateOne(filter, { $set });
    if (result.matchedCount === 0) return res.status(404).json({ success:false, message:'No se pudo actualizar (no encontrado)' });
    return res.json({ success:true, message:'Registro actualizado', data:{ id, updated: Object.keys($set) } });
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

    const { ObjectId } = require('mongodb');
    const collection = db.collection('costumers');
    let objId = null; try { objId = new ObjectId(id); } catch { objId = null; }
    const filter = objId ? { _id: objId } : { _id: id };
    const result = await collection.updateOne(filter, { $push: { notas: note } });
    if (result.matchedCount === 0) return res.status(404).json({ success:false, message:'No se pudo agregar la nota (no encontrado)' });
    return res.json({ success:true, message:'Nota agregada', data: note });
  } catch (e) {
    console.error('[API ADD NOTE] Error:', e);
    return res.status(500).json({ success:false, message:'Error interno', error:e.message });
  }
}

router.post('/customers/:id/notes', protect, commonAddNote);
router.post('/leads/:id/notes', protect, commonAddNote);

module.exports = router;
