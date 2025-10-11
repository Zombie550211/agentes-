const express = require('express');
const router = express.Router();
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
  const { 
    paraGrafica = 'false',
    status: statusQuery,
    fechaInicio,
    fechaFin,
    agente: agenteQuery
  } = req.query;
  
  try {
  
  console.log('🔥🔥🔥 [ENDPOINT CORRECTO] /api/leads ejecutándose 🔥🔥🔥');
  console.log('[DEBUG] ===== INICIO ENDPOINT /api/leads =====');
  console.log('[DEBUG] Query params:', req.query);
  console.log('[DEBUG] Headers:', JSON.stringify({
    authorization: req.headers.authorization ? 'Presente' : 'Ausente',
    host: req.headers.host,
    'user-agent': req.headers['user-agent']
  }, null, 2));
  console.log('[DEBUG] Usuario autenticado (req.user):', req.user || 'No autenticado');
  
  try {
    const { paraGrafica = 'false', fecha } = req.query;
    
    // Agregar filtro por fecha si se proporciona
    if (fecha) {
      console.log(`[DEBUG] Filtrando por fecha: ${fecha}`);
      
      try {
        // Crear fechas para el rango completo del día en UTC
        const fechaInicio = new Date(fecha);
        fechaInicio.setUTCHours(0, 0, 0, 0); // Inicio del día en UTC
        
        const fechaFin = new Date(fechaInicio);
        fechaFin.setUTCDate(fechaFin.getUTCDate() + 1); // Inicio del día siguiente en UTC
        
        // Formatear fechas para comparación con cadenas (YYYY-MM-DD)
        const fechaStr = fechaInicio.toISOString().split('T')[0];
        
        console.log(`[DEBUG] Rango de fechas para filtrar:`);
        console.log(`[DEBUG] - Inicio (UTC): ${fechaInicio.toISOString()}`);
        console.log(`[DEBUG] - Fin (UTC):    ${fechaFin.toISOString()}`);
        console.log(`[DEBUG] - Filtro cadena: ${fechaStr}`);
        
        // Crear un filtro por fecha_contratacion con múltiples formatos
        const filtrosFecha = [
          // Formato YYYY-MM-DD
          { fecha_contratacion: fechaStr },
          
          // Formato ISO (con tiempo)
          { 
            fecha_contratacion: { 
              $regex: `^${fechaStr}`, 
              $options: 'i' 
            } 
          },
          
          // Formato DD/MM/YYYY (invertido)
          {
            $expr: {
              $eq: [
                { 
                  $dateToString: { 
                    format: "%d/%m/%Y",
                    date: { 
                      $dateFromString: { 
                        dateString: "$fecha_contratacion",
                        format: "%Y-%m-%d"
                      }
                    }
                  }
                },
                fechaInicio.toLocaleDateString('es-ES')
              ]
            }
          }
        ];
        
        console.log('[DEBUG] Filtro simplificado de fechas:', JSON.stringify(filtrosFecha, null, 2));
        
        // Si ya hay un $or en el filtro, combinarlos, de lo contrario, crear uno nuevo
        if (filtro.$or) {
          filtro.$and = [
            { $or: filtro.$or },
            { $or: filtrosFecha }
          ];
          delete filtro.$or;
        } else {
          filtro.$or = filtrosFecha;
        }
        
        console.log(`[DEBUG] Filtro de fecha aplicado:`, JSON.stringify(filtro, null, 2));
        
        // Agregar un stage de $addFields para depuración
        const debugPipeline = [
          { $match: filtro },
          { $limit: 5 },
          {
            $project: {
              _id: 1,
              fecha_creacion: 1,
              fecha_contratacion: 1,
              dia_venta: 1,
              creadoEn: 1,
              fecha_actual: { $dateToString: { format: "%Y-%m-%d", date: new Date() } },
              fecha_creacion_formato: { $dateToString: { format: "%Y-%m-%d", date: "$fecha_creacion" } },
              dia_venta_parseado: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: {
                    $dateFromString: {
                      dateString: "$dia_venta",
                      format: "%d/%m/%Y"
                    }
                  }
                }
              }
            }
          }
        ];
        
        console.log('[DEBUG] Pipeline de depuración:', JSON.stringify(debugPipeline, null, 2));
        
        // Ejecutar el pipeline de depuración
        try {
          if (!db) {
            console.error('[DEBUG] Error: No hay conexión a la base de datos');
            return;
          }
          const debugResults = await db.collection('costumers').aggregate(debugPipeline).toArray();
          console.log('[DEBUG] Resultados del pipeline de depuración (primeros 5 documentos):');
          console.log(JSON.stringify(debugResults, null, 2));
        } catch (debugError) {
          console.error('[DEBUG] Error en el pipeline de depuración:', debugError);
        }
        
      } catch (error) {
        console.error('[ERROR] Error al procesar el filtro de fecha:', error);
        // Continuar sin filtrar por fecha en caso de error
      }
    }
    
    // Extraer información del usuario desde el token
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token && token !== 'temp-token-dev') {
      try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
        console.log('[DEBUG] Verificando token JWT...');
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('[DEBUG] Token decodificado:', JSON.stringify(decoded, null, 2));
        
        usuarioAutenticado = {
          id: decoded.userId || decoded.id,
          username: decoded.username,
          role: decoded.role
        };
        console.log('[DEBUG] Usuario autenticado desde token:', JSON.stringify(usuarioAutenticado, null, 2));
      } catch (jwtError) {
        console.log('Error decodificando token:', jwtError.message);
      }
    }
    
    // Capturar filtros por query
    const agenteQuery = (req.query.agente || '').toString().trim();
    const fechaQuery = req.query.fecha; 
    const agenteIdQuery = (req.query.agenteId || '').toString().trim();
    const statusQuery = (req.query.status || '').toString().trim();
    const fechaInicio = req.query.fechaInicio;
    const fechaFin = req.query.fechaFin;

    // Verificar si estamos en modo demo (sin base de datos)
    if (!process.env.MONGODB_URI) {
      // Modo demo: devolver datos de ejemplo filtrados por usuario
      const agenteName = agenteQuery || usuarioAutenticado?.username || 'Usuario Demo';
      const datosEjemplo = [
        { fecha: new Date(), producto: 'Internet', puntaje: 8, status: 'COMPLETED', agente: agenteName },
        { fecha: new Date(), producto: 'Televisión', puntaje: 7, status: 'PENDING', agente: agenteName },
        { fecha: new Date(Date.now() - 86400000), producto: 'Internet', puntaje: 9, status: 'COMPLETED', agente: agenteName },
        { fecha: new Date(Date.now() - 86400000), producto: 'Telefonía', puntaje: 6, status: 'CANCELLED', agente: agenteName }
      ];
      const filtrados = statusQuery ? datosEjemplo.filter(d => d.status === statusQuery) : datosEjemplo;
      return res.json(paraGrafica === 'true' 
        ? { success: true, data: filtrados.map(({ fecha, producto, puntaje, status, agente }) => 
            ({ fecha, producto, puntaje, status, agente })) } 
        : { success: true, data: filtrados });
    }
    
    // Si hay conexión a MongoDB, obtener datos reales
    console.log('[DEBUG] Conectando a MongoDB...');
    console.log('[DEBUG] MONGODB_URI:', process.env.MONGODB_URI ? 'Definida' : 'No definida');
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('crmagente');
    console.log('[DEBUG] Conectado a la base de datos:', db.databaseName);
    
    // Listar colecciones disponibles
    const collections = await db.listCollections().toArray();
    console.log('[DEBUG] Colecciones disponibles:', collections.map(c => c.name));
    
    // Construir filtro de consulta
    console.log('[DEBUG] Construyendo filtro de consulta...');
    console.log('[DEBUG] agenteIdQuery:', agenteIdQuery || 'No definido');
    console.log('[DEBUG] agenteQuery:', agenteQuery || 'No definido');
    console.log('[DEBUG] statusQuery:', statusQuery || 'No definido');
    console.log('[DEBUG] Usuario autenticado:', JSON.stringify(usuarioAutenticado, null, 2));
    console.log('[DEBUG] Rol del usuario:', usuarioAutenticado?.role || 'No definido');
    
    if (agenteIdQuery) {
      const { ObjectId } = require('mongodb');
      let oid = null;
      try { 
        if (/^[a-fA-F0-9]{24}$/.test(agenteIdQuery)) oid = new ObjectId(agenteIdQuery); 
      } catch {}
      
      const bothTypes = oid ? { $in: [agenteIdQuery, oid] } : agenteIdQuery;
      const agentFieldCandidates = [
        'agenteId', 'agentId', 'createdBy', 'ownerId', 'assignedId', 
        'usuarioId', 'userId', 'registeredBy', 'asignadoId', 'asignadoAId', 'creadoPor'
      ];
      
      filtro = { $or: agentFieldCandidates.map(f => ({ [f]: bothTypes })) };
      console.log('Filtrando leads por query agenteId:', agenteIdQuery);
    } 
    else if (agenteQuery) {
      filtro = { $or: [ { agenteNombre: agenteQuery }, { agente: agenteQuery } ] };
      console.log('Filtrando leads por query agente:', agenteQuery);
    } 
    else if (usuarioAutenticado) {
      // Si no se pasó agente por query, decidir por rol
      const role = (usuarioAutenticado.role || '').toString().toLowerCase();
      const isPrivileged = ['admin', 'supervisor', 'backoffice'].includes(role);
      
      console.log(`[DEBUG] Usuario: ${usuarioAutenticado.username}, ID: ${usuarioAutenticado.id}, Rol: "${role}", Es privilegiado: ${isPrivileged}`);
      
      // Si es un usuario privilegiado, no aplicar ningún filtro por defecto
      if (isPrivileged) {
        console.log('[DEBUG] Usuario privilegiado, mostrando todos los registros');
        filtro = {}; // Sin filtro para ver todos los registros
      } else {
        // Agentes y cualquier otro rol: filtrar por su propio ID y username
        const userId = usuarioAutenticado.id;
        const username = usuarioAutenticado.username;
        const { ObjectId } = require('mongodb');
        
        // Crear filtros tanto para ID como para nombre de usuario
        const allFilters = [];
        
        // Intentar convertir a ObjectId si es válido
        try { 
          if (/^[a-fA-F0-9]{24}$/.test(userId)) {
            const oid = new ObjectId(userId);
            // Agregar filtros para ID (tanto ObjectId como string)
            [
              'agenteId', 'agentId', 'createdBy', 'ownerId', 'creadoPor', 'registeredById'
            ].forEach(field => {
              allFilters.push({ [field]: oid });
              allFilters.push({ [field]: userId });
            });
          }
        } catch (e) {
          console.error('Error convirtiendo userId a ObjectId:', e);
        }
        
        // Agregar filtros para nombre de usuario
        if (username) {
          allFilters.push({ agente: username });
          allFilters.push({ agenteNombre: username });
          allFilters.push({ createdBy: username });
        }
        
        // Aplicar filtros
        filtro = allFilters.length > 0 ? { $or: allFilters } : { _id: new ObjectId('000000000000000000000000') };
        console.log(`[DEBUG] Filtro aplicado para agente ${username} (${userId}):`, JSON.stringify(filtro, null, 2));
      }
    }
    
    // Aplicar filtro por estado si viene en query
    if (statusQuery) {
      filtro = { ...filtro, status: statusQuery };
    }
    
    // Aplicar filtro por rango de fechas si vienen en query
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
      
      console.log('Filtro de fechas aplicado:', JSON.stringify(filtro, null, 2));
    }
    
    // Si no hay filtro, verificar si es un administrador
    if (Object.keys(filtro).length === 0) {
      const role = (usuarioAutenticado?.role || '').toString().toLowerCase();
      const isPrivileged = ['admin', 'supervisor', 'backoffice'].includes(role);
      
      if (isPrivileged) {
        console.log('[DEBUG] Usuario privilegiado sin filtros, devolviendo todos los registros');
        // No aplicar ningún filtro, devolver todos los registros
      } else {
        console.log('[DEBUG] Usuario no privilegiado sin filtros, devolviendo array vacío por seguridad');
        return res.json({ success: true, data: [] });
      }
    }
    
    // Ejecutar la consulta con el filtro construido
    console.log('[DEBUG] Ejecutando consulta con filtro:', JSON.stringify(filtro, null, 2));
    console.log('[DEBUG] Colección a consultar: costumers');
    try {
      const count = await db.collection('costumers').countDocuments(filtro);
      console.log(`[DEBUG] Total de documentos que coinciden con el filtro: ${count}`);
    } catch (countError) {
      console.error('[DEBUG] Error al contar documentos:', countError);
    }
      // Procesar cada cliente para asegurar que todos los campos necesarios existan
      customers = customers.map(customer => {
        // Crear un objeto con todos los campos del cliente
        const processedCustomer = { ...customer };
        
        // Campos de fecha
        const fecha = customer.fecha_creacion || 
                     customer.fecha || 
                     customer.createdAt || 
                     customer.updatedAt || 
                     new Date().toISOString();
        
        // Asegurar que los campos principales existan
        processedCustomer.fecha = new Date(fecha).toISOString().split('T')[0];
        processedCustomer.fecha_creacion = customer.fecha_creacion || fecha;
        processedCustomer.producto = customer.producto || 'Sin producto';
        processedCustomer.puntaje = customer.puntaje || 0;
        processedCustomer.status = customer.status || 'Pendiente';
        processedCustomer.agente = customer.agente || customer.agenteNombre || customer.createdBy || 'Sin asignar';
        processedCustomer.agenteNombre = customer.agenteNombre || customer.agente || 'Sin asignar';
        
        // Mantener todos los campos originales
        Object.keys(customer).forEach(key => {
          if (!(key in processedCustomer)) {
            processedCustomer[key] = customer[key];
          }
        });
        
        // Asegurar campos comunes que podrían faltar
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
          if (processedCustomer[key] === undefined || processedCustomer[key] === null) {
            processedCustomer[key] = defaultValue;
      }
    } catch (e) {
      console.error('Error convirtiendo userId a ObjectId:', e);
    }
    
    // Agregar filtros para nombre de usuario
    if (username) {
      allFilters.push({ agente: username });
      allFilters.push({ agenteNombre: username });
      allFilters.push({ createdBy: username });
    }
    
    // Aplicar filtros
    filtro = allFilters.length > 0 ? { $or: allFilters } : { _id: new ObjectId('000000000000000000000000') };
    console.log(`[DEBUG] Filtro aplicado para agente ${username} (${userId}):`, JSON.stringify(filtro, null, 2));
  }
}

