const express = require('express');
const router = express.Router();
const { getDb, getDbFor, connectToMongoDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');

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
      const collection = db.collection('costumers');
      let leads = await collection.find({}).toArray();

      // Intentar integrar también datos de TEAM_LINEAS
      try {
        const dbTL = getDbFor('TEAM_LINEAS');
        if (dbTL) {
          const collections = await dbTL.listCollections().toArray();
          console.log('[API /leads] Integrando TEAM_LINEAS en mapa. Colecciones:', collections.map(c => c.name));

          for (const coll of collections) {
            const docs = await dbTL.collection(coll.name).find({}).toArray();
            // Marcar origen para depuración futura
            leads = leads.concat(docs.map(d => ({ ...d, __source: 'TEAM_LINEAS', __collection: coll.name })));
          }
        } else {
          console.warn('[API /leads] TEAM_LINEAS no disponible para solicitud global');
        }
      } catch (e) {
        console.warn('[API /leads] Error integrando TEAM_LINEAS en solicitud global:', e.message);
      }

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
        // Usar mes específico del parámetro (formato: YYYY-MM)
        const [year, monthNum] = month.split('-').map(Number);
        targetYear = year;
        targetMonth = monthNum;
        console.log(`[API /leads] Filtro por mes específico: ${month}`);
      } else {
        // Usar mes actual por defecto
        const now = new Date();
        targetYear = now.getFullYear();
        targetMonth = now.getMonth() + 1; // 1-12
        console.log(`[API /leads] Filtro automático por mes actual: ${targetYear}-${String(targetMonth).padStart(2, '0')}`);
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

    // ====== FILTRADO POR ROL SUPERVISOR ======
    const role = (req.user?.role || '').toLowerCase();
    const currentUserId = req.user?._id?.toString() || req.user?.id?.toString() || '';
    console.log(`[API /leads] Usuario: ${req.user?.username}, Rol: ${role}`);
    
    if (role === 'supervisor' || role.includes('supervisor')) {
      console.log('[API /leads] Aplicando filtro de supervisor...');
      // Obtener variantes del nombre del supervisor
      const supNames = [req.user?.username, req.user?.name, req.user?.nombre, req.user?.fullName]
        .filter(v => typeof v === 'string' && v.trim())
        .map(v => v.trim());
      
      // Agregar partes del nombre (nombre, apellido)
      const allVariants = [];
      supNames.forEach(n => {
        allVariants.push(n);
        n.split(/\s+/).filter(p => p.length > 2).forEach(p => allVariants.push(p));
      });
      
      console.log('[API /leads] Variantes de supervisor:', allVariants);
      
      // Crear regex para cada variante
      const supRegexes = allVariants.map(n => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      
      // Campos donde buscar el supervisor
      const supervisorFields = ['supervisor', 'team', 'teamName', 'equipo', 'SUPERVISOR'];
      const supervisorOr = supervisorFields.map(f => ({ [f]: { $in: supRegexes } }));
      
      // Agregar filtro de supervisor al query
      if (query.$and) {
        query.$and.push({ $or: supervisorOr });
      } else if (Object.keys(query).length > 0) {
        query = { $and: [query, { $or: supervisorOr }] };
      } else {
        query = { $or: supervisorOr };
      }
      
      console.log('[API /leads] Filtro supervisor aplicado');
    }
    // ====== FIN FILTRADO SUPERVISOR ======

    const collection = db.collection('costumers');
    const leads = await collection.find(query).sort({ 
      dia_venta: -1,  // Primero por día de venta (más reciente primero)
      createdAt: -1   // Luego por fecha de creación
    }).toArray();

    console.log(`[API /leads] Query ejecutado:`, JSON.stringify(query, null, 2));
    console.log(`[API /leads] Resultados encontrados: ${leads.length}`);

    res.json({ success: true, data: leads, queryUsed: query });

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
    const collection = db.collection('costumers');
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

    const { id: recordId } = req.params;
    const { status: newStatus } = req.body || {};
    if (!newStatus) {
      return res.status(400).json({ success: false, message: 'status requerido' });
    }

    const collection = db.collection('costumers');
    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    const filter = objId ? { _id: objId } : { _id: recordId };
    const result = await collection.updateOne(filter, { $set: { status: newStatus } });

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    return res.json({ success: true, message: 'Status actualizado', data: { id: recordId, status: newStatus } });
  } catch (error) {
    console.error('[API UPDATE STATUS] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

/**
 * @route GET /api/leads/:id
 * @desc Obtener un lead por ID
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

    const collection = db.collection('costumers');
    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    
    // Buscar por ObjectId o por string
    let lead = null;
    if (objId) {
      lead = await collection.findOne({ _id: objId });
    }
    if (!lead) {
      lead = await collection.findOne({ _id: recordId });
    }

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    console.log('[GET /leads/:id] Lead encontrado, tiene notas:', Array.isArray(lead.notas) ? lead.notas.length : 'no');
    return res.json({ success: true, data: lead, lead: lead });
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

    const collection = db.collection('costumers');
    let objId = null;
    try { objId = new ObjectId(recordId); } catch { objId = null; }
    
    // Intentar actualizar por ObjectId primero
    let result = null;
    if (objId) {
      result = await collection.updateOne({ _id: objId }, { $set: updateData });
    }
    
    // Si no se encontró, intentar por string
    if (!result || result.matchedCount === 0) {
      result = await collection.updateOne({ _id: recordId }, { $set: updateData });
    }

    if (!result || result.matchedCount === 0) {
      console.log('[PUT /leads/:id] Lead no encontrado');
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    // Emitir notificación Socket.io si se actualizaron notas
    if (updateData.notas && global.io) {
      try {
        // Obtener info del lead para saber quién es el dueño
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

    console.log('[PUT /leads/:id] Actualizado correctamente. matchedCount:', result.matchedCount, 'modifiedCount:', result.modifiedCount);
    return res.json({ 
      success: true, 
      message: 'Lead actualizado correctamente', 
      data: { id: recordId, ...updateData } 
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

    const collection = db.collection('costumers');
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
