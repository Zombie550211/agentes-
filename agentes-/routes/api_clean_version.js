const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { connectToMongoDB, getDb } = require('../config/db');

// Middleware para manejar la conexión a la base de datos
const withDatabase = async (req, res, next) => {
  try {
    const db = await connectToMongoDB();
    if (!db) {
      console.error('[ERROR] No se pudo conectar a la base de datos');
      return res.status(500).json({ 
        success: false, 
        message: 'Error de conexión con la base de datos' 
      });
    }
    req.db = db;
    next();
  } catch (error) {
    console.error('[ERROR] Error en la conexión a la base de datos:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al conectar con la base de datos',
      error: error.message 
    });
  }
};

// Ruta para obtener leads completos (o datos para gráficas si paraGrafica=true)
router.get('/leads', protect, withDatabase, async (req, res) => {
  const db = req.db;
  let filtro = {}; 
  let usuarioAutenticado = req.user || null;
  let customers = [];
  
  try {
    const { 
      paraGrafica = 'false',
      status: statusQuery,
      fechaInicio,
      fechaFin,
      agente: agenteQuery
    } = req.query;

    console.log('🔥 [ENDPOINT] /api/leads ejecutándose');
    console.log('[DEBUG] Query params:', req.query);
    console.log('[DEBUG] Usuario autenticado:', usuarioAutenticado || 'No autenticado');

    // Obtener la colección
    let collection;
    try {
      collection = db.collection('costumers');
      console.log('[DEBUG] Colección costumers obtenida correctamente');
    } catch (error) {
      console.error('[ERROR] Error al obtener la colección costumers:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error al acceder a la colección de clientes',
        error: error.message 
      });
    }

    // Construir el filtro de consulta
    const allFilters = [];
    
    // Aplicar filtro por agente si se especificó
    if (agenteQuery) {
      allFilters.push({ agente: agenteQuery });
      allFilters.push({ agenteNombre: agenteQuery });
      allFilters.push({ createdBy: agenteQuery });
    }
    
    // Aplicar filtro por estado si se especificó
    if (statusQuery) {
      filtro.status = statusQuery;
    }
    
    // Aplicar filtro por rango de fechas si se especificó
    if (fechaInicio || fechaFin) {
      const fechaFiltro = {};
      
      if (fechaInicio) {
        const inicio = new Date(fechaInicio);
        inicio.setUTCHours(0, 0, 0, 0);
        fechaFiltro.$gte = inicio;
      }
      
      if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setUTCHours(23, 59, 59, 999);
        fechaFiltro.$lte = fin;
      }
      
      // Intentar con diferentes campos de fecha
      const camposFecha = ['fecha', 'createdAt', 'fecha_creacion', 'fechaCreacion', 'fecha_lead'];
      const filtrosFecha = camposFecha.map(campo => ({
        [campo]: fechaFiltro
      }));
      
      // Combinar con filtros existentes
      if (Object.keys(filtro).length > 0) {
        filtro = {
          $and: [
            filtro,
            { $or: filtrosFecha }
          ]
        };
      } else {
        filtro = { $or: filtrosFecha };
      }
    }
    
    // Aplicar filtros de agente si existen
    if (allFilters.length > 0) {
      filtro = {
        ...filtro,
        $or: [...(filtro.$or || []), ...allFilters]
      };
    }
    
    console.log('[DEBUG] Filtro aplicado:', JSON.stringify(filtro, null, 2));
    
    // Ejecutar la consulta
    try {
      console.log('[DEBUG] Ejecutando consulta con filtro:', JSON.stringify(filtro, null, 2));
      customers = await collection.find(filtro).toArray();
      console.log(`[DEBUG] Se encontraron ${customers.length} registros`);
      
      // Procesar los resultados
      customers = customers.map(customer => {
        // Asegurar que todos los campos necesarios existan
        const defaultValues = {
          nombre_cliente: 'Sin nombre',
          telefono_principal: 'Sin teléfono',
          direccion: 'Sin dirección',
          tipo_servicios: 'Sin especificar',
          sistema: 'Sin especificar',
          mercado: 'Sin especificar',
          riesgo: 'Sin especificar',
          dia_venta: 'Sin especificar',
          dia_instalacion: 'Sin especificar',
          servicios: 'Sin servicios',
          supervisor: 'Sin supervisor',
          comentario: '',
          motivo_llamada: '',
          zip_code: '',
          telefono_alterno: '',
          autopago: 'No',
          cantidad_lineas: 0,
          pin_seguridad: '',
          numero_cuenta: ''
        };
        
        // Aplicar valores por defecto solo si el campo no existe
        Object.entries(defaultValues).forEach(([key, defaultValue]) => {
          if (customer[key] === undefined || customer[key] === null) {
            customer[key] = defaultValue;
          }
        });
        
        return customer;
      });
      
    } catch (error) {
      console.error('[ERROR] Error al ejecutar la consulta:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al consultar la base de datos',
        error: error.message
      });
    }
    
    // Si se solicitan datos para gráficas, formatear la salida
    if (paraGrafica === 'true') {
      console.log('[DEBUG] Procesando datos para gráfica...');
      
      const datosPorFecha = {};
      
      customers.forEach((customer, index) => {
        try {
          // Obtener la fecha del registro
          const fecha = customer.fecha_creacion || 
                       customer.fecha || 
                       customer.createdAt || 
                       customer.updatedAt || 
                       new Date().toISOString();
          
          // Formatear la fecha a YYYY-MM-DD
          let fechaFormateada;
          try {
            fechaFormateada = new Date(fecha).toISOString().split('T')[0];
          } catch (e) {
            console.error('[ERROR] Fecha inválida:', fecha);
            fechaFormateada = 'fecha-invalida';
          }
          
          // Inicializar el objeto para esta fecha si no existe
          if (!datosPorFecha[fechaFormateada]) {
            datosPorFecha[fechaFormateada] = {
              fecha: fechaFormateada,
              ventas: 0,
              puntaje: 0,
              registros: []
            };
          }
          
          // Sumar ventas y puntaje
          datosPorFecha[fechaFormateada].ventas += 1;
          datosPorFecha[fechaFormateada].puntaje += parseFloat(customer.puntaje) || 0;
          datosPorFecha[fechaFormateada].registros.push(customer);
          
        } catch (error) {
          console.error(`[ERROR] Error procesando registro ${index}:`, error);
        }
      });
      
      // Convertir el objeto a array y ordenar por fecha
      const resultado = Object.values(datosPorFecha).sort((a, b) => 
        new Date(a.fecha) - new Date(b.fecha)
      );
      
      return res.json({
        success: true,
        data: resultado,
        total: resultado.length
      });
    }
    
    // Si no es para gráfica, devolver los datos completos
    return res.json({
      success: true,
      data: customers,
      total: customers.length
    });
    
  } catch (error) {
    console.error('[ERROR] Error en el endpoint /leads:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al procesar la solicitud',
      error: error.message 
    });
  }
});

module.exports = router;