// Aplicar filtro por estado si viene en query
if (statusQuery) {
  filtro = { ...filtro, status: statusQuery };
}

  
// Aplicar filtro por rango de fechas si vienen en query
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
  
  console.log('Filtro de fechas aplicado:', JSON.stringify(filtro, null, 2));
}
  
// Si no hay filtro, verificar si es un administrador
if (Object.keys(filtro).length === 0) {
  const role = (usuarioAutenticado?.role || '').toString().toLowerCase();
  const isPrivileged = ['admin', 'supervisor', 'backoffice'].includes(role);
  
  if (isPrivileged) {
    console.log('[DEBUG] Usuario privilegiado sin filtros, devolviendo todos los registros');
    // No aplicar ningún filtro, devolver todos los registros
  } else {
    console.log('[DEBUG] Usuario no privilegiado sin filtros, devolviendo array vacío por seguridad');
    return res.json({ success: true, data: [] });
  }
}
  
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
  
try {
  // Debug: mostrar algunos registros para verificar campos de agente
  if (customers.length > 0 && usuarioAutenticado && !['admin', 'supervisor', 'backoffice'].includes((usuarioAutenticado.role || '').toLowerCase())) {
    console.log(`[DEBUG] Primeros 3 registros - campos de agente:`);
    customers.slice(0, 3).forEach((customer, i) => {
      console.log(`  Registro ${i + 1}: agenteNombre="${customer.agenteNombre}", agente="${customer.agente}"`);
    });
  }
} catch (error) {
  console.error('Error en depuración de registros:', error);
}
  
