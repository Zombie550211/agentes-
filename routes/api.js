const express = require('express');
const router = express.Router();
const { getDb, connectToMongoDB } = require('../config/db');
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
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }

    const collection = db.collection('costumers');
    const leads = await collection.find({}).toArray();

    res.json({ success: true, data: leads });
  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
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

router.get('/lineas-team', protect, async (req, res) => {
  try {
    const user = req.user;
    const role = (user?.role || '').toLowerCase();
    const team = (user?.team || '').toLowerCase();
    const isTeamLineas = team.includes('lineas') || role === 'lineas-agentes' || role === 'supervisor team lineas' || (role === 'supervisor' && team.includes('lineas')) || role === 'admin' || role === 'administrador';
    if (!isTeamLineas) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }
    const db = getDbFor('TEAM_LINEAS');
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a DB' });
    }
    const collection = db.collection('team_lineas_leads');
    let filter = {};
    if (role === 'supervisor') {
      filter = { supervisor: { $regex: new RegExp('^' + user.username + '$', 'i') } };
    } else if (role === 'lineas-agentes') {
      filter = { agenteAsignado: user.username };
    }
    const leads = await collection.find(filter).toArray();
    res.json({ success: true, data: leads });
  } catch (error) {
    console.error('[API /lineas-team] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
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
    }
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

module.exports = router;
