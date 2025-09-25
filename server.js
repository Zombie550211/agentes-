require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const axios = require('axios');

// Configuración
const { MongoClient, ObjectId } = require('mongodb');
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';

if (!MONGODB_URI) {
  console.error("[ERROR] La variable de entorno MONGODB_URI no está definida. Asegúrate de tener un archivo .env con la cadena de conexión.");
  process.exit(1);
}

const CRM_ADMIN_URL = 'https://connecting-klf7.onrender.com/api/sync/costumer'; // Reemplaza localhost:3000 si es diferente
const CRM_ADMIN_API_KEY = 'tu-clave-secreta-muy-larga-y-dificil-de-adivinar'; // Usa la misma clave que en el Admin

const app = express();

// Variables para la base de datos
let db;
let leadsCollection;
let costumersCollection;
let usersCollection;

// Configuración de CORS
const corsOptions = {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3003'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200 // Para navegadores antiguos (IE11, varios SmartTVs)
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Manejar solicitudes OPTIONS (preflight)
app.options('*', cors(corsOptions));

// Servir archivos estáticos (HTML, CSS, JS) desde el directorio raíz
app.use(express.static(__dirname));

// Middleware de autenticación básico (comentado temporalmente para pruebas)
/*
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};
*/

// Conectar a MongoDB e iniciar el servidor
const PORT = process.env.PORT || 3003;

MongoClient.connect(MONGODB_URI)
  .then(client => {
    console.log('[INFO] Conectado exitosamente a MongoDB');
    db = client.db('crmagente'); // Especificar explícitamente la base de datos
    console.log(`[INFO] Usando base de datos: ${db.databaseName}`);
    leadsCollection = db.collection('leads');
    costumersCollection = db.collection('costumers');
    usersCollection = db.collection('users');

    app.listen(PORT, () => {
      console.log(`[INFO] Servidor iniciado en http://localhost:${PORT}`);
      console.log('[INFO] Usando almacenamiento en MongoDB.');
    });
  })
  .catch(error => {
    console.error('[FATAL] No se pudo conectar a MongoDB:', error);
    process.exit(1);
  });



// Función para sincronizar con CRM Admin
async function sincronizarConAdmin(leadData) {
  // Función auxiliar para agregar "team" solo al supervisor
  const agregarTeamSupervisor = (supervisor) => {
    if (!supervisor) return '';
    const supervisorStr = String(supervisor);
    if (/^team\s/i.test(supervisorStr)) return supervisorStr;
    return `team ${supervisorStr}`;
  };

  try {
    console.log(`[DEBUG] Simulando sincronización con CRM Admin para lead: ${leadData._id || 'nuevo'}`);
    // Simulamos un retardo de red
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`[DEBUG] Sincronización simulada exitosamente`);
    return { success: true, message: 'Sincronización simulada' };
  } catch (error) {
    console.error(`[ERROR] Error simulado al sincronizar: ${error.message}`);
    return { error: 'Error simulado al sincronizar' };
  }
}

// --- RUTAS DE LA API ---

// Rutas de autenticación
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Rutas de equipos (estadísticas, lista, etc.)
const equipoRoutes = require('./routes/equipoRoutes');
app.use('/api/equipos', equipoRoutes);

// Rutas de empleado del mes (subida de imagen, listado, actualización)
const employeesOfMonthRoutes = require('./routes/employeesOfMonth');
app.use('/api/employees-of-month', employeesOfMonthRoutes);