// Si se solicitan datos para gráficas, formatear la salida
if (paraGrafica === 'true') {
  console.log('[DEBUG] Procesando datos para gráfica...');
  console.log(`[DEBUG] Total de registros a procesar: ${customers.length}`);
  
  // Agrupar por fecha y sumar ventas y puntaje
  const datosPorFecha = {};
  
  // Mostrar los primeros 3 registros para depuración
  if (customers.length > 0) {
    console.log('[DEBUG] Primeros 3 registros:', JSON.stringify(customers.slice(0, 3), null, 2));
  }
  
  customers.forEach((customer, index) => {
    try {
      // Obtener la fecha del registro, priorizando diferentes campos de fecha
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
        console.error(`[ERROR] Fecha inválida en registro ${index}:`, fecha, customer);
        fechaFormateada = 'Fecha inválida';
      }
      
      // Debug: mostrar información de agente si es necesario
      if (index < 3 && usuarioAutenticado && !['admin', 'supervisor', 'backoffice'].includes((usuarioAutenticado.role || '').toLowerCase())) {
        console.log(`[DEBUG] Registro ${index + 1}: agenteNombre="${customer.agenteNombre}", agente="${customer.agente}"`);
      }
      
      // Aquí iría el resto de la lógica de procesamiento de fechas
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
      console.error(`Error procesando registro ${index}:`, error);
    }
    
    // Si se solicitan datos para gráficas, formatear la salida
    if (paraGrafica === 'true') {
      console.log('[DEBUG] Procesando datos para gráfica...');
      console.log(`[DEBUG] Total de registros a procesar: ${customers.length}`);
      
      // Agrupar por fecha y sumar ventas y puntaje
      const datosPorFecha = {};
      
      // Mostrar los primeros 3 registros para depuración
      if (customers.length > 0) {
        console.log('[DEBUG] Primeros 3 registros:', JSON.stringify(customers.slice(0, 3), null, 2));
      }
      
      customers.forEach((customer, index) => {
        try {
          // Obtener la fecha del registro, priorizando diferentes campos de fecha
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
            console.error(`[ERROR] Fecha inválida en registro ${index}:`, fecha, customer);
            fechaFormateada = 'Fecha inválida';
          }
          
          if (!datosPorFecha[fechaFormateada]) {
            datosPorFecha[fechaFormateada] = {
              fecha: fechaFormateada,
              ventas: 0,
              puntaje: 0,
              registros: []
            };
          }
          
          // Contar cada registro como una venta
          datosPorFecha[fechaFormateada].ventas += 1;
          
          // Sumar el puntaje si está disponible
          const puntaje = parseFloat(customer.puntaje) || 0;
          datosPorFecha[fechaFormateada].puntaje += puntaje;
          
          // Mantener registro de los datos originales para depuración
          datosPorFecha[fechaFormateada].registros.push(customer);
          
        } catch (error) {
          console.error(`Error procesando el registro ${index}:`, error, customer);
        }
      });
      
      // Convertir el objeto a array y ordenar por fecha
      const datosGraficas = Object.values(datosPorFecha)
        .map(item => ({
          fecha: item.fecha,
          ventas: item.ventas,
          puntaje: item.puntaje,
          // Incluir datos adicionales para depuración
          _registros: item.registros,
          // Asegurar que los valores numéricos sean números
          _totalVentas: Number(item.ventas),
          _totalPuntaje: Number(item.puntaje)
        }))
        .sort((a, b) => {
          // Manejar fechas inválidas poniéndolas al final
          const dateA = a.fecha === 'Fecha inválida' ? new Date('9999-12-31') : new Date(a.fecha);
          const dateB = b.fecha === 'Fecha inválida' ? new Date('9999-12-31') : new Date(b.fecha);
          return dateA - dateB;
        });
      
      console.log(`[DEBUG] Datos formateados para gráfica: ${datosGraficas.length} fechas únicas`);
      console.log('[DEBUG] Ejemplo de datos formateados:', 
        JSON.stringify(datosGraficas.slice(0, 3), null, 2));
      
      return res.json({ 
        success: true, 
        data: datosGraficas,
        _debug: {
          totalRegistros: customers.length,
          fechasUnicas: datosGraficas.length,
          primeraFecha: datosGraficas[0]?.fecha,
          ultimaFecha: datosGraficas[datosGraficas.length - 1]?.fecha
        }
      });
    }
    
    // Devolver datos completos si no se solicitó para gráficas
    return res.json({ success: true, data: customers });
    
  } catch (error) {
    console.error('Error en el endpoint /leads:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al procesar la solicitud', 
      error: error.message 
    });
  } finally {
    // Cerrar la conexión solo si se abrió
    if (client) {
      await client.close().catch(err => 
        console.error('Error al cerrar la conexión con MongoDB:', err)
      );
    }
  }
});

