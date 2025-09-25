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
  
  try {
    const { 
      paraGrafica = 'false', 
      fecha,
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
      
      // Función para convertir fecha Honduras a UTC
      const hondurasToUTC = (dateStr) => {
        console.log('[DEBUG] Convirtiendo fecha Honduras a UTC:', dateStr);
        const [year, month, day] = dateStr.split('-').map(Number);
        // Crear fecha en UTC que represente la medianoche en Honduras (00:00 Honduras = 06:00 UTC)
        const fechaUTC = new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0));
        console.log(`[DEBUG] Fecha convertida a UTC: ${fechaUTC.toISOString()}`);
        return fechaUTC;
      };

      if (fechaInicio) {
        const inicio = hondurasToUTC(fechaInicio);
        fechaFiltro.$gte = inicio;
        console.log(`[DEBUG] Filtro fecha inicio (Honduras): ${fechaInicio} -> UTC: ${inicio.toISOString()}`);
      }
      
      if (fechaFin) {
        // Usar la misma función para convertir la fecha de fin
        const fin = hondurasToUTC(fechaFin);
        // Ajustar al final del día (23:59:59.999)
        fin.setUTCHours(29, 59, 59, 999); // 23:59:59.999 Honduras = 05:59:59.999 UTC del día siguiente
        fechaFiltro.$lte = fin;
        console.log(`[DEBUG] Filtro fecha fin (Honduras): ${fechaFin} -> UTC: ${fin.toISOString()}`);
      }
      
      // Crear filtros para diferentes campos de fecha
      const filtrosFecha = [];
      
      // 1. Primero, buscar por dia_venta exacto (formato YYYY-MM-DD)
      if (fechaInicio) {
        // Filtro simple para dia_venta exacto
        const filtroDiaVenta = {
          'dia_venta': fechaInicio
        };
        console.log('[DEBUG] Aplicando filtro exacto para dia_venta:', filtroDiaVenta);
        filtrosFecha.push(filtroDiaVenta);
        
        // Filtro para documentos sin dia_venta pero con fechas en otros campos
        const filtroCamposFecha = {
          $and: [
            { 
              $or: [
                { 'fecha_venta': { ...fechaFiltro } },
                { 'fecha_contratacion': { ...fechaFiltro } },
                { 'creadoEn': { ...fechaFiltro } },
                { 'createdAt': { ...fechaFiltro } },
                { 'fecha_creacion': { ...fechaFiltro } },
                { 'fecha': { ...fechaFiltro } }
              ]
            },
            {
              $or: [
                { 'dia_venta': { $exists: false } },
                { 'dia_venta': null },
                { 'dia_venta': '' },
                { 'dia_venta': { $not: { $type: 'string' } } }
              ]
            }
          ]
        };
        
        console.log('[DEBUG] Aplicando filtro para campos de fecha estándar');
        filtrosFecha.push(filtroCamposFecha);
      }
      
      // 2. Filtro para campos de fecha que son objetos Date
      // Solo aplicar si hay filtros de fecha definidos
      if (Object.keys(fechaFiltro).length > 0) {
        const camposFecha = [
          'fecha', 'createdAt', 'fecha_creacion', 'fechaCreacion', 
          'fecha_lead', 'fecha_venta', 'fechaVenta', 'fecha_contratacion',
          'fechaContratacion', 'creadoEn', 'fecha_registro', 'fechaRegistro'
        ];
        
        camposFecha.forEach(campo => {
          filtrosFecha.push({ [campo]: { ...fechaFiltro } });
        });
      }
      
      console.log('[DEBUG] Filtros de fecha aplicados:', JSON.stringify(filtrosFecha, null, 2));
      
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
    let customers = [];
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
      console.log(`[DEBUG] Total de registros a procesar: ${customers.length}`);
      
      const datosPorFecha = new Map(); // Usamos Map para mejor rendimiento
      let totalVentas = 0; // Contador de ventas totales
      
      // Función para extraer fecha de un objeto de cliente
      const extraerFecha = (cliente) => {
        // Función para crear fecha sin ajustes de zona horaria
        const crearFechaLocal = (year, month, day) => {
          // Crear fecha en hora local sin ajustes de zona
          const fecha = new Date(year, month - 1, day, 12, 0, 0, 0);
          console.log(`[DEBUG] Fecha creada sin zona horaria: ${year}-${month}-${day} -> ${fecha.toISOString()}`);
          return fecha;
        };

        // Primero verificar si existe el campo dia_venta
        if (cliente.dia_venta) {
          try {
            // Si es un string con formato YYYY-MM-DD
            if (typeof cliente.dia_venta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cliente.dia_venta)) {
              const [year, month, day] = cliente.dia_venta.split('-').map(Number);
              const fecha = crearFechaLocal(year, month, day);
              console.log('[DEBUG] Fecha extraída de dia_venta (YYYY-MM-DD):', {
                original: cliente.dia_venta,
                parsed: fecha.toISOString(),
                local: fecha.toString()
              });
              // Devolver solo la fecha sin hora
              return new Date(Date.UTC(year, month - 1, day));
            }
            // Si es un string con formato DD/MM/YYYY
            else if (typeof cliente.dia_venta === 'string' && cliente.dia_venta.includes('/')) {
              const [day, month, year] = cliente.dia_venta.split('/').map(Number);
              // Asegurar año de 4 dígitos
              const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year;
              const fecha = crearFechaLocal(fullYear, month, day);
              console.log('[DEBUG] Fecha extraída de dia_venta (DD/MM/YYYY):', {
                original: cliente.dia_venta,
                parsed: fecha.toISOString(),
                local: fecha.toString()
              });
              // Devolver solo la fecha sin hora
              return new Date(Date.UTC(fullYear, month - 1, day));
            }
            // Si es una fecha ISO o timestamp
            else {
              const fecha = new Date(cliente.dia_venta);
              if (!isNaN(fecha.getTime())) {
                // Usar la fecha directamente sin ajustes de zona horaria
                console.log('[DEBUG] Fecha extraída de dia_venta (ISO):', {
                  original: cliente.dia_venta,
                  parsed: fecha.toISOString(),
                  local: fecha.toString()
                });
                // Devolver solo la parte de la fecha
                return new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
              }
            }
          } catch (e) {
            console.warn('[ADVERTENCIA] Error al procesar campo dia_venta:', e);
          }
        }
        
        // Si no se pudo obtener de dia_venta, intentar con otros campos
        const otrosCamposFecha = [
          'fecha_venta', 'fechaVenta',
          'fecha_contratacion', 'fechaContratacion',
          'fecha_creacion', 'fechaCreacion', 'createdAt',
          'fecha_registro', 'fechaRegistro', 'creadoEn',
          'fecha', 'updatedAt', 'fecha_actualizacion'
        ];
        
        for (const campo of otrosCamposFecha) {
          if (cliente[campo]) {
            try {
              const fecha = new Date(cliente[campo]);
              if (!isNaN(fecha.getTime())) {
                // Usar la fecha directamente sin ajustes de zona horaria
                console.log(`[ADVERTENCIA] Usando campo alternativo ${campo} en lugar de dia_venta`);
                // Devolver solo la parte de la fecha
                return new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
              }
            } catch (e) {
              console.warn(`[ADVERTENCIA] Error al procesar campo ${campo}:`, e);
            }
          }
        }
        
        // Si no se encuentra ninguna fecha válida, devolver la fecha actual
        const now = new Date();
        // Devolver solo la fecha sin hora
        const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        console.warn('[ADVERTENCIA] No se encontró una fecha válida, usando fecha actual:', today);
        return today;
      };

      // Procesar cada cliente
      customers.forEach((customer, index) => {
        try {
          // Obtener la fecha del registro usando la función mejorada
          const fecha = extraerFecha(customer);
          
          // Si no se pudo determinar la fecha, omitir este registro
          if (!fecha) {
            console.warn(`[ADVERTENCIA] Registro ${index}: No se pudo determinar la fecha para el cliente:`, 
              customer._id || 'ID no disponible');
            return; // Saltar a la siguiente iteración
          }
          
          // Formatear la fecha a YYYY-MM-DD
          const fechaFormateada = fecha.toISOString().split('T')[0];
          
          // Obtener o inicializar los datos para esta fecha
          if (!datosPorFecha.has(fechaFormateada)) {
            datosPorFecha.set(fechaFormateada, {
              fecha: fechaFormateada,
              ventas: 0,
              puntaje: 0,
              registros: []
            });
          }
          
          const datosDia = datosPorFecha.get(fechaFormateada);
          
          // Calcular cantidad de ventas (líneas) para este cliente
          const cantidadVentas = Math.max(1, parseInt(customer.cantidad_lineas) || 1);
          const puntajeVenta = parseFloat(customer.puntaje) || 0;
          
          // Actualizar contadores
          datosDia.ventas += cantidadVentas;
          datosDia.puntaje += puntajeVenta;
          totalVentas += cantidadVentas;
          
          // Mantener registro de los datos originales (opcional, para depuración)
          if (datosDia.registros.length < 5) { // Limitar para no sobrecargar memoria
            datosDia.registros.push({
              id: customer._id,
              nombre: customer.nombre_cliente || 'Sin nombre',
              lineas: cantidadVentas,
              puntaje: puntajeVenta
            });
          }
          
          // Debug detallado para los primeros 5 registros
          if (index < 5) {
            console.log(`[DEBUG] Registro ${index + 1}:`, {
              fecha: fechaFormateada,
              cliente: customer.nombre_cliente || 'Sin nombre',
              lineas: cantidadVentas,
              puntaje: puntajeVenta,
              totalVentasHastaAhora: datosDia.ventas
            });
          }
        } catch (error) {
          console.error(`[ERROR] Error al procesar registro ${index}:`, error);
        }
      });

      // Convertir el Map a array y ordenar por fecha
      const resultado = Array.from(datosPorFecha.values())
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      
      console.log(`[DEBUG] Resumen de ventas por fecha:`, resultado.map(r => ({
        fecha: r.fecha, 
        ventas: r.ventas,
        registros: r.registros.length
      })));
      
      console.log(`[DEBUG] Total de ventas procesadas: ${totalVentas}`);
      
      return res.json({
        success: true,
        data: resultado,
        totalVentas: totalVentas,
        totalDias: resultado.length
      });
      
    } // Fin del if (paraGrafica === 'true')

    // Si no es para gráfica, devolver los clientes sin procesar
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

// Exportar el router
module.exports = router;
