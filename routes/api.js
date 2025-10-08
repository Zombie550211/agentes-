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

    // Si es agente, solo ver sus propios leads
    if (role === 'agente' || role === 'agent') {
      filter = {
        $or: [
          { agenteNombre: user.username },
          { agente: user.username },
          { usuario: user.username }
        ]
      };
      console.log('[API LEADS] Filtro aplicado para agente:', user.username);
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

    console.log(`[API LEADS] Consultando colección 'costumers'...`);

    // Obtener la colección de la base de datos
    const collection = db.collection('costumers');

    // Crear filtro más flexible para fechas
    let dateFilter = {};

    // Si hay filtros de fecha en la query, usarlos
    if (req.query.fechaInicio || req.query.fechaFin) {
      dateFilter.createdAt = {};
      if (req.query.fechaInicio) {
        dateFilter.createdAt.$gte = new Date(req.query.fechaInicio);
      }
      if (req.query.fechaFin) {
        dateFilter.createdAt.$lte = new Date(req.query.fechaFin);
      }
    }

    // Combinar filtros de usuario y fecha
    const combinedFilter = { ...filter, ...dateFilter };

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
    console.error('[API LEADS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
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

    res.json({ success: true, message: 'Status actualizado', data: { id, status } });
  } catch (error) {
    console.error('[API UPDATE STATUS] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

module.exports = router;