// Función auxiliar para formatear fechas
function tryDateFrom(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    // Formato YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    }
    // Formato DD/MM/YYYY o DD-MM-YYYY
    if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(s)) {
      const parts = s.split(/[\/\-]/).map(Number);
      const [d, m, y] = parts;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900) {
        return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      }
    }
  }
  // Si es un número, asumir timestamp (segundos o milisegundos)
  if (typeof val === 'number') {
    return new Date(val < 1e12 ? val * 1000 : val);
  }
  // Intentar convertir a fecha directamente
  const dt = new Date(val);
  return isNaN(dt.getTime()) ? null : dt;
}

// Ruta para obtener métricas de clientes
router.get('/customer-metrics', protect, async (req, res) => {
  try {
    const { startDate, endDate, agente } = req.query;
    let matchStage = {};
    
    // Aplicar filtros si se proporcionan
    if (startDate || endDate) {
      matchStage.fecha = {};
      if (startDate) matchStage.fecha.$gte = new Date(startDate);
      if (endDate) matchStage.fecha.$lte = new Date(endDate);
    }
    
    if (agente) {
      matchStage.$or = [
        { agenteNombre: agente },
        { agente: agente },
        { agenteId: agente }
      ];
    }
    
    // Si el usuario no es admin/supervisor, filtrar solo sus clientes
    if (req.user && !['admin', 'supervisor'].includes(req.user.role)) {
      matchStage.$or = [
        { agenteId: req.user.id },
        { agente: req.user.username },
        { agenteNombre: req.user.username }
      ];
    }
    
    // Agregar más lógica de agregación según sea necesario
    
    return res.json({ success: true, data: [] });
    
  } catch (error) {
    console.error('Error en /customer-metrics:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al obtener métricas',
      error: error.message 
    });
  }
});

