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
 
    // Crear filtro de fecha - POR DEFECTO MES ACTUAL
    let dateFilter = null;
    
    // Si se envía skipDate=1, no aplicar filtro de fecha
    if (req.query.skipDate !== '1') {
      let startDate, endDate;
      
      // Si hay filtros de fecha en la query, usarlos
      if (req.query.fechaInicio || req.query.fechaFin) {
        if (req.query.fechaInicio) {
          startDate = new Date(req.query.fechaInicio);
        }
        if (req.query.fechaFin) {
          endDate = new Date(req.query.fechaFin);
          endDate.setHours(23, 59, 59, 999);
        }
      } else {
        // POR DEFECTO: Filtrar por mes actual
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        
        console.log(`[API LEADS] Aplicando filtro de mes actual: ${startDate.toISOString()} a ${endDate.toISOString()}`);
      }
      
      // Crear strings de fecha en diferentes formatos para comparar con dia_venta
      const formatYMD = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };
      
      const formatDMY = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${day}/${m}/${y}`;
      };
      
      // Generar todos los días del rango en formato string
      const daysInRange = [];
      const daysRegex = []; // Para buscar Date objects convertidos a string
      
      if (startDate && endDate) {
        const current = new Date(startDate);
        while (current <= endDate) {
          // Formatos estándar
          daysInRange.push(formatYMD(current));
          daysInRange.push(formatDMY(current));
          
          // Regex para capturar Date objects como string (ej: "Thu Oct 24 2025")
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayName = dayNames[current.getDay()];
          const monthName = monthNames[current.getMonth()];
          const day = current.getDate();
          const year = current.getFullYear();
          
          // Patrón: "Thu Oct 24 2025" (sin importar la hora)
          daysRegex.push(new RegExp(`^${dayName} ${monthName} ${String(day).padStart(2, '0')} ${year}`, 'i'));
          daysRegex.push(new RegExp(`^${dayName} ${monthName} ${day} ${year}`, 'i')); // Sin padding
          
          current.setDate(current.getDate() + 1);
        }
      }
      
      // Crear filtro que funcione tanto para Date objects como para strings
      const orConditions = [];
      
      // Para campos tipo Date (createdAt, creadoEn)
      if (startDate && endDate) {
        orConditions.push(
          { createdAt: { $gte: startDate, $lte: endDate } },
          { creadoEn: { $gte: startDate, $lte: endDate } },
          { fecha_creacion: { $gte: startDate, $lte: endDate } }
        );
      }
      
      // Para campos tipo String (dia_venta) - formatos YYYY-MM-DD y DD/MM/YYYY
      if (daysInRange.length > 0) {
        orConditions.push(
          { dia_venta: { $in: daysInRange } },
          { fecha_contratacion: { $in: daysInRange } }
        );
      }
      
      // Para Date objects convertidos a string (ej: "Thu Oct 24 2025 00:00:00 GMT-0600")
      if (daysRegex.length > 0) {
        daysRegex.forEach(regex => {
          orConditions.push(
            { dia_venta: { $regex: regex } },
            { fecha_contratacion: { $regex: regex } }
          );
        });
      }
      
      dateFilter = { $or: orConditions };
    } else {
      console.log('[API LEADS] Filtro de fecha deshabilitado (skipDate=1)');
    }

    // Combinar filtros de usuario y fecha
    let combinedFilter = {};
    
    if (Object.keys(filter).length > 0 && dateFilter) {
      // Ambos filtros: usuario + fecha
      combinedFilter = {
        $and: [
          filter,
          dateFilter
        ]
      };
    } else if (Object.keys(filter).length > 0) {
      // Solo filtro de usuario
      combinedFilter = filter;
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

    res.json({ success: true, message: 'Status actualizado', data: { id, status } });
  } catch (error) {
    console.error('[API UPDATE STATUS] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

module.exports = router;
