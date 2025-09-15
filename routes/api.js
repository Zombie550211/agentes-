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
      
      // Función para convertir fecha local de El Salvador a UTC
      const localElSalvadorToUTC = (fechaStr, inicioDia = true) => {
        try {
          if (!fechaStr) {
            console.log('[DEBUG] Usando fecha actual para El Salvador');
            const ahora = new Date();
            const offsetElSalvador = 6 * 60 * 60 * 1000; // 6 horas en milisegundos (UTC-6)
            return new Date(ahora.getTime() - offsetElSalvador);
          }
          
          // Intentar con formato YYYY-MM-DD
          const match = String(fechaStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (!match) {
            throw new Error('Formato de fecha no válido, se esperaba YYYY-MM-DD: ' + fechaStr);
          }
          
          const [_, year, month, day] = match;
          
          // Crear fecha en UTC (sin ajuste de zona horaria)
          let fechaUTC;
          if (inicioDia) {
            // Para inicio del día: 00:00:00 El Salvador = 06:00:00 UTC
            fechaUTC = new Date(Date.UTC(year, month - 1, day, 6, 0, 0));
          } else {
            // Para fin del día: 23:59:59.999 El Salvador = 05:59:59.999 UTC del día siguiente
            fechaUTC = new Date(Date.UTC(year, month - 1, day, 29, 59, 59, 999));
          }
          
          console.log(`[DEBUG] localElSalvadorToUTC: ${fechaStr} -> ${fechaUTC.toISOString()}`);
          return fechaUTC;
          
        } catch (error) {
          console.error('[ERROR] Error al convertir fecha:', fechaStr, error);
          throw error;
        }
      };
      
      // Obtener fecha actual en El Salvador (UTC-6)
      const ahora = new Date();
      const offsetElSalvador = 6 * 60 * 60 * 1000; // 6 horas en milisegundos (UTC-6)
      
      // Obtener componentes de la fecha actual en UTC
      const diaUTC = ahora.getUTCDate();
      const mesUTC = ahora.getUTCMonth();
      const anioUTC = ahora.getUTCFullYear();
      const horaUTC = ahora.getUTCHours();
      
      // Calcular la fecha actual en El Salvador
      const ahoraElSalvador = new Date(ahora);
      ahoraElSalvador.setHours(ahoraElSalvador.getHours() - 6);
      
      // Obtener componentes de la fecha en El Salvador
      const diaElSalvador = ahoraElSalvador.getDate();
      const mesElSalvador = ahoraElSalvador.getMonth();
      const anioElSalvador = ahoraElSalvador.getFullYear();
      
      // Crear fecha de hoy a medianoche en El Salvador (00:00:00 El Salvador = 06:00:00 UTC)
      const hoyElSalvador = new Date(Date.UTC(anioElSalvador, mesElSalvador, diaElSalvador, 6, 0, 0));
      
      // Crear fecha de mañana a medianoche en El Salvador
      const mananaElSalvador = new Date(Date.UTC(anioElSalvador, mesElSalvador, diaElSalvador + 1, 6, 0, 0));
      
      // Formatear fechas como YYYY-MM-DD
      const hoyStr = hoyElSalvador.toISOString().split('T')[0];
      
      console.log('[DEBUG] Fechas calculadas:', {
        servidorUTC: ahora.toISOString(),
        horaUTC: `${horaUTC}:${ahora.getUTCMinutes()}:${ahora.getUTCSeconds()}`,
        elSalvador: ahoraElSalvador.toISOString(),
        hoyElSalvador: hoyElSalvador.toISOString(),
        mananaElSalvador: mananaElSalvador.toISOString(),
        hoyStr,
        diaElSalvador,
        mesElSalvador: mesElSalvador + 1,
        anioElSalvador
      });
      
      // Usar la fecha de hoy si no se especifica fechaInicio
      const fechaInicioAjustada = fechaInicio || hoyStr;
      
      // Usar la fecha de hoy si no se especifica fechaFin
      const fechaFinAjustada = fechaFin || hoyStr;
      
      console.log('[DEBUG] ====== MANEJO DE FECHAS ======');
      console.log(`- Fecha/hora servidor: ${ahora.toISOString()}`);
      console.log(`- Fecha/hora El Salvador: ${ahoraElSalvador.toISOString()}`);
      console.log(`- Fecha actual El Salvador: ${hoyStr}`);
      console.log(`- Filtro inicio: ${fechaInicioAjustada} (${fechaInicio ? 'especificada' : 'hoy'})`);
      console.log(`- Filtro fin: ${fechaFinAjustada} (${fechaFin ? 'especificada' : 'hoy'})`);
      console.log('====================================');
      
      // Aplicar filtros de fecha
      if (fechaInicioAjustada || fechaFinAjustada) {
        const filtroFecha = {};
        
        if (fechaInicioAjustada) {
          const inicio = localElSalvadorToUTC(fechaInicioAjustada, true);
          filtroFecha.$gte = inicio;
          console.log(`[DEBUG] Filtro fecha inicio (El Salvador): ${fechaInicioAjustada} -> UTC: ${inicio.toISOString()}`);
        } else {
          // Si no se especifica fecha de inicio, usar hoy a medianoche
          const inicio = hoyElSalvador;
          filtroFecha.$gte = inicio;
          console.log(`[DEBUG] Fecha inicio no especificada, usando hoy: ${inicio.toISOString()}`);
        }
        
        if (fechaFinAjustada) {
          const fin = localElSalvadorToUTC(fechaFinAjustada, false);
          filtroFecha.$lte = fin;
          console.log(`[DEBUG] Filtro fecha fin (El Salvador): ${fechaFinAjustada} -> UTC: ${fin.toISOString()}`);
        } else {
          // Si no se especifica fecha de fin, usar mañana a medianoche (exclusivo)
          const fin = mananaElSalvador;
          filtroFecha.$lt = fin; // Usar $lt para no incluir la medianoche de mañana
          console.log(`[DEBUG] Fecha fin no especificada, usando mañana: ${fin.toISOString()}`);
        }
        
        // Crear un array de condiciones OR para los campos de fecha
        const condicionesFecha = [
          { 'fecha_contratacion': { ...filtroFecha } },
          { 'fechaContratacion': { ...filtroFecha } },
          { 'fecha': { ...filtroFecha } },
          { 'createdAt': { ...filtroFecha } },
          { 'fecha_creacion': { ...filtroFecha } },
          { 'fechaCreacion': { ...filtroFecha } },
          { 'fecha_lead': { ...filtroFecha } },
          { 'dia_venta': { ...filtroFecha } }
        ];
        
        console.log('[DEBUG] Condiciones de fecha a aplicar:', JSON.stringify(condicionesFecha, null, 2));
        
        // Si no hay condiciones OR previas, crear un nuevo array
        if (!filtro.$or) {
          filtro.$or = condicionesFecha;
        } else {
          // Si ya hay condiciones OR, combinarlas con AND
          filtro = { $and: [
            { $or: condicionesFecha },
            { $or: filtro.$or }
          ]};
        }
      }
      
      // Campos de fecha para búsqueda adicional (si es necesario)
      const camposFecha = [
        'fecha', 
        'createdAt', 
        'fecha_creacion', 
        'fechaCreacion', 
        'fecha_lead',
        'dia_venta',
        'fecha_venta',
        'fechaVenta',
        'fecha_contratacion',
        'fechaContratacion',
        'creadoEn',
        'fecha_registro',
        'fechaRegistro'
      ];
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
          cantidad_lineas: 1,
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
      
      // Función para obtener la fecha en formato YYYY-MM-DD (Honduras UTC-6)
      const toHondurasDate = (fechaInput) => {
        try {
          let fecha;
          
          // Si no hay fecha de entrada, usar la fecha actual en Honduras
          if (!fechaInput) {
            console.log('[DEBUG] Usando fecha actual de Honduras');
            const ahora = new Date();
            // Ajustar a zona horaria de Honduras (UTC-6)
            const offsetHonduras = 6 * 60 * 60 * 1000; // 6 horas en milisegundos
            fecha = new Date(ahora.getTime() - offsetHonduras);
          } else {
            // Intentar crear fecha a partir del input
            fecha = new Date(fechaInput);
            
            // Si no es una fecha válida, intentar con formato YYYY-MM-DD
            if (isNaN(fecha.getTime())) {
              const partes = String(fechaInput).match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (partes) {
                const [_, year, month, day] = partes;
                fecha = new Date(Date.UTC(year, month - 1, day, 6, 0, 0)); // 00:00 Honduras = 06:00 UTC
              }
            }
            
            // Si sigue sin ser válida, usar la fecha actual en Honduras
            if (isNaN(fecha.getTime())) {
              console.warn('[WARN] No se pudo parsear la fecha, usando actual:', fechaInput);
              const ahora = new Date();
              const offsetHonduras = 6 * 60 * 60 * 1000; // 6 horas en milisegundos
              fecha = new Date(ahora.getTime() - offsetHonduras);
            }
          }
          
          // Asegurarse de que la fecha esté en la zona horaria correcta
          const fechaHonduras = new Date(fecha.getTime() - (6 * 60 * 60 * 1000));
          
          // Obtener componentes de la fecha en formato local
          const year = fechaHonduras.getUTCFullYear();
          const month = String(fechaHonduras.getUTCMonth() + 1).padStart(2, '0');
          const day = String(fechaHonduras.getUTCDate()).padStart(2, '0');
          
          const fechaFormateada = `${year}-${month}-${day}`;
          console.log(`[DEBUG] toHondurasDate: ${fechaInput} -> ${fechaFormateada}`);
          return fechaFormateada;
        } catch (e) {
          console.error('[ERROR] Error al convertir fecha:', fechaInput, e);
          return 'error-fecha';
        }
      };
      
      // Procesar clientes para la gráfica
      customers.forEach(customer => {
        try {
          // Obtener la fecha del registro (probar diferentes campos de fecha)
          const posiblesCamposFecha = [
            'fecha_creacion', 'fecha', 'createdAt', 'updatedAt', 
            'fecha_venta', 'dia_venta', 'fechaContratacion', 'fecha_contratacion'
          ];
          
          // Buscar el primer campo de fecha válido
          let fechaHonduras = 'fecha-no-encontrada';
          
          for (const campo of posiblesCamposFecha) {
            if (customer[campo]) {
              const fechaConvertida = toHondurasDate(customer[campo]);
              if (fechaConvertida && !fechaConvertida.startsWith('error') && 
                  !fechaConvertida.startsWith('fecha-no')) {
                fechaHonduras = fechaConvertida;
                break;
              }
            }
          }
          
          // Si no se encontró fecha válida, usar la fecha actual de Honduras
          if (fechaHonduras === 'fecha-no-encontrada') {
            const ahora = new Date();
            const offsetHonduras = 6 * 60 * 60 * 1000;
            const ahoraHonduras = new Date(ahora.getTime() - offsetHonduras);
            const [fechaActual] = ahoraHonduras.toISOString().split('T');
            fechaHonduras = fechaActual;
            console.log(`[DEBUG] Usando fecha actual para cliente sin fecha: ${fechaHonduras}`);
          }
          
          // Inicializar el objeto para esta fecha si no existe
          if (!datosPorFecha[fechaHonduras]) {
            datosPorFecha[fechaHonduras] = {
              fecha: fechaHonduras,
              total: 0,
              icon: 0,
              bamo: 0,
              puntaje: 0,
              registros: 0 // Contador de registros por fecha para depuración
            };
          }
          
          // Incrementar contador de registros para esta fecha
          datosPorFecha[fechaHonduras].registros += 1;
          
          // Sumar al total
          datosPorFecha[fechaHonduras].total += 1;
          
          // Contar ICON/BAMO (insensible a mayúsculas/minúsculas)
          if (customer.mercado && typeof customer.mercado === 'string') {
            if (customer.mercado.toLowerCase() === 'icon') {
              datosPorFecha[fechaHonduras].icon += 1;
            } else if (customer.mercado.toLowerCase() === 'bamo') {
              datosPorFecha[fechaHonduras].bamo += 1;
            }
          }
          
          // Sumar puntaje (manejar diferentes formatos de puntaje)
          let puntaje = 0;
          if (typeof customer.puntaje === 'number') {
            puntaje = customer.puntaje;
          } else if (typeof customer.puntaje === 'string') {
            puntaje = parseFloat(customer.puntaje) || 0;
          }
          
          datosPorFecha[fechaHonduras].puntaje += puntaje;
          
        } catch (error) {
          console.error('[ERROR] Error procesando cliente:', error);
        }
      });
      
      // Convertir el objeto de fechas a un array para la respuesta
      const resultado = Object.values(datosPorFecha);
      
      // Ordenar por fecha (más reciente primero)
      resultado.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      
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

// Exportar el router
module.exports = router;