// Ruta para obtener documentos completos con paginación
router.get('/customers', protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    
    // Lógica para obtener clientes con paginación
    // ...
    
    // Lógica para obtener clientes con paginación
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
      await client.connect();
      const db = client.db('crmagente');
      
      // Construir el filtro basado en el rol del usuario
      const filter = {};
      if (req.user && !['admin', 'supervisor'].includes(req.user.role)) {
        filter.$or = [
          { agenteId: req.user.id },
          { agente: req.user.username },
          { agenteNombre: req.user.username }
        ];
      }
      
      // Obtener el total de documentos
      const total = await db.collection('costumers').countDocuments(filter);
      
      // Obtener los documentos paginados
      const data = await db.collection('costumers')
        .find(filter)
        .skip(skip)
        .limit(limitNum)
        .toArray();
      
      // Log del primer cliente para depuración
      if (data.length > 0) {
        console.log('[DEBUG] Campos del primer lead:', Object.keys(data[0]));
        console.log('[DEBUG] Ejemplo de lead completo:', JSON.stringify(data[0], null, 2));
      }
      
      // Enviar respuesta exitosa con los clientes
      const response = {
        success: true,
        count: data.length,
        data: data.map(customer => {
          // Crear un objeto con todos los campos del cliente
          const responseCustomer = { ...customer };
          
          // Asegurar que los campos importantes tengan un valor
          const defaultValues = {
            _id: '',
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
            numero_cuenta: '',
            fecha: new Date().toISOString().split('T')[0],
            producto: 'Sin producto',
            puntaje: 0,
            status: 'Pendiente',
            agente: 'Sin asignar',
            agenteNombre: 'Sin asignar',
            createdBy: ''
          };
          
          // Asegurar que todos los campos tengan un valor
          Object.entries(defaultValues).forEach(([key, defaultValue]) => {
            if (responseCustomer[key] === undefined || responseCustomer[key] === null) {
              responseCustomer[key] = defaultValue;
            }
          });
          
          return responseCustomer;
        }),
        pagination: {
          total: total,
          page: page,
          limit: limit,
          totalPages: Math.ceil(total / limit)
        }
      };
      
      // Enviar respuesta
      res.status(200).json(response);
    } catch (error) {
      console.error('Error en /customers:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al obtener clientes',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Error en /customers:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud',
      error: error.message
    });
  }
});