// Obtener todos los customers (para usuarios regulares)
app.get('/api/customers', async (req, res) => {
  try {
    console.log('[LOG] Petición recibida en GET /api/customers');
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limitReq = parseInt(req.query.limit || '200', 10);
    const limit = Math.max(Math.min(limitReq, 500), 1); // limitar a 500 por seguridad
    const skip = (page - 1) * limit;
    console.log(`[DEBUG] Paginación solicitada -> page=${page}, limit=${limit}, skip=${skip}`);

    // Calcular estadísticas para KPIs con fechas precisas
    const today = new Date();
    const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD formato
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0'); // MM formato
    const currentYear = String(today.getFullYear()); // YYYY formato
    const monthPattern = `${currentYear}-${currentMonth}`; // 2025-09 formato

    console.log(`[LOG] Calculando KPIs para fecha: ${todayString}, mes: ${monthPattern}`);

    const [items, total, stats] = await Promise.all([
      // Orden determinístico para que la paginación no repita registros
      costumersCollection.find({}).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
      costumersCollection.countDocuments({}),
      costumersCollection.aggregate([
        {
          $facet: {
            ventasHoy: [
              {
                $match: {
                  $or: [
                    { dia_venta: todayString },
                    { fecha: todayString },
                    { FECHA: todayString }
                  ]
                }
              },
              { $count: "count" }
            ],
            ventasMes: [
              {
                $match: {
                  $or: [
                    { dia_venta: { $regex: `^${monthPattern}` } },
                    { fecha: { $regex: `^${monthPattern}` } },
                    { FECHA: { $regex: `^${monthPattern}` } }
                  ]
                }
              },
              { $count: "count" }
            ],
            pendientes: [
              {
                $match: {
                  $or: [
                    { status: { $regex: /^pendiente$/i } },
                    { estado: { $regex: /^pendiente$/i } },
                    { STATUS: { $regex: /^pendiente$/i } }
                  ]
                }
              },
              { $count: "count" }
            ],
            cancelados: [
              {
                $match: {
                  $or: [
                    { status: { $regex: /^(cancelado|anulado|cancelled)$/i } },
                    { estado: { $regex: /^(cancelado|anulado|cancelled)$/i } },
                    { STATUS: { $regex: /^(cancelado|anulado|cancelled)$/i } }
                  ]
                }
              },
              { $count: "count" }
            ]
          }
        }
      ]).toArray()
    ]);

    // Extraer estadísticas del resultado de agregación
    const statsResult = stats[0] || {};
    const kpiStats = {
      ventasHoy: statsResult.ventasHoy?.[0]?.count || 0,
      ventasMes: statsResult.ventasMes?.[0]?.count || 0,
      pendientes: statsResult.pendientes?.[0]?.count || 0,
      cancelados: statsResult.cancelados?.[0]?.count || 0
    };

    console.log(`[LOG] Consulta a DB exitosa. Página ${page}, límite ${limit}. Encontrados ${items.length}/${total}.`);
    if (items && items.length > 0) {
      console.log(`[DEBUG] Primer _id en página ${page}:`, items[0]._id);
      console.log(`[DEBUG] Último _id en página ${page}:`, items[items.length - 1]._id);
    }
    console.log(`[LOG] Stats raw del agregado:`, JSON.stringify(stats, null, 2));
    console.log(`[LOG] KPIs calculados:`, kpiStats);
    
    res.json({ 
      data: items, 
      total, 
      page, 
      limit,
      stats: kpiStats
    });
  } catch (error) {
    console.error('[ERROR] Fallo en la ruta GET /api/customers:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Ruta para obtener leads (compatibilidad con frontend que espera /api/leads)
app.get('/api/leads', async (req, res) => {
  try {
    console.log('[LOG] Petición recibida en GET /api/leads');

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limitReq = parseInt(req.query.limit || '200', 10);
    const limit = Math.max(Math.min(limitReq, 500), 1);
    const skip = (page - 1) * limit;

    const filtro = {};
    const agenteQuery = (req.query.agente || '').trim();

    if (agenteQuery) {
      const regexAgente = new RegExp(agenteQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtro.$or = [
        { agente: regexAgente },
        { AGENTE: regexAgente },
        { agenteNombre: regexAgente },
        { nombreAgente: regexAgente },
        { nombre_agente: regexAgente }
      ];
    }

    const [items, total] = await Promise.all([
      costumersCollection
        .find(filtro)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      costumersCollection.countDocuments(filtro)
    ]);

    console.log(`[LOG] Respuesta GET /api/leads -> ${items.length}/${total} registros (page=${page}, limit=${limit})`);

    res.json({
      success: true,
      data: items,
      total,
      page,
      limit
    });
  } catch (error) {
    console.error('[ERROR] Fallo en la ruta GET /api/leads:', error);
    res.status(500).json({ success: false, error: error.message || 'Error interno del servidor' });
  }
});

// Obtener datos para usuarios de Team Líneas
app.get('/api/lineas', async (req, res) => {
  try {
    console.log('[LOG] Petición recibida en GET /api/lineas (Team Líneas)');
    // Filtrar solo leads del equipo Jonathan/Team Líneas
    const lineasLeads = await costumersCollection.find({
      $or: [
        { supervisor: 'JONATHAN' },
        { supervisor: 'jonathan' },
        { supervisor: 'Team Jonathan' },
        { supervisor: 'TEAM JONATHAN' },
        { equipo: 'TEAM LINEAS' },
        { equipo: 'Team Lineas' }
      ]
    }).toArray();
    console.log(`[LOG] Consulta Team Líneas exitosa. Encontrados ${lineasLeads.length} leads.`);
    res.json(lineasLeads);
  } catch (error) {
    console.error('[ERROR] Fallo en la ruta GET /api/lineas:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Crear un nuevo lead (comentado temporalmente para desarrollo)
// app.post('/api/leads', ...)

// Obtener un lead por ID (comentado temporalmente para desarrollo)
// app.get('/api/leads/:id', ...)

// Eliminar un lead (comentado temporalmente para desarrollo)
// app.delete('/api/leads/:id', ...)


// Manejo de usuarios (simplificado para almacenamiento en memoria)
app.post('/api/register', (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios.' });
    }
    
    // Verificar si el usuario ya existe
    const existe = users.some(u => u.email === email);
    if (existe) {
      return res.status(400).json({ ok: false, error: 'Email ya registrado.' });
    }

    // Crear nuevo usuario (en un caso real, deberías hashear la contraseña)
    const newUser = {
      id: Date.now().toString(),
      nombre,
      email,
      password, // ¡En producción, esto debería estar hasheado!
      rol,
      createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    res.json({ ok: true, mensaje: 'Usuario registrado correctamente.' });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// Ruta para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));



// LISTAR TODOS LOS LEADS (SIN AUTENTICACIÓN - TEMPORAL)
// Ruta principal - manejo mejorado para evitar redirecciones
app.get('/', (req, res) => {
  // Verificar si ya está autenticado
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    // Si no hay token, redirigir al login
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
  
  // Verificar el token
  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) {
      // Token inválido o expirado, redirigir al login
      return res.status(200).json({ message: 'Acceso permitido' });
    }
    // Token válido, redirigir al dashboard
    res.status(200).json({ message: 'Acceso permitido' });
  });
});


// --- RUTA FINAL PARA SERVIR LA APP DE FRONTEND ---
// ¡¡¡IMPORTANTE!!! Esta debe ser la ÚLTIMA ruta para que no sobreescriba las de la API
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// La ruta del dashboard ahora está protegida
app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// La ruta raíz debe servir el dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Redirigir cualquier otra ruta no definida al dashboard para soportar rutas de cliente
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- MANEJADORES DE ERRORES (DEBEN IR AL FINAL) ---

// Manejo de errores 404
app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, '404.html')); // Opcional: servir una página 404 bonita
});

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error('Error en la aplicación:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});