// Ruta de ejemplo
router.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'API funcionando correctamente' 
  });
});

// Métricas para panel Costumer: ventasHoy, ventasMes, pendientes, total clientes
router.get('/agente/costumer-metricas', async (req, res) => {
  try {
    // Decodificar usuario desde Authorization (opcional)
    let usuarioAutenticado = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token && token !== 'temp-token-dev') {
      try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
        const decoded = jwt.verify(token, JWT_SECRET);
        usuarioAutenticado = {
          id: decoded.userId || decoded.id,
          username: decoded.username || decoded.name || decoded.email,
          role: (decoded.role || '').toString().toLowerCase()
        };
        console.log('[DEBUG] Usuario autenticado en costumer-metricas:', usuarioAutenticado);
      } catch (error) {
        console.log('Error decodificando token en costumer-metricas:', error.message);
      }
    }

    // Si no hay DB -> demo
    if (!process.env.MONGODB_URI) {
      const now = new Date();
      return res.json({ ventasHoy: 0, ventasMes: 0, leadsPendientes: 0, clientes: 0, now });
    }

    // Conectar a Mongo
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('crmagente');

    // Filtros por rol (alineados a /api/customers)
    const agenteQuery = (req.query.agente || '').toString().trim();
    const agenteIdParamRaw = (req.query.agenteId || '').toString().trim();
    let filtroBase = {};
    const { ObjectId } = require('mongodb');

    // Roles privilegiados: vista global
    const role = (usuarioAutenticado?.role || '').toString().toLowerCase();
    const isPrivileged = ['admin', 'supervisor', 'backoffice', 'b:o', 'b.o', 'b-o', 'bo'].includes(role);

    console.log(`[DEBUG METRICAS] Usuario: ${usuarioAutenticado?.username}, Rol: "${role}", Es privilegiado: ${isPrivileged}`);
    
    if (!isPrivileged) {
      // Construir filtro robusto por múltiples campos de ID con fallback por nombre SOLO si faltan IDs
      const currentUserId = String(usuarioAutenticado?.id || '').trim();
      let oid = null; try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) oid = new ObjectId(currentUserId); } catch {}
      const bothTypes = oid ? { $in: [currentUserId, oid] } : currentUserId;

      const agentFieldCandidates = [
        'agenteId','agentId','createdBy','ownerId','assignedId','usuarioId','userId','registeredBy','asignadoId','asignadoAId'
      ];
      const idOr = agentFieldCandidates.map(f => ({ [f]: bothTypes }));

      // Fallback por nombre si TODOS los campos de ID están vacíos/ausentes
      const nameCandidatesRaw = [usuarioAutenticado?.username, usuarioAutenticado?.name, usuarioAutenticado?.email]
        .filter(v => typeof v === 'string' && v.trim().length > 0)
        .map(v => v.trim());
      const nameRegexes = nameCandidatesRaw.map(n => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
      const nameFields = ['agenteNombre','agente','agentName','nombreAgente','nombre_agente','agente_nombre','salesAgent','asignadoA','assignedTo','usuario','owner','registeredBy','seller','vendedor'];
      const nameOrSimple = [];
      nameFields.forEach(f => nameRegexes.forEach(rx => nameOrSimple.push({ [f]: rx })));
      const idEmptyOrMissing = { $and: agentFieldCandidates.map(f => ({ $or: [ { [f]: { $exists: false } }, { [f]: null }, { [f]: '' } ] })) };
      const nameAndIfNoIds = (nameOrSimple.length ? { $and: [ { $or: nameOrSimple }, idEmptyOrMissing ] } : null);

      filtroBase = nameAndIfNoIds ? { $or: [...idOr, nameAndIfNoIds] } : { $or: [...idOr] };
    }

    // Si viene agenteId por query (para admin/supervisor/backoffice)
    if (isPrivileged && agenteIdParamRaw) {
      let oid = null;
      try { if (/^[a-fA-F0-9]{24}$/.test(agenteIdParamRaw)) oid = new ObjectId(agenteIdParamRaw); } catch {}
      const bothTypes = oid ? { $in: [agenteIdParamRaw, oid] } : agenteIdParamRaw;
      filtroBase = { agenteId: bothTypes };
    } else if (isPrivileged && !agenteIdParamRaw && agenteQuery) {
      // Admin/supervisor/backoffice: permitir filtro por nombre (parcial) si se especifica
      const safe = agenteQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const containsCI = new RegExp(safe, 'i');
      filtroBase = {
        $or: [
          { agente: containsCI },
          { agent: containsCI },
          { agenteNombre: containsCI },
          { agentName: containsCI }
        ]
      };
    }

    // Obtener todos los costumers visibles para el usuario
    const costumers = await db.collection('costumers').find(filtroBase).toArray();

    // Helpers de fecha: misma lógica que la gráfica (UTC-6)
    const BUSINESS_TZ_OFFSET_MIN = -6 * 60; // UTC-6 fijo
    const toISOInTZ = (date, tzOffsetMinutes) => {
      const target = new Date(date.getTime() + tzOffsetMinutes * 60000);
      const y = target.getUTCFullYear();
      const m = String(target.getUTCMonth() + 1).padStart(2, '0');
      const d = String(target.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const getByPath = (obj, path) => {
      try { return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj); }
      catch { return undefined; }
    };
    const findFirst = (obj, paths) => {
      for (const p of paths) {
        const v = getByPath(obj, p);
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    const tryDateFrom = (val) => {
      if (!val) return null;
      if (typeof val === 'string') {
        const s = val.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const [y, m, d] = s.split('-').map(Number);
          return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        }
        if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(s)) {
          const parts = s.split(/[\/\-]/).map(Number);
          const [d, m, y] = parts;
          if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900) {
            return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
          }
        }
      }
      if (typeof val === 'number') return new Date(val < 1e12 ? val * 1000 : val);
      const dt = new Date(val); return isNaN(dt) ? null : dt;
    };

    const hoyISO = toISOInTZ(new Date(), BUSINESS_TZ_OFFSET_MIN);
    const createdPaths = [
      // raíz
      'creadoEn','fecha_creacion','fechaCreacion','createdAt','created_at','createdon','createdOn','created','fecha','fecha_lead',
      'insertedAt','inserted_at','createdDate','created_date','created_datetime',
      // _raw
      '_raw.creadoEn','_raw.fecha_creacion','_raw.fechaCreacion','_raw.createdAt','_raw.created_at','_raw.createdon','_raw.createdOn','_raw.created','_raw.fecha','_raw.fecha_lead',
      '_raw.insertedAt','_raw.inserted_at','_raw.createdDate','_raw.created_date','_raw.created_datetime',
      // metadata
      'metadata.createdAt','metadata.created_at','metadata.createdon','metadata.createdOn',
      // audit/timestamps
      'audit.createdAt','audit.created_at','audit.createdon','audit.createdOn',
      'timestamps.createdAt','timestamps.created_at','timestamps.createdon','timestamps.createdOn'
    ];
    const diaVentaPaths = ['dia_venta','diaVenta','dia','_raw.dia_venta','_raw.diaVenta','_raw.dia','fecha_contratacion','_raw.fecha_contratacion'];

    let ventasHoy = 0;
    let ventasMes = 0;
    let leadsPendientes = 0;
    const clientes = costumers.length;

    // Calcular el primer día del mes actual en UTC-6
    const hoy = new Date();
    const hoyISO_ = toISOInTZ(hoy, BUSINESS_TZ_OFFSET_MIN);
    const [hy, hm] = hoyISO_.split('-').map(Number);
    const primerDiaMesUTC = new Date(Date.UTC(hy, hm - 1, 1, 12, 0, 0));
    const inicioMesISO = toISOInTZ(primerDiaMesUTC, BUSINESS_TZ_OFFSET_MIN);

    const debugMode = (req.query.debug === '1' || req.query.debug === 'true');
    const debugInfo = debugMode ? { hoyISO, inicioMesISO, matchedToday: [], matchedMonth: 0, pending: 0, examined: 0, fallbacksToToday: 0 } : null;

    for (const c of costumers) {
      // Fecha de negocio priorizando dia_venta; luego fechas de creación
      const diaVentaVal = findFirst(c, diaVentaPaths);
      let fecha = tryDateFrom(typeof diaVentaVal === 'string' ? diaVentaVal.trim() : diaVentaVal);
      if (!fecha) {
        const fechaCreacionVal = findFirst(c, createdPaths);
        fecha = tryDateFrom(fechaCreacionVal);
      }
      // Fallback: si no hay fecha válida, usar hoy (igual que la gráfica)
      let fechaStr = fecha ? toISOInTZ(fecha, BUSINESS_TZ_OFFSET_MIN) : null;
      if (!fechaStr) {
        fechaStr = hoyISO;
        if (debugMode) debugInfo.fallbacksToToday++;
      }
      if (fechaStr === hoyISO) ventasHoy += 1;
      if (fechaStr && fechaStr >= inicioMesISO) ventasMes += 1;

      const st = (c.status || c.estado || '').toString().toUpperCase();
      if (st === 'PENDING' || st === 'PENDIENTE') leadsPendientes += 1;

      if (debugMode) {
        debugInfo.examined++;
        if (fechaStr === hoyISO) {
          debugInfo.matchedToday.push({ _id: c._id, dia_venta: diaVentaVal, fechaStr, status: st });
        }
        if (fechaStr && fechaStr >= inicioMesISO) debugInfo.matchedMonth++;
        if (st === 'PENDING' || st === 'PENDIENTE') debugInfo.pending++;
      }
    }

    await client.close();

    const payload = { ventasHoy, ventasMes, leadsPendientes, clientes, hoyISO };
    if (debugMode) payload.debug = debugInfo;
    return res.json(payload);
  } catch (error) {
    console.error('Error en /agente/costumer-metricas:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener métricas', error: error.message });
  }
});

// Ruta para obtener estadísticas de agentes (ventas y puntajes)
router.get('/agent-stats', async (req, res) => {
  try {
    // Verificar si estamos en modo demo (sin base de datos)
    if (!process.env.MONGODB_URI) {
      // Modo demo: devolver datos de ejemplo
      const datosEjemplo = {
        success: true,
        data: [
          { agente: 'Juan Pérez', ventas: 15, puntajeTotal: 120, puntajePromedio: 8 },
          { agente: 'María García', ventas: 12, puntajeTotal: 108, puntajePromedio: 9 },
          { agente: 'Carlos López', ventas: 8, puntajeTotal: 64, puntajePromedio: 8 }
        ]
      };
      return res.json(datosEjemplo);
    }
    
    // Conectar a MongoDB
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('crmagente');
    
    // Agregación para obtener estadísticas por agente
    const pipeline = [
      {
        $match: {
          status: 'COMPLETED', // Solo leads completados
          agente: { $exists: true, $ne: null } // Que tengan agente asignado
        }
      },
      {
        $group: {
          _id: '$agente',
          ventas: { $sum: 1 },
          puntajeTotal: { $sum: { $toInt: '$puntaje' } },
          puntajePromedio: { $avg: { $toInt: '$puntaje' } }
        }
      },
      {
        $project: {
          _id: 0,
          agente: '$_id',
          ventas: 1,
          puntajeTotal: 1,
          puntajePromedio: { $round: ['$puntajePromedio', 2] }
        }
      },
      { $sort: { ventas: -1 } } // Ordenar por número de ventas (descendente)
    ];
    
    const estadisticas = await db.collection('costumers').aggregate(pipeline).toArray();
    await client.close();
    
    res.json({
      success: true,
      data: estadisticas
    });
    
  } catch (error) {
    console.error('Error al obtener estadísticas de agentes:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener las estadísticas de agentes',
      error: error.message
    });
  }
});

// Ruta simulada para registro de usuario
router.post('/register', (req, res) => {
  const { name, email } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ 
      success: false, 
      message: 'Por favor ingrese nombre y correo' 
    });
  }

  // Simular respuesta exitosa sin guardar en base de datos
  res.status(201).json({
    success: true,
    message: 'Usuario registrado exitosamente (modo demo)',
    user: {
      id: 'demo-user-123',
      name,
      email,
      role: 'agent'
    }
  });
});


module.exports = router;
