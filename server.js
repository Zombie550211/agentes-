const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
console.log('[INIT] DNS forzado a los servidores de Google para evitar problemas de red.');

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { ObjectId, GridFSBucket } = require('mongodb');
const { Server } = require('socket.io');
const { Readable } = require('stream');
require('dotenv').config();

// GridFS bucket para archivos
let gridFSBucket = null;
let userAvatarsBucket = null;

// Carga condicional de Helmet y Rate Limit (si están instalados)
let helmet = null;
let rateLimit = null;
try { 
  helmet = require('helmet'); 
  console.log('[INIT] Helmet cargado correctamente');
} catch (e) { 
  console.warn('[INIT] helmet no instalado, se recomienda instalarlo:', e.message); 
}
try { 
  rateLimit = require('express-rate-limit'); 
  console.log('[INIT] Rate limit cargado correctamente');
} catch (e) { 
  console.warn('[INIT] express-rate-limit no instalado, se recomienda instalarlo:', e.message); 
}
// Carga condicional de cookie-parser (para soportar JWT en cookies si se usa)
let cookieParser = null;
try { cookieParser = require('cookie-parser'); } catch { console.warn('[INIT] cookie-parser no instalado (opcional si usas JWT en header)'); }

// Importar configuración de base de datos
const { connectToMongoDB, getDb, getDbFor, closeConnection, isConnected } = require('./config/db');

// Middleware de autenticación unificado
const { protect, authorize } = require('./middleware/auth');

// Importar rutas
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const rankingRoutes = require('./routes/ranking');
const equipoRoutes = require('./routes/equipoRoutes');
let teamsRoutes = null;
const employeesOfMonthRoutes = require('./routes/employeesOfMonth');
const facturacionRoutes = require('./routes/facturacion');
let mediaProxy = null;
try {
  mediaProxy = require('./routes/mediaProxy');
} catch (e) {
  console.warn('[INIT] mediaProxy route not available:', e.message);
}
let debugRoutes = null;
try {
  debugRoutes = require('./routes/debug');
} catch (e) {
  console.warn('[INIT] debug route not available:', e.message);
}
let debugNoAuthRoutes = null;
try {
  debugNoAuthRoutes = require('./routes/debug_noauth');
} catch (e) {
  console.warn('[INIT] debug_noauth route not available:', e.message);
}
try {
  teamsRoutes = require('./routes/teams');
} catch (e) {
  console.warn('[INIT] teams route not available:', e.message);
}

// Configuración de JWT
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET no definido en variables de entorno. Usa un valor fuerte en producción.');
}
const JWT_EXPIRES_IN = '24h'; // El token expira en 24 horas

// Silenciar logs en producción (mantener warn/error)
if (process.env.NODE_ENV === 'production' && process.env.DEBUG_LOGS !== '1') {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// Inicializar Express app
const app = express();
// En Render SIEMPRE se debe escuchar en process.env.PORT. En local usamos 3000 por defecto.
const isRender = !!process.env.RENDER || /render/i.test(process.env.RENDER_EXTERNAL_URL || '');
const PORT = isRender ? Number(process.env.PORT) : (Number(process.env.PORT) || 3000);

// IMPORTANTE: Configurar límites de body PRIMERO, antes de cualquier otro middleware
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Variable para almacenar la referencia del servidor activo
let activeServer = null;
let io = null; // Socket.io instance

// Crear servidor HTTP para Socket.io
const httpServer = http.createServer(app);

// Health check (definido ANTES de static para evitar redirecciones del front)
app.get('/health', (req, res) => {
  const state = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const map = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({ ok: state === 1, mongo: map[state] || String(state) });
});

// Configuración de rutas de archivos estáticos
app.use('/images', express.static(path.join(__dirname, 'public', 'images'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }
}));

// Servir otros archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'agentes')));

// Servir archivos HTML
// Middleware: soportar peticiones con doble-encoding en la URL (p. ej. %2520)
// Esto detecta rutas que contienen '%25' (el caracter '%' codificado) y prueba
// a decodificarlas y servir el archivo correspondiente si existe en disco.
app.use((req, res, next) => {
  try {
    if (req.path && /%25|%20|%2[0-9A-Fa-f]/.test(req.path)) {
      // intentar decodificar varias veces para manejar %2520 -> %20 -> ' '
      let decoded = req.path;
      for (let i = 0; i < 5; i++) {
        try {
          const once = decodeURIComponent(decoded);
          if (once === decoded) break;
          decoded = once;
        } catch (e) {
          break;
        }
      }
      // normalizar y construir ruta de archivo
      const candidateRelative = decoded.replace(/^\/+/, '');
      const candidate = path.join(__dirname, candidateRelative);
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return res.sendFile(candidate);
      }
    }
  } catch (e) {
    // ignore and continue to next middleware
  }
  next();
});

app.use(express.static(__dirname, {
  extensions: ['html', 'htm'],
  index: false,
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// Middleware de debug: loguear todas las solicitudes a /api/* para depuración
app.use('/api', (req, res, next) => {
  try {
    console.log('[API DEBUG] Incoming request', { method: req.method, url: req.originalUrl, headersPreview: Object.fromEntries(Object.keys(req.headers).slice(0,6).map(k=>[k, req.headers[k]])) });
  } catch (e) { console.warn('[API DEBUG] Error logging request', e); }
  next();
});

// Montar ruta de teams (autenticada)
if (teamsRoutes) {
  app.use('/api/teams', teamsRoutes);
  console.log('[INIT] Ruta /api/teams montada');
}

// La conexión de Mongoose ahora es gestionada centralmente por config/db.js
// para permitir el fallback a una base de datos local y el modo offline.
// Se ha eliminado el bloque de conexión duplicado de este archivo.

// Configurar directorio para uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Cloudinary (SIEMPRE)
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const CLOUDINARY_HAS_CREDENTIALS = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
const CLOUDINARY_BG_REMOVAL_FLAG = String(process.env.CLOUDINARY_BG_REMOVAL || '').trim().toLowerCase();
const CLOUDINARY_BG_REMOVAL_ENABLED = CLOUDINARY_HAS_CREDENTIALS && CLOUDINARY_BG_REMOVAL_FLAG !== '0' && CLOUDINARY_BG_REMOVAL_FLAG !== 'false';
const CLOUDINARY_AVATAR_FOLDER = process.env.CLOUDINARY_AVATAR_FOLDER || 'dashboard/user-avatars';

if (CLOUDINARY_BG_REMOVAL_ENABLED) {
  console.log('[CLOUDINARY] Background removal habilitado para avatares (cloudinary_ai).');
} else if (CLOUDINARY_HAS_CREDENTIALS) {
  console.log('[CLOUDINARY] Background removal deshabilitado. Establece CLOUDINARY_BG_REMOVAL=1 para activarlo.');
} else {
  console.log('[CLOUDINARY] Credenciales no configuradas. Se omitirá el background removal.');
}

// Configuración de Multer para subida de archivos (diskStorage temporal antes de subir a Cloudinary)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generar nombre único: timestamp + nombre original
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, name + '-' + uniqueSuffix + ext);
  }
});

// Filtro de archivos permitidos
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'video/mp4', 'video/mov', 'video/avi', 'video/quicktime'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'), false);
  }
};
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Multer para archivos de notas (memoryStorage para subir a GridFS)
const noteFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/ogg', 'audio/webm',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido para notas'), false);
  }
};
const noteUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: noteFileFilter,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max para archivos de notas (audios grandes)
});

const avatarFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido para avatar'), false);
  }
};

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: avatarFileFilter,
  limits: { fileSize: 4 * 1024 * 1024 } // 4MB para avatares de usuario
});

// Helper para opciones de cookie dinámicas según request (soporte localhost:10000 en HTTP)
function cookieOptionsForReq(req, baseOpts) {
  const defaultOpts = baseOpts || {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  };
  const proto = (req.headers && req.headers['x-forwarded-proto']) || req.protocol;
  const isHttps = (proto === 'https') || req.secure;
  const host = (req.headers && req.headers.host) || '';
  const isLocal10000 = /localhost:10000$/i.test(host);
  if (isLocal10000 || !isHttps) {
    return { ...defaultOpts, secure: false, sameSite: 'lax' };
  }
  return defaultOpts;
}

// CORS endurecido con lista blanca desde .env (ALLOWED_ORIGINS) + orígenes conocidos
const parseAllowedOrigins = (raw) => (raw || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Lista blanca de orígenes permitidos
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const defaultAllowed = [
  'http://localhost:10000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:10000',
  'https://agentes-49dr.onrender.com',
  'https://agentes-frontend.onrender.com'
];

// Si estamos en producción, añadir el dominio de Render a la lista blanca
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const renderDomains = [
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_INSTANCE && `https://${process.env.RENDER_INSTANCE}.onrender.com`,
    'https://agentes-49dr.onrender.com'
  ].filter(Boolean);
  
  allowedOrigins.push(...renderDomains);
  console.log('[CORS] Orígenes permitidos en producción:', allowedOrigins);
}

const whitelist = [...new Set([...allowedOrigins, ...defaultAllowed])]; // Eliminar duplicados
console.log('[CORS] Lista blanca final:', whitelist);

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir solicitudes sin origen (navegación directa)
    if (!origin) return callback(null, true);

    // Permitir localhost y 127.0.0.1 en cualquier puerto (incluye 3001, 54056, etc.)
    const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\\d+)?$/i;
    if (localhostRegex.test(origin)) return callback(null, true);
    
    // En desarrollo, permitir cualquier origen localhost
    if (!isProduction && origin && origin.includes('localhost')) {
      return callback(null, true);
    }
    
    // En desarrollo, permitir cualquier origen 127.0.0.1
    if (!isProduction && origin && origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    // Permitir el mismo host del servidor (mismo origen)
    try {
      const serverHost = `http://localhost:${PORT}`;
      const serverHostHttps = `https://localhost:${PORT}`;
      if (origin === serverHost || origin === serverHostHttps) return callback(null, true);
    } catch {}

    // Permitir orígenes en whitelist explícita
    if (whitelist.includes(origin)) return callback(null, true);

    console.log(`[CORS] Origen no permitido: ${origin}`);
    callback(new Error('No permitido por CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Inicializar la conexión a la base de datos
let db;
// TTL para la cache del init-dashboard (ms). Por defecto 5 minutos
const INIT_DASHBOARD_TTL = Number(process.env.INIT_DASHBOARD_TTL_MS) || (5 * 60 * 1000);

// Estructura de cache en memoria para /api/init-dashboard
global.initDashboardCache = global.initDashboardCache || { data: null, updatedAt: 0 };
// Flag para evitar refrescos concurrentes
global.initDashboardCacheRefreshing = global.initDashboardCacheRefreshing || false;

// Función para refrescar la cache del init-dashboard en background.
// Calcula los KPIs del mes actual (modo administrador) y actualiza global.initDashboardCache.
async function refreshInitDashboardCache(_db) {
  // Evitar refrescos concurrentes
  if (global.initDashboardCacheRefreshing) {
    console.log('[INIT-DASHBOARD] Refresco ya en curso — omitiendo nueva invocación');
    return global.initDashboardCache.data;
  }
  global.initDashboardCacheRefreshing = true;
  try {
    if (!isConnected()) {
      console.warn('[INIT-DASHBOARD] DB no está conectada — omitiendo refresh');
      global.initDashboardCacheRefreshing = false;
      return;
    }
    const startTime = Date.now();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 1);

    const dateConditions = [
      { dia_venta: { $gte: monthStart, $lt: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lt: monthEnd } },
      { creadoEn: { $gte: monthStart, $lt: monthEnd } },
      { createdAt: { $gte: monthStart, $lt: monthEnd } },
      { fecha: { $gte: monthStart, $lt: monthEnd } }
    ];

    const filter = { $or: dateConditions };

    const projection = {
      _id: 1,
      agenteNombre: 1,
      agente: 1,
      usuario: 1,
      servicios: 1,
      puntaje: 1,
      status: 1,
      dia_venta: 1,
      creadoEn: 1,
      createdAt: 1,
      fecha_contratacion: 1,
      fecha: 1
    };

    if (!_db) _db = getDb();
    const leads = await _db.collection('costumers')
      .find(filter)
      .project(projection)
      .sort({ dia_venta: -1 })
      .limit(2000)
      .toArray();

    const kpis = {
      ventas: leads.length,
      puntos: leads.reduce((sum, lead) => sum + parseFloat(lead.puntaje || 0), 0),
      mayor_vendedor: '-',
      canceladas: leads.filter(l => (l.status || '').toLowerCase().includes('cancel')).length,
      pendientes: leads.filter(l => (l.status || '').toLowerCase().includes('pend')).length
    };

    if (leads.length > 0) {
      const agents = {};
      leads.forEach(l => {
        const agent = l.agenteNombre || l.agente || '-';
        agents[agent] = (agents[agent] || 0) + 1;
      });
      const top = Object.entries(agents).sort((a, b) => b[1] - a[1])[0];
      kpis.mayor_vendedor = top ? top[0] : '-';
    }

    const agentMap = {};
    const productMap = {};
    leads.forEach(lead => {
      const agent = lead.agenteNombre || lead.agente || 'Sin asignar';
      agentMap[agent] = (agentMap[agent] || 0) + 1;

      const services = Array.isArray(lead.servicios) ? lead.servicios : [lead.servicios];
      services.forEach(s => {
        if (s) productMap[s] = (productMap[s] || 0) + 1;
      });
    });

    const chartTeams = Object.entries(agentMap)
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const chartProductos = Object.entries(productMap)
      .map(([servicio, count]) => ({ servicio, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const elapsed = Date.now() - startTime;
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: { username: null, role: 'system', team: 'Global' },
      kpis,
      userStats: { ventasUsuario: kpis.ventas, puntosUsuario: kpis.puntos, equipoUsuario: 'Global' },
      chartTeams,
      chartProductos,
      isAdminOrBackoffice: true,
      monthYear: `${currentMonth + 1}/${currentYear}`
    };

    global.initDashboardCache.data = response;
    global.initDashboardCache.updatedAt = Date.now();
    if (global.broadcastDashboardUpdate) global.broadcastDashboardUpdate({ kpis, chartTeams, chartProductos, timestamp: response.timestamp });
    console.log(`[INIT-DASHBOARD] Cache refrescada correctamente (${elapsed}ms)`);
    return response;
  } catch (e) {
    console.warn('[INIT-DASHBOARD] Error refrescando cache:', e);
    throw e;
  } finally {
    global.initDashboardCacheRefreshing = false;
  }
}
(async () => {
  db = await connectToMongoDB(); // La lógica de error y fallback ya está dentro.
  if (isConnected()) {
    console.log('[SERVER] Conexión a base de datos establecida.');
    try {
      gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      console.log('[SERVER] GridFS inicializado correctamente.');
    } catch (e) {
      console.error('[SERVER] Error inicializando GridFS:', e.message);
    }
    try {
      userAvatarsBucket = new GridFSBucket(db, { bucketName: 'userAvatars' });
      console.log('[SERVER] GridFS para avatares inicializado correctamente.');
    } catch (e) {
      console.error('[SERVER] Error inicializando GridFS de avatares:', e.message);
    }
  } else {
    console.warn('[SERVER] Iniciando en modo OFFLINE. Las operaciones de base de datos fallarán.');
  }
})();

// Configuración de middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
if (cookieParser) {
  app.use(cookieParser());
}
// Helmet (si disponible)
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false
  }));
}
// Rate limiting (si disponible)
const makeLimiter = (opts) => rateLimit ? rateLimit.rateLimit(opts) : ((req, res, next) => next());
const authLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false });

// Crear registro para Team Lineas en colección dedicada "Lineas"
// Consultar registros de Team Lineas (con filtrado por agente)
app.get('/api/lineas', protect, async (req, res) => {
  try {
    // Asegurar conexión BD
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }
    if (!db) db = getDb();

    const user = req.user;
    const username = user?.username || '';
    const role = (user?.role || '').toLowerCase();

    // Determinar si es usuario privilegiado (puede ver todos los registros)
    const isPrivileged = ['Administrador', 'Backoffice', 'Supervisor', 'Supervisor Team Lineas'].includes(role);

    let filter = {};
    
    // Si no es privilegiado, filtrar por agente
    if (!isPrivileged) {
      filter = {
        $or: [
          { agente: username },
          { agenteNombre: username },
          { createdBy: username },
          { registeredBy: username }
        ]
      };
      console.log(`[GET /api/lineas] Filtro individual para ${username}:`, filter);
    } else {
      console.log(`[GET /api/lineas] Usuario privilegiado ${username}, sin filtros`);
    }

    // Consultar registros
    const registros = await db.collection('Lineas').find(filter).sort({ creadoEn: -1 }).toArray();
    
    console.log(`[GET /api/lineas] Encontrados ${registros.length} registros para ${username}`);
    
    return res.status(200).json({ 
      success: true, 
      data: registros,
      count: registros.length,
      user: username,
      filtered: !isPrivileged
    });

  } catch (error) {
    console.error('Error en GET /api/lineas:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error al consultar registros de Lineas', 
      error: error.message 
    });
  }
});

app.post('/api/lineas', protect, async (req, res) => {
  try {
    // Asegurar conexión BD
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }

    const body = req.body || {};
    const user = req.user;
    const username = user?.username || '';

    // Helpers de normalización
    const toUpper = (s) => (s == null ? '' : String(s).trim().toUpperCase());
    const digitsOnly = (s) => (s == null ? '' : String(s).replace(/\D+/g, ''));
    const asDate = (s) => {
      if (!s) return null;
      try {
        const str = String(s).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str);
        if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(str)) {
          const [d, m, y] = str.split(/[\/\-]/).map(Number);
          return new Date(y, m - 1, d);
        }
        const d = new Date(str);
        return isNaN(d) ? null : d;
      } catch { return null; }
    };

    // Validaciones mínimas obligatorias
    const errors = [];
    const requiredFields = ['nombre_cliente','telefono_principal','numero_cuenta','autopay','pin_seguridad','direccion','dia_venta','dia_instalacion','status','cantidad_lineas','id','mercado','supervisor'];
    for (const f of requiredFields) {
      if (body[f] == null || body[f] === '' || (Array.isArray(body[f]) && body[f].length === 0)) {
        errors.push(`Campo requerido faltante: ${f}`);
      }
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Validación fallida', errors });
    }

    // Coerciones/normalizaciones
    const cantidadLineas = Number(body.cantidad_lineas || 0);
    const telefonos = (Array.isArray(body.telefonos) ? body.telefonos : []).map(digitsOnly).filter(Boolean);
    const servicios = Array.isArray(body.servicios) ? body.servicios.map(String) : [];

    // Validaciones de dominio
    const autopayVal = String(body.autopay || '').toLowerCase();
    if (!['si','no'].includes(autopayVal)) errors.push('autopay debe ser si | no');
    const statusVal = String(body.status || '').toLowerCase();
    if (!['pending','repro'].includes(statusVal)) errors.push('status inválido (permitidos: pending, repro)');
    const mercado = String(body.mercado || '').toLowerCase();
    if (!['bamo','icon'].includes(mercado)) errors.push('mercado debe ser uno: bamo | icon');
    const supervisorVal = String(body.supervisor || '').toLowerCase();
    if (!['jonathan f', 'luis g'].includes(supervisorVal)) errors.push('supervisor inválido (permitidos: JONATHAN F, LUIS G)');
    if (!cantidadLineas || isNaN(cantidadLineas) || cantidadLineas < 1 || cantidadLineas > 5) errors.push('cantidad_lineas debe ser entre 1 y 5');
    if (telefonos.length !== cantidadLineas) errors.push('La cantidad de teléfonos debe coincidir con cantidad_lineas');
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Validación fallida', errors });
    }

    // --- Lógica de guardado dinámico ---
    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) {
        return res.status(503).json({ success: false, message: 'No se pudo acceder a la base de datos de Team Líneas.' });
    }

    // Determinar la colección de destino
    let targetAgent = username;
    if (user.role.toLowerCase().includes('supervisor') && body.agenteAsignado) {
        targetAgent = body.agenteAsignado;
    }
    const targetCollectionName = targetAgent.replace(/\s+/g, '_').toUpperCase();

    // Construir documento a insertar
    const now = new Date();
    const doc = {
      team: 'team lineas',
      nombre_cliente: toUpper(body.nombre_cliente),
      telefono_principal: digitsOnly(body.telefono_principal),
      numero_cuenta: String(body.numero_cuenta || '').trim(),
      autopay: autopayVal === 'si',
      pin_seguridad: String(body.pin_seguridad || '').trim(),
      direccion: String(body.direccion || '').trim(),
      servicios,
      dia_venta: asDate(body.dia_venta),
      dia_instalacion: asDate(body.dia_instalacion),
      status: statusVal.toUpperCase(),
      cantidad_lineas: cantidadLineas,
      telefonos,
      ID: String(body.id || '').trim(),
      mercado: mercado.toUpperCase(),
      supervisor: supervisorVal.toUpperCase(),
      agente: username, // Quien CREA el registro
      agenteAsignado: targetAgent, // A quien se le ASIGNA el registro
      creadoEn: now,
      actualizadoEn: now,
      _raw: body
    };

    const collection = teamLineasDb.collection(targetCollectionName);
    const result = await collection.insertOne(doc);

    return res.status(201).json({ 
        success: true, 
        message: `Formulario guardado en TEAM_LINEAS > ${targetCollectionName}`, 
        id: result.insertedId?.toString(), 
        data: doc 
    });

  } catch (error) {
    console.error('Error en POST /api/lineas:', error);
    return res.status(500).json({ success: false, message: 'Error al crear el registro de Lineas', error: error.message });
  }
});
const loginLimiter = makeLimiter({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

// Ruta protegida para Costumer.html (solo administradores) - DEBE IR ANTES de express.static
app.get('/Costumer.html', protect, (req, res) => {
  // Servir Costumer.html a cualquier usuario autenticado (visibilidad de datos se controla en los endpoints)
  return res.sendFile(path.join(__dirname, 'Costumer.html'));
});

// Ruta específica para el video
app.get('/videos/:filename', (req, res) => {
  const filename = req.params.filename;
  // Asegurarse de que la ruta sea correcta
  const videoPath = path.join(__dirname, 'public', 'images', filename);
  console.log('Buscando video en:', videoPath);
  console.log('El archivo existe?', fs.existsSync(videoPath) ? 'Sí' : 'No');
  
  // Verificar si el archivo existe
  if (fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunksize = (end - start) + 1
      const file = fs.createReadStream(videoPath, { start, end })
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      }
      res.writeHead(206, head)
      file.pipe(res)
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      }
      res.writeHead(200, head)
      fs.createReadStream(videoPath).pipe(res)
    }
  } else {
    res.status(404).send('Video no encontrado');
  }
});

// Servir archivos estáticos (EXCEPTO Costumer.html que ya está protegido)
app.use(express.static(__dirname, {
  extensions: ['html', 'htm'],
  index: false,  // Evitar que se sirva index.html automáticamente
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// Handle CORS preflight for all routes
app.options('*', cors(corsOptions));

// ========== ENDPOINTS GRIDFS PARA ARCHIVOS DE NOTAS ==========

// Subir archivo a GridFS
app.post('/api/files/upload', protect, noteUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se proporcionó archivo' });
    }
    
    if (!gridFSBucket) {
      if (db) {
        gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      } else {
        return res.status(503).json({ success: false, message: 'GridFS no disponible' });
      }
    }
    
    const { leadId } = req.body;
    const file = req.file;
    const filename = `${Date.now()}-${file.originalname}`;
    
    // Determinar tipo de archivo
    let fileType = 'document';
    if (file.mimetype.startsWith('image/')) fileType = 'image';
    else if (file.mimetype.startsWith('audio/')) fileType = 'audio';
    else if (file.mimetype.startsWith('video/')) fileType = 'video';
    else if (file.mimetype === 'application/pdf') fileType = 'pdf';
    
    // Crear stream de subida a GridFS
    const uploadStream = gridFSBucket.openUploadStream(filename, {
      contentType: file.mimetype,
      metadata: {
        leadId: leadId || null,
        uploadedBy: req.user?.username || 'unknown',
        uploadedAt: new Date(),
        originalName: file.originalname,
        fileType: fileType
      }
    });
    
    uploadStream.write(file.buffer);
    uploadStream.end();
    
    await new Promise((resolve, reject) => {
      uploadStream.on('finish', resolve);
      uploadStream.on('error', reject);
    });
    
    const fileId = uploadStream.id.toString();
    console.log('[GridFS] Archivo subido:', filename, 'ID:', fileId);
    
    return res.json({
      success: true,
      data: {
        fileId: fileId,
        filename: filename,
        originalName: file.originalname,
        contentType: file.mimetype,
        fileType: fileType,
        size: file.size,
        url: `/api/files/${fileId}`
      }
    });
  } catch (error) {
    console.error('[GridFS] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al subir archivo', error: error.message });
  }
});

// Obtener archivo de GridFS (con soporte para streaming de audio/video)
app.get('/api/files/:id', async (req, res) => {
  try {
    const fileId = req.params.id;
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    
    let objectId;
    try { objectId = new ObjectId(fileId); } catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }
    
    const fileDoc = await db.collection('noteFiles.files').findOne({ _id: objectId });
    if (!fileDoc) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
    
    const fileSize = fileDoc.length;
    const contentType = fileDoc.contentType || 'application/octet-stream';
    const range = req.headers.range;
    
    // Soporte para Range requests (streaming de audio/video)
    if (range && (contentType.startsWith('audio/') || contentType.startsWith('video/'))) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      
      const downloadStream = gridFSBucket.openDownloadStream(objectId, { start, end: end + 1 });
      downloadStream.pipe(res);
    } else {
      res.set('Content-Type', contentType);
      res.set('Content-Length', fileSize);
      res.set('Accept-Ranges', 'bytes');
      res.set('Content-Disposition', `inline; filename="${fileDoc.filename}"`);
      
      const downloadStream = gridFSBucket.openDownloadStream(objectId);
      downloadStream.pipe(res);
    }
  } catch (error) {
    console.error('[GridFS GET] Error:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Error', error: error.message });
  }
});

// Descargar archivo de GridFS (forzar descarga)
app.get('/api/files/:id/download', async (req, res) => {
  try {
    const fileId = req.params.id;
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    
    let objectId;
    try { objectId = new ObjectId(fileId); } catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }
    
    const fileDoc = await db.collection('noteFiles.files').findOne({ _id: objectId });
    if (!fileDoc) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
    
    const originalName = fileDoc.metadata?.originalName || fileDoc.filename;
    res.set('Content-Type', fileDoc.contentType || 'application/octet-stream');
    res.set('Content-Length', fileDoc.length);
    res.set('Content-Disposition', `attachment; filename="${originalName}"`);
    
    const downloadStream = gridFSBucket.openDownloadStream(objectId);
    downloadStream.pipe(res);
  } catch (error) {
    console.error('[GridFS DOWNLOAD] Error:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Error', error: error.message });
  }
});

// Eliminar archivo de GridFS
app.delete('/api/files/:id', protect, async (req, res) => {
  try {
    const fileId = req.params.id;
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    let objectId;
    try { objectId = new ObjectId(fileId); } catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }
    await gridFSBucket.delete(objectId);
    return res.json({ success: true, message: 'Archivo eliminado' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error', error: error.message });
  }
}); // Cerrar correctamente el app.delete

// ========== ENDPOINTS GRIDFS PARA AVATARES DE USUARIO ==========

async function ensureUserAvatarBucket() {
  if (userAvatarsBucket) return userAvatarsBucket;
  if (!db) db = getDb();
  if (!db) throw new Error('GridFS no disponible');
  userAvatarsBucket = new GridFSBucket(db, { bucketName: 'userAvatars' });
  return userAvatarsBucket;
}

const IMAGE_MIME_EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function inferImageExtension(mimetype, fallback = 'png') {
  if (!mimetype) return fallback;
  const ext = IMAGE_MIME_EXTENSION_MAP[mimetype.toLowerCase()];
  return ext || fallback;
}

function bufferToStream(buffer) {
  return new Readable({
    read() {
      this.push(buffer);
      this.push(null);
    }
  });
}

function downloadBufferFromUrl(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    try {
      const target = url.startsWith('//') ? `https:${url}` : url;
      const parsed = new URL(target);
      const client = parsed.protocol === 'https:' ? https : http;
      const request = client.get({
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        protocol: parsed.protocol,
        headers: {
          'User-Agent': 'agentes-dashboard-avatar/1.0',
          Accept: 'image/*,*/*;q=0.8'
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const nextUrl = new URL(res.headers.location, target).toString();
          res.resume();
          return resolve(downloadBufferFromUrl(nextUrl, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} al descargar recurso (${target})`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      request.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function processAvatarWithCloudinary(inputBuffer, options = {}) {
  if (!Buffer.isBuffer(inputBuffer)) {
    throw new Error('Buffer de avatar inválido');
  }

  const { originalName = '', mimetype = 'image/png', username = '' } = options;
  const details = {
    backgroundRemoved: false,
    processor: CLOUDINARY_BG_REMOVAL_ENABLED ? 'cloudinary_ai' : null,
    bytesBefore: inputBuffer.length
  };

  if (!CLOUDINARY_BG_REMOVAL_ENABLED) {
    details.bytesAfter = inputBuffer.length;
    return {
      buffer: inputBuffer,
      contentType: mimetype || 'image/png',
      extension: inferImageExtension(mimetype, 'png'),
      details
    };
  }

  const startedAt = Date.now();

  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadOptions = {
        resource_type: 'image',
        folder: CLOUDINARY_AVATAR_FOLDER,
        background_removal: 'cloudinary_ai',
        overwrite: true,
        format: 'png',
        use_filename: false,
        unique_filename: true,
        transformation: [{ width: 800, height: 800, crop: 'limit' }]
      };

      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      });

      bufferToStream(inputBuffer).pipe(uploadStream);
    });

    const processedUrl = uploadResult?.secure_url || cloudinary.url(uploadResult.public_id, {
      secure: true,
      format: 'png'
    });

    const processedBuffer = await downloadBufferFromUrl(processedUrl);

    details.backgroundRemoved = true;
    details.processor = 'cloudinary_ai';
    details.bytesAfter = processedBuffer.length;
    details.processingMs = Date.now() - startedAt;
    details.cloudinaryPublicId = uploadResult?.public_id || null;
    details.cloudinaryAssetId = uploadResult?.asset_id || null;
    details.cloudinaryVersion = uploadResult?.version || null;
    details.secureUrl = processedUrl;
    details.uploadedAt = uploadResult?.created_at ? new Date(uploadResult.created_at) : new Date();

    return {
      buffer: processedBuffer,
      contentType: 'image/png',
      extension: 'png',
      details
    };
  } catch (error) {
    details.processingError = error?.message || String(error);
    details.bytesAfter = inputBuffer.length;
    console.warn('[Avatar Upload] No se pudo procesar el avatar con Cloudinary:', details.processingError, { username, originalName });
    return {
      buffer: inputBuffer,
      contentType: mimetype || 'image/png',
      extension: inferImageExtension(mimetype, 'png'),
      details
    };
  }
}

app.post('/api/users/me/avatar', protect, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.user || !req.user.username) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se proporcionó archivo' });
    }

    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible para guardar el avatar' });
    }

    if (!db) db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const bucket = await ensureUserAvatarBucket();
    const usersCol = db.collection('users');

    const existingUser = await usersCol.findOne(
      { username: req.user.username },
      { projection: { avatarFileId: 1, avatarCloudinaryPublicId: 1 } }
    );

    const sanitizedNameRaw = req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'avatar.png';
    const baseName = path.basename(sanitizedNameRaw, path.extname(sanitizedNameRaw)) || 'avatar';

    const processing = await processAvatarWithCloudinary(req.file.buffer, {
      originalName: sanitizedNameRaw,
      mimetype: req.file.mimetype,
      username: req.user.username
    });

    const finalExtension = processing.extension || inferImageExtension(req.file.mimetype, 'png');
    const finalFilename = `${Date.now()}-${baseName}.${finalExtension}`;

    const metadataRaw = {
      userId: req.user.id ? req.user.id.toString() : null,
      username: req.user.username,
      uploadedAt: new Date(),
      originalName: req.file.originalname,
      originalMimeType: req.file.mimetype,
      sanitizedFilename: sanitizedNameRaw,
      backgroundRemoved: Boolean(processing.details?.backgroundRemoved),
      backgroundProcessor: processing.details?.processor || null,
      cloudinaryPublicId: processing.details?.cloudinaryPublicId || null,
      cloudinaryAssetId: processing.details?.cloudinaryAssetId || null,
      cloudinaryVersion: processing.details?.cloudinaryVersion || null,
      cloudinarySecureUrl: processing.details?.secureUrl || null,
      bytesOriginal: processing.details?.bytesBefore ?? req.file.size ?? (req.file.buffer ? req.file.buffer.length : null),
      bytesProcessed: processing.details?.bytesAfter ?? null,
      processingMs: processing.details?.processingMs ?? null,
      processingError: processing.details?.processingError || null
    };
    const metadata = Object.fromEntries(
      Object.entries(metadataRaw).filter(([, value]) => value !== undefined)
    );

    const uploadStream = bucket.openUploadStream(finalFilename, {
      contentType: processing.contentType,
      metadata
    });

    uploadStream.end(processing.buffer);

    await new Promise((resolve, reject) => {
      uploadStream.on('finish', resolve);
      uploadStream.on('error', reject);
    });

    const fileId = uploadStream.id.toString();
    const avatarUrl = `/api/user-avatars/${fileId}`;

    const setPayload = {
      avatarFileId: fileId,
      avatarUrl,
      avatarUpdatedAt: new Date(),
      avatarBackgroundRemoved: Boolean(processing.details?.backgroundRemoved)
    };

    const unsetPayload = {};

    if (processing.details?.backgroundRemoved && processing.details?.processor) {
      setPayload.avatarProcessor = processing.details.processor;
    } else {
      unsetPayload.avatarProcessor = '';
    }

    if (processing.details?.cloudinaryPublicId) {
      setPayload.avatarCloudinaryPublicId = processing.details.cloudinaryPublicId;
      if (processing.details?.cloudinaryVersion != null) {
        setPayload.avatarCloudinaryVersion = processing.details.cloudinaryVersion;
      } else {
        unsetPayload.avatarCloudinaryVersion = '';
      }
    } else {
      unsetPayload.avatarCloudinaryPublicId = '';
      unsetPayload.avatarCloudinaryVersion = '';
    }

    const updateDoc = { $set: setPayload };
    if (Object.keys(unsetPayload).length > 0) {
      updateDoc.$unset = unsetPayload;
    }

    await usersCol.updateOne(
      { username: req.user.username },
      updateDoc
    );

    if (existingUser && existingUser.avatarFileId && existingUser.avatarFileId !== fileId) {
      try {
        const oldId = new ObjectId(existingUser.avatarFileId);
        await bucket.delete(oldId);
      } catch (e) {
        console.warn('[Avatar Upload] No se pudo eliminar el avatar anterior:', e?.message || e);
      }
    }

    if (
      existingUser &&
      existingUser.avatarCloudinaryPublicId &&
      existingUser.avatarCloudinaryPublicId !== (processing.details?.cloudinaryPublicId || null) &&
      CLOUDINARY_HAS_CREDENTIALS
    ) {
      try {
        await cloudinary.uploader.destroy(existingUser.avatarCloudinaryPublicId, { invalidate: true });
      } catch (e) {
        console.warn('[Avatar Upload] No se pudo eliminar el avatar anterior en Cloudinary:', e?.message || e);
      }
    }

    return res.json({
      success: true,
      message: 'Avatar actualizado correctamente',
      data: {
        url: avatarUrl,
        fileId,
        backgroundRemoved: Boolean(processing.details?.backgroundRemoved)
      }
    });
  } catch (error) {
    console.error('[Avatar Upload] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar el avatar', error: error.message });
  }
});

app.get('/api/user-avatars/:id', async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const bucket = await ensureUserAvatarBucket();
    const fileId = req.params.id;
    let objectId;
    try {
      objectId = new ObjectId(fileId);
    } catch {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    const filesCollection = db.collection('userAvatars.files');
    const fileDoc = await filesCollection.findOne({ _id: objectId });
    if (!fileDoc) {
      // Si no existe el avatar en GridFS, intentar devolver una imagen por defecto en vez de 404
      try {
        const defaultPath = path.join(__dirname, 'images', 'avatar.png');
        if (fs.existsSync(defaultPath)) {
          res.type('png');
          res.set('Cache-Control', 'public, max-age=86400');
          return res.sendFile(defaultPath);
        }
      } catch (e) {
        // si falla, caer al response inline fallback (SVG)
      }
      // fallback: generar un svg simple que evite 404 en el cliente
      try {
        const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="100%" height="100%" fill="#e2e8f0"/><circle cx="60" cy="45" r="26" fill="#f8fafc"/><rect x="15" y="80" width="90" height="22" rx="10" fill="#f8fafc"/></svg>`;
        res.type('image/svg+xml');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(svg);
      } catch (e) {
        // último recurso: devolver 404 JSON
        return res.status(404).json({ success: false, message: 'Avatar no encontrado' });
      }
    }

    res.set('Content-Type', fileDoc.contentType || 'image/png');
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Accept-Ranges', 'bytes');

    const downloadStream = bucket.openDownloadStream(objectId);
    downloadStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error al leer el avatar', error: err.message });
      }
    });
    downloadStream.pipe(res);
  } catch (error) {
    console.error('[Avatar Fetch] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Error interno', error: error.message });
    }
  }
});

app.delete('/api/users/me/avatar', protect, async (req, res) => {
  try {
    if (!req.user || !req.user.username) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }

    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    if (!db) db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const bucket = await ensureUserAvatarBucket();
    const usersCol = db.collection('users');
    const user = await usersCol.findOne(
      { username: req.user.username },
      { projection: { avatarFileId: 1 } }
    );

    if (!user || !user.avatarFileId) {
      return res.json({ success: true, message: 'No había avatar para eliminar', data: { url: null } });
    }

    try {
      const objectId = new ObjectId(user.avatarFileId);
      await bucket.delete(objectId);
    } catch (error) {
      console.warn('[Avatar Delete] No se pudo eliminar el archivo:', error?.message || error);
    }

    await usersCol.updateOne(
      { username: req.user.username },
      { $unset: { avatarFileId: '', avatarUrl: '', avatarUpdatedAt: '' } }
    );

    return res.json({ success: true, message: 'Avatar eliminado correctamente', data: { url: null } });
  } catch (error) {
    console.error('[Avatar Delete] Error:', error);
    return res.status(500).json({ success: false, message: 'Error al eliminar el avatar', error: error.message });
  }
});

// ========== FIN ENDPOINTS GRIDFS ==========

// Montar rutas de API (rutas específicas ANTES de la genérica /api)
app.use('/api/auth', authRoutes);
app.use('/api/facturacion', facturacionRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/equipos', equipoRoutes);
app.use('/api/employees-of-month', employeesOfMonthRoutes);
app.use('/api', apiRoutes); // Esta debe ir AL FINAL porque es la más genérica
// Proxy para recursos de Cloudinary (evita problemas con Tracking Prevention en clientes)
if (mediaProxy) app.use('/media/proxy', mediaProxy);
// Debug routes (solo lectura) para diagnóstico
if (debugRoutes) app.use('/api/debug', debugRoutes);
// Ruta temporal NO autenticada para debug local (solo si no estamos en producción)
if (debugNoAuthRoutes && process.env.NODE_ENV !== 'production') {
  app.use('/api/debug-noauth', debugNoAuthRoutes);
  console.log('[SERVER] Ruta temporal /api/debug-noauth montada (solo NO production)');
}
// Migrate routes (solo admins) para migración de datos
try {
  const migrateRoutes = require('./routes/migrate');
  app.use('/api/migrate', migrateRoutes);
  console.log('[SERVER] Rutas de migración cargadas');
} catch (e) {
  console.warn('[SERVER] No se pudieron cargar rutas de migración:', e?.message);
}

// Middleware inline (authenticateJWT) queda reemplazado por middleware/auth.js (protect)
// Wrapper mínimo por compatibilidad con referencias existentes
const authenticateJWT = (req, res, next) => protect(req, res, next);

// ... (rest of the code remains the same)
// Favicon handler: servir un icono por defecto para evitar 404
app.get('/favicon.ico', (req, res) => {
  try {
    const iconPathPng = path.join(__dirname, 'images', 'avatar.png');
    if (fs.existsSync(iconPathPng)) {
      res.type('png');
      return res.sendFile(iconPathPng);
    }
  } catch {}
  // Fallback vacío para no loguear 404
  res.status(204).end();
});

// Ruta protegida de ejemplo (requiere autenticación)
app.get('/api/protected', protect, (req, res) => {
  res.json({ message: 'Ruta protegida', user: req.user });
});

// Endpoint para verificar autenticación desde el servidor (sin protección)
app.get('/api/auth/verify-server', async (req, res) => {
  // Verificar si hay token en cookies
  const token = req.cookies?.token;

  if (!token) {
    return res.json({
      success: false,
      message: 'No se encontró token',
      authenticated: false,
      role: null,
      username: null
    });
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!db) db = getDb();
    let userDoc = null;
    if (db) {
      try {
        userDoc = await db.collection('users').findOne(
          { username: decoded.username },
          { projection: { password: 0 } }
        );
      } catch (e) {
        console.warn('[verify-server] No se pudo obtener usuario:', e?.message || e);
      }
    }

    const userPayload = userDoc ? {
      id: userDoc._id ? userDoc._id.toString() : decoded.id,
      username: userDoc.username,
      role: userDoc.role,
      email: userDoc.email || null,
      team: userDoc.team || null,
      permissions: userDoc.permissions || decoded.permissions,
      avatarUrl: userDoc.avatarUrl || null,
      avatarFileId: userDoc.avatarFileId || null,
      avatarUpdatedAt: userDoc.avatarUpdatedAt || null
    } : {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      email: decoded.email || null,
      team: decoded.team || null,
      permissions: decoded.permissions,
      avatarUrl: null,
      avatarFileId: null,
      avatarUpdatedAt: null
    };

    res.json({
      success: true,
      message: 'Token válido',
      authenticated: true,
      user: userPayload
    });
  } catch (error) {
    res.json({
      success: false,
      message: 'Token inválido',
      authenticated: false,
      role: null,
      username: null,
      error: error.message
    });
  } // Fin del try/catch para /api/auth/verify-server
});

// ========== ENDPOINT INIT-DASHBOARD ==========
// Carga todos los datos del dashboard en una sola petición (solución optimizada)
// OPTIMIZADO: Endpoint ultra-rápido para cargar solo datos esenciales del dashboard
app.get('/api/init-dashboard', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();
    const isAdminOrBackoffice = ['admin', 'administrator', 'administrador', 'administradora', 'backoffice', 'bo', 'supervisor'].some(r => userRole.includes(r));

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 1);

    console.log(`[INIT-DASHBOARD] ⚡ Inicio para ${username} (${userRole})`);

    // Return cached response immediately when available (fast path)
    try {
      const cached = global.initDashboardCache && global.initDashboardCache.data;
      const updatedAt = global.initDashboardCache && global.initDashboardCache.updatedAt;
      if (cached) {
        const age = Date.now() - (updatedAt || 0);
        if (age < INIT_DASHBOARD_TTL) {
          console.log(`[INIT-DASHBOARD] Devolviendo cache (age ${age}ms)`);
          return res.json(cached);
        }
        // Si la cache existe pero está stale, devolvemos la cache STALE de inmediato
        console.log(`[INIT-DASHBOARD] Devolviendo cache STALE (age ${age}ms) y refrescando en background`);
        res.json(cached);
        // refrescar en background sin bloquear la respuesta
        (async () => {
          try { await refreshInitDashboardCache(); } catch (e) { console.warn('[INIT-DASHBOARD] background refresh failed', e); }
        })();
        return;
      }
    } catch (e) {
      console.warn('[INIT-DASHBOARD] Error leyendo cache:', e);
    }

    // OPTIMIZACIÓN: Buscar por múltiples campos de fecha del mes actual
    // Algunos registros usan 'dia_venta', otros 'fecha_contratacion', 'creadoEn', 'createdAt' o 'fecha'
    const dateConditions = [
      { dia_venta: { $gte: monthStart, $lt: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lt: monthEnd } },
      { creadoEn: { $gte: monthStart, $lt: monthEnd } },
      { createdAt: { $gte: monthStart, $lt: monthEnd } },
      { fecha: { $gte: monthStart, $lt: monthEnd } }
    ];

    let filter;
    if (isAdminOrBackoffice) {
      filter = { $or: dateConditions };
    } else {
      const userMatch = { $or: [ { agenteNombre: username }, { agente: username }, { usuario: username } ] };
      filter = { $and: [ { $or: dateConditions }, userMatch ] };
    }

    // Usar projection para traer SOLO los campos necesarios
    const projection = {
      _id: 1,
      agenteNombre: 1,
      agente: 1,
      usuario: 1,
      servicios: 1,
      puntaje: 1,
      status: 1,
      dia_venta: 1,
      creadoEn: 1,
      createdAt: 1,
      fecha_contratacion: 1,
      fecha: 1
    };

    // Una sola query optimizada
    const leads = await db.collection('costumers')
      .find(filter)
      .project(projection)
      .sort({ dia_venta: -1 })
      .limit(2000)  // Reducido a 2000 del mes actual (no 10,000 históricos)
      .toArray();

    console.log(`[INIT-DASHBOARD] 📊 Registros obtenidos: ${leads.length}`);

    // CÁLCULOS RÁPIDOS (datos ya filtrados por mes)
    const kpis = {
      ventas: leads.length,
      puntos: leads.reduce((sum, lead) => sum + parseFloat(lead.puntaje || 0), 0),
      mayor_vendedor: '-',
      canceladas: leads.filter(l => (l.status || '').toLowerCase().includes('cancel')).length,
      pendientes: leads.filter(l => (l.status || '').toLowerCase().includes('pend')).length
    };

    // Mejor vendedor rápido (solo si admin)
    if (isAdminOrBackoffice && leads.length > 0) {
      const agents = {};
      leads.forEach(l => {
        const agent = l.agenteNombre || l.agente || '-';
        agents[agent] = (agents[agent] || 0) + 1;
      });
      const top = Object.entries(agents).sort((a, b) => b[1] - a[1])[0];
      kpis.mayor_vendedor = top ? top[0] : '-';
    }

    // Gráficos rápidos (top 5)
    const agentMap = {};
    const productMap = {};
    leads.forEach(lead => {
      const agent = lead.agenteNombre || lead.agente || 'Sin asignar';
      agentMap[agent] = (agentMap[agent] || 0) + 1;

      const services = Array.isArray(lead.servicios) ? lead.servicios : [lead.servicios];
      services.forEach(s => {
        if (s) productMap[s] = (productMap[s] || 0) + 1;
      });
    });

    const chartTeams = Object.entries(agentMap)
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const chartProductos = Object.entries(productMap)
      .map(([servicio, count]) => ({ servicio, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-DASHBOARD] ✅ Completado en ${elapsed}ms`);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: {
        username: user?.username,
        role: user?.role,
        team: user?.team || 'Sin equipo'
      },
      kpis: kpis,
      userStats: {
        ventasUsuario: kpis.ventas,
        puntosUsuario: kpis.puntos,
        equipoUsuario: user?.team || 'Sin equipo'
      },
      chartTeams: chartTeams,
      chartProductos: chartProductos,
      isAdminOrBackoffice: isAdminOrBackoffice,
      monthYear: `${currentMonth + 1}/${currentYear}`
    };

    // Guardar en cache y notificar
    try {
      global.initDashboardCache.data = response;
      global.initDashboardCache.updatedAt = Date.now();
      if (global.broadcastDashboardUpdate) global.broadcastDashboardUpdate({ kpis, chartTeams, chartProductos, timestamp: response.timestamp });
    } catch (e) {
      console.warn('[INIT-DASHBOARD] Error guardando cache:', e);
    }

    res.json(response);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-DASHBOARD] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos del dashboard',
      error: error.message
    });
  }
});

// Pre-calentar datos de TODAS las páginas del mes actual para carga instantánea post-login
// Retorna: dashboard, customers, leads, rankings, estadísticas (solo mes actual)
app.get('/api/init-all-pages', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    console.log(`[INIT-ALL-PAGES] ⚡ Inicio para ${username} (${userRole})`);

    // Filtro de fecha para el mes actual
    const dateConditions = [
      { dia_venta: { $gte: monthStart, $lte: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } },
      { creadoEn: { $gte: monthStart, $lte: monthEnd } },
      { createdAt: { $gte: monthStart, $lte: monthEnd } },
      { fecha: { $gte: monthStart, $lte: monthEnd } }
    ];

    // 1. DASHBOARD DATA (KPIs)
    let dashboardData = null;
    try {
      dashboardData = global.initDashboardCache?.data || null;
    } catch (e) {
      console.warn('[INIT-ALL-PAGES] Error fetching dashboard cache:', e?.message);
    }

    // 2. CUSTOMERS para Costumer.html (primeros 200 del mes actual, proyección ligera)
    let customers = [];
    try {
      const custColl = db.collection('costumers');
      const custFilter = { $or: dateConditions };
      customers = await custColl.find(custFilter)
        .project({
          _id: 1,
          nombre_cliente: 1,
          status: 1,
          telefono_principal: 1,
          numero_cuenta: 1,
          agente: 1,
          agenteNombre: 1,
          supervisor: 1,
          dia_venta: 1,
          dia_instalacion: 1,
          autopago: 1,
          pin_seguridad: 1,
          direccion: 1,
          telefonos: 1,
          cantidad_lineas: 1,
          servicios: 1,
          servicios_texto: 1,
          producto: 1,
          mercado: 1
        })
        .limit(200)
        .toArray();
      console.log(`[INIT-ALL-PAGES] Customers del mes: ${customers.length}`);
    } catch (e) {
      console.warn('[INIT-ALL-PAGES] Error fetching customers:', e?.message);
    }

    // 3. LEADS para estadísticas (primeros 100 del mes actual)
    let leads = [];
    try {
      const leadsColl = db.collection('leads');
      const leadFilter = { $or: dateConditions };
      leads = await leadsColl.find(leadFilter)
        .project({
          _id: 1,
          nombre: 1,
          status: 1,
          fecha: 1,
          agente: 1,
          agenteNombre: 1,
          puntaje: 1,
          servicios: 1,
          empresa: 1
        })
        .limit(100)
        .toArray();
      console.log(`[INIT-ALL-PAGES] Leads del mes: ${leads.length}`);
    } catch (e) {
      console.warn('[INIT-ALL-PAGES] Error fetching leads:', e?.message);
    }

    // 4. RANKINGS (top 30)
    let rankings = [];
    try {
      const rankColl = db.collection('rankings');
      rankings = await rankColl.find({})
        .project({
          _id: 1,
          agente: 1,
          agenteNombre: 1,
          puntaje: 1,
          posicion: 1,
          ventas: 1,
          mes: 1
        })
        .limit(30)
        .toArray();
      console.log(`[INIT-ALL-PAGES] Rankings: ${rankings.length}`);
    } catch (e) {
      console.warn('[INIT-ALL-PAGES] Error fetching rankings:', e?.message);
    }

    // 5. ESTADÍSTICAS agregadas por equipo (mes actual)
    let statsAgg = {};
    try {
      const statsColl = db.collection('estadisticas');
      const statsFilter = { $or: dateConditions };
      const agg = await statsColl.aggregate([
        { $match: statsFilter },
        { $group: {
          _id: '$equipo',
          totalLeads: { $sum: 1 },
          totalVentas: { $sum: { $cond: [{ $eq: ['$status', 'Completado'] }, 1, 0] } },
          promedio: { $avg: '$puntaje' }
        }},
        { $sort: { totalLeads: -1 } },
        { $limit: 15 }
      ]).toArray();
      agg.forEach(s => {
        statsAgg[s._id || 'general'] = {
          totalLeads: s.totalLeads,
          totalVentas: s.totalVentas,
          promedio: Math.round(s.promedio || 0)
        };
      });
      console.log(`[INIT-ALL-PAGES] Stats equipos: ${Object.keys(statsAgg).length}`);
    } catch (e) {
      console.warn('[INIT-ALL-PAGES] Error fetching stats:', e?.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-ALL-PAGES] ✅ Completado en ${elapsed}ms`);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: {
        username: user?.username,
        role: user?.role,
        team: user?.team || 'Sin equipo'
      },
      data: {
        dashboard: dashboardData,
        customers: customers,
        leads: leads,
        rankings: rankings,
        stats: statsAgg,
        monthYear: `${currentMonth + 1}/${currentYear}`,
        note: 'Solo datos del mes actual. Para otros meses, filtrar en la página.'
      },
      ttl: 5 * 60 * 1000  // válido por 5 minutos
    };

    res.json(response);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-ALL-PAGES] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos de páginas',
      error: error.message
    });
  }
});

// Endpoint específico para precalentamiento de Estadísticas
app.get('/api/init-estadisticas', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    console.log(`[INIT-ESTADISTICAS] ⚡ Inicio para ${username} (${userRole})`);

    const dateConditions = [
      { dia_venta: { $gte: monthStart, $lte: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } },
      { creadoEn: { $gte: monthStart, $lte: monthEnd } },
      { createdAt: { $gte: monthStart, $lte: monthEnd } },
      { fecha: { $gte: monthStart, $lte: monthEnd } }
    ];

    // 1. Datos de equipos (para gráfico de porcentaje/estadísticas por equipo)
    let teamsData = [];
    try {
      const statsColl = db.collection('estadisticas');
      const statsFilter = { $or: dateConditions };
      const agg = await statsColl.aggregate([
        { $match: statsFilter },
        { $group: {
          _id: '$equipo',
          totalLeads: { $sum: 1 },
          totalVentas: { $sum: { $cond: [{ $eq: ['$status', 'Completado'] }, 1, 0] } },
          promedio: { $avg: '$puntaje' },
          ACTIVAS: { $sum: { $cond: [{ $eq: ['$status', 'Activa'] }, 1, 0] } }
        }},
        { $sort: { totalLeads: -1 } },
        { $limit: 20 }
      ]).toArray();
      teamsData = agg.map(s => ({
        name: s._id || 'Sin equipo',
        equipo: s._id || 'Sin equipo',
        Total: s.totalLeads,
        totalVentas: s.totalVentas,
        Puntaje: Math.round(s.promedio || 0),
        ACTIVAS: s.ACTIVAS,
        porcentaje: 0 // se calcula en el front
      }));
      console.log(`[INIT-ESTADISTICAS] Teams datos: ${teamsData.length}`);
    } catch (e) {
      console.warn('[INIT-ESTADISTICAS] Error fetching teams:', e?.message);
    }

    // 2. Agentes con estadísticas (para conversion table y rankings)
    let agentsData = [];
    try {
      const costumersColl = db.collection('costumers');
      const custFilter = { $or: dateConditions };
      const agg = await costumersColl.aggregate([
        { $match: custFilter },
        { $group: {
          _id: '$agenteNombre',
          totalClientes: { $sum: 1 },
          agente: { $first: '$agente' },
          supervisor: { $first: '$supervisor' }
        }},
        { $sort: { totalClientes: -1 } },
        { $limit: 30 }
      ]).toArray();
      agentsData = agg.map(a => ({
        nombre: a._id || 'Sin asignar',
        agente: a.agente || '',
        totalClientes: a.totalClientes,
        supervisor: a.supervisor || ''
      }));
      console.log(`[INIT-ESTADISTICAS] Agents datos: ${agentsData.length}`);
    } catch (e) {
      console.warn('[INIT-ESTADISTICAS] Error fetching agents:', e?.message);
    }

    // 3. Datos de leads para gráficos de ventas (últimos 60 días)
    let leadsChartData = [];
    try {
      const leadsColl = db.collection('leads');
      const pastDays = 60;
      const dateFrom = new Date(now);
      dateFrom.setDate(dateFrom.getDate() - pastDays);
      const leadsFilter = { fecha: { $gte: dateFrom, $lte: now } };
      
      const leadsAgg = await leadsColl.aggregate([
        { $match: leadsFilter },
        { $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$fecha', timezone: 'America/Costa_Rica' }
          },
          count: { $sum: 1 },
          completados: { $sum: { $cond: [{ $eq: ['$status', 'Completado'] }, 1, 0] } }
        }},
        { $sort: { _id: 1 } },
        { $limit: 60 }
      ]).toArray();
      
      leadsChartData = leadsAgg.map(l => ({
        fecha: l._id,
        count: l.count,
        completados: l.completados || 0
      }));
      console.log(`[INIT-ESTADISTICAS] Leads chart data: ${leadsChartData.length} days`);
    } catch (e) {
      console.warn('[INIT-ESTADISTICAS] Error fetching leads chart:', e?.message);
    }

    // 4. Resumen rápido por estado
    let statusSummary = {};
    try {
      const custColl = db.collection('costumers');
      const custFilter = { $or: dateConditions };
      const statusAgg = await custColl.aggregate([
        { $match: custFilter },
        { $group: {
          _id: '$status',
          count: { $sum: 1 }
        }},
        { $sort: { count: -1 } }
      ]).toArray();
      statusAgg.forEach(s => {
        statusSummary[s._id || 'Sin estado'] = s.count;
      });
      console.log(`[INIT-ESTADISTICAS] Status summary: ${Object.keys(statusSummary).length} estados`);
    } catch (e) {
      console.warn('[INIT-ESTADISTICAS] Error fetching status summary:', e?.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-ESTADISTICAS] ✅ Completado en ${elapsed}ms`);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: {
        username: user?.username,
        role: user?.role,
        team: user?.team || 'Sin equipo'
      },
      data: {
        teamsData: teamsData,
        agentsData: agentsData,
        leadsChartData: leadsChartData,
        statusSummary: statusSummary,
        monthYear: `${currentMonth + 1}/${currentYear}`,
        note: 'Datos precalculados para Estadísticas.html'
      },
      ttl: 5 * 60 * 1000
    };

    res.json(response);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-ESTADISTICAS] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos de estadísticas',
      error: error.message
    });
  }
});

// Endpoint específico para precalentamiento de Rankings
app.get('/api/init-rankings', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    console.log(`[INIT-RANKINGS] ⚡ Inicio para ${username} (${userRole})`);

    // 1. Ranking del MES ACTUAL (para mostrar Top 3) - buscar en costumers por rango de fecha
    let currentMonthRanking = [];
    try {
      const custColl = db.collection('costumers');
      
      // Buscar en costumers por rango de fecha del mes actual
      const rankingData = await custColl.find({
        $or: [
          { createdAt: { $gte: monthStart, $lte: monthEnd } },
          { dia_venta: { $gte: monthStart, $lte: monthEnd } },
          { fecha: { $gte: monthStart, $lte: monthEnd } }
        ]
      })
        .project({
          _id: 1,
          agente: 1,
          agenteNombre: 1,
          nombre: 1,
          puntos: 1,
          puntaje: 1,
          sumPuntaje: 1,
          ventas: 1,
          posicion: 1,
          position: 1,
          mes: 1
        })
        .sort({ sumPuntaje: -1, puntos: -1 })
        .limit(30)
        .toArray();
      
      currentMonthRanking = rankingData.map((r, idx) => ({
        agente: r.agente,
        nombre: r.agenteNombre || r.nombre,
        puntos: r.sumPuntaje || r.puntos || 0,
        puntaje: r.sumPuntaje || r.puntaje || 0,
        promedio: r.sumPuntaje || r.puntaje || 0,
        ventas: r.ventas || 0,
        posicion: r.position || r.posicion || (idx + 1),
        position: r.position || r.posicion || (idx + 1),
        mes: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`
      }));
      console.log(`[INIT-RANKINGS] Ranking mes actual (${monthStart.toISOString()} - ${monthEnd.toISOString()}): ${currentMonthRanking.length} agentes`);
    } catch (e) {
      console.warn('[INIT-RANKINGS] Error fetching current month ranking:', e?.message);
    }

    // 2. Ranking histórico por mes (últimos 6 meses)
    let monthlyRankings = {};
    try {
      // Buscar SOLO en la colección principal 'costumers' para evitar duplicados de agentes en colecciones individuales
      const costumersColl = db.collection('costumers');
      const months = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const y = d.getFullYear();
        months.push({ key: `${y}-${m}`, year: y, month: parseInt(m, 10) });
      }

      for (const monthInfo of months) {
        try {
          const { key: monthKey, year: y, month: m } = monthInfo;
          const monthStart = new Date(y, m - 1, 1);
          const monthEnd = new Date(y, m, 0, 23, 59, 59);
          
          console.log(`[INIT-RANKINGS] Consultando mes ${monthKey} desde costumers collection`);
          
          // Usar agregación para agrupar por agente y evitar duplicados
          const rankData = await costumersColl
            .aggregate([
              {
                $match: {
                  createdAt: { $gte: monthStart, $lte: monthEnd }
                }
              },
              {
                $group: {
                  _id: { $toLower: { $trim: { input: '$agente' } } },
                  agenteNombre: { $first: '$agente' },
                  nombre: { $first: '$agente' },
                  ventas: { $sum: { $cond: [{ $in: ['$status', ['vendido', 'cerrado', 'completado']] }, 1, 0] } },
                  sumPuntaje: { $sum: { $toDouble: { $ifNull: ['$puntaje', 0] } } },
                  count: { $sum: 1 }
                }
              },
              { $sort: { sumPuntaje: -1, ventas: -1 } },
              { $limit: 15 }
            ])
            .toArray();
          
          monthlyRankings[monthKey] = rankData.map((r, idx) => ({
            agente: r._id,
            nombre: r.agenteNombre || r.nombre,
            puntos: Number((r.sumPuntaje || 0).toFixed(2)),
            ventas: r.ventas || 0,
            position: idx + 1,
            mes: monthKey
          }));
          
          console.log(`[INIT-RANKINGS] ${monthKey}: ${rankData.length} agentes encontrados`);
        } catch (e) {
          console.warn(`[INIT-RANKINGS] Error fetching ranking for ${monthInfo.key}:`, e?.message);
          monthlyRankings[monthInfo.key] = [];
        }
      }
      console.log(`[INIT-RANKINGS] Ranking histórico: ${Object.keys(monthlyRankings).length} meses cargados`);
    } catch (e) {
      console.warn('[INIT-RANKINGS] Error fetching monthly rankings:', e?.message);
    }

    // 3. Top 3 actual (para podio)
    let topThree = {
      first: currentMonthRanking[0] || null,
      second: currentMonthRanking[1] || null,
      third: currentMonthRanking[2] || null
    };

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-RANKINGS] ✅ Completado en ${elapsed}ms`);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: {
        username: user?.username,
        role: user?.role,
        team: user?.team || 'Sin equipo'
      },
      data: {
        currentMonthRanking: currentMonthRanking,
        topThree: topThree,
        monthlyRankings: monthlyRankings,
        monthYear: `${currentMonth + 1}/${currentYear}`,
        note: 'Datos precalculados para Ranking y Promociones.html'
      },
      ttl: 5 * 60 * 1000
    };

    res.json(response);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-RANKINGS] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos de rankings',
      error: error.message
    });
  }
});

// Endpoint específico para precalentamiento de Lead
app.get('/api/init-lead', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    console.log(`[INIT-LEAD] ⚡ Inicio para ${username}`);

    const dateConditions = [
      { fecha: { $gte: monthStart, $lte: monthEnd } },
      { createdAt: { $gte: monthStart, $lte: monthEnd } }
    ];

    // Leads del mes actual
    let leadsData = [];
    try {
      const leadsColl = db.collection('leads');
      leadsData = await leadsColl.find({ $or: dateConditions })
        .project({
          _id: 1,
          nombre: 1,
          status: 1,
          fecha: 1,
          agente: 1,
          agenteNombre: 1,
          puntaje: 1,
          servicios: 1,
          empresa: 1
        })
        .limit(200)
        .toArray();
      console.log(`[INIT-LEAD] Leads del mes: ${leadsData.length}`);
    } catch (e) {
      console.warn('[INIT-LEAD] Error fetching leads:', e?.message);
    }

    // Resumen por status
    let statusSummary = {};
    try {
      const statusAgg = await db.collection('leads').aggregate([
        { $match: { $or: dateConditions } },
        { $group: {
          _id: '$status',
          count: { $sum: 1 }
        }},
        { $sort: { count: -1 } }
      ]).toArray();
      statusAgg.forEach(s => {
        statusSummary[s._id || 'Sin estado'] = s.count;
      });
    } catch (e) {
      console.warn('[INIT-LEAD] Error fetching status:', e?.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-LEAD] ✅ Completado en ${elapsed}ms`);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: { username: user?.username, role: user?.role },
      data: {
        leadsData: leadsData,
        statusSummary: statusSummary,
        monthYear: `${currentMonth + 1}/${currentYear}`
      },
      ttl: 5 * 60 * 1000
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-LEAD] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos de leads',
      error: error.message
    });
  }
});

// Endpoint específico para precalentamiento de Facturación
app.get('/api/init-facturacion', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    console.log(`[INIT-FACTURACION] ⚡ Inicio para ${username}`);

    const dateConditions = [
      { dia_venta: { $gte: monthStart, $lte: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } },
      { createdAt: { $gte: monthStart, $lte: monthEnd } }
    ];

    // Datos de facturación
    let facturacionData = [];
    try {
      const custColl = db.collection('costumers');
      facturacionData = await custColl.find({ $or: dateConditions })
        .project({
          _id: 1,
          nombre_cliente: 1,
          numero_cuenta: 1,
          status: 1,
          agente: 1,
          agenteNombre: 1,
          dia_venta: 1,
          dia_instalacion: 1,
          cantidad_lineas: 1,
          autopago: 1
        })
        .limit(150)
        .toArray();
      console.log(`[INIT-FACTURACION] Registros del mes: ${facturacionData.length}`);
    } catch (e) {
      console.warn('[INIT-FACTURACION] Error fetching facturacion:', e?.message);
    }

    // Resumen de ingresos
    let ingresosSummary = { total: 0, completadas: 0 };
    try {
      const agg = await db.collection('costumers').aggregate([
        { $match: { $or: dateConditions } },
        { $group: {
          _id: null,
          totalCount: { $sum: 1 },
          completadas: { $sum: { $cond: [{ $eq: ['$status', 'Completado'] }, 1, 0] } }
        }}
      ]).toArray();
      if (agg.length > 0) {
        ingresosSummary.total = agg[0].totalCount || 0;
        ingresosSummary.completadas = agg[0].completadas || 0;
      }
    } catch (e) {
      console.warn('[INIT-FACTURACION] Error fetching summary:', e?.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-FACTURACION] ✅ Completado en ${elapsed}ms`);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: { username: user?.username, role: user?.role },
      data: {
        facturacionData: facturacionData,
        ingresosSummary: ingresosSummary,
        monthYear: `${currentMonth + 1}/${currentYear}`
      },
      ttl: 5 * 60 * 1000
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-FACTURACION] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos de facturación',
      error: error.message
    });
  }
});

// Endpoint específico para precalentamiento de Multimedia
app.get('/api/init-multimedia', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Base de datos no disponible' });
    }

    const user = req.user;
    const username = user?.username || '';

    console.log(`[INIT-MULTIMEDIA] ⚡ Inicio para ${username}`);

    // Archivos multimedia recientes
    let multimediaData = [];
    try {
      const mediaColl = db.collection('media');
      multimediaData = await mediaColl.find({})
        .project({
          _id: 1,
          fileName: 1,
          fileType: 1,
          uploadedBy: 1,
          uploadedAt: 1,
          fileSize: 1
        })
        .sort({ uploadedAt: -1 })
        .limit(100)
        .toArray();
      console.log(`[INIT-MULTIMEDIA] Archivos: ${multimediaData.length}`);
    } catch (e) {
      console.warn('[INIT-MULTIMEDIA] Error fetching media:', e?.message);
    }

    // Resumen por tipo
    let typeSummary = {};
    try {
      const typeAgg = await db.collection('media').aggregate([
        { $group: {
          _id: '$fileType',
          count: { $sum: 1 }
        }},
        { $sort: { count: -1 } }
      ]).toArray();
      typeAgg.forEach(t => {
        typeSummary[t._id || 'desconocido'] = t.count;
      });
    } catch (e) {
      console.warn('[INIT-MULTIMEDIA] Error fetching type summary:', e?.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[INIT-MULTIMEDIA] ✅ Completado en ${elapsed}ms`);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      loadTime: elapsed,
      user: { username: user?.username, role: user?.role },
      data: {
        multimediaData: multimediaData,
        typeSummary: typeSummary
      },
      ttl: 5 * 60 * 1000
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[INIT-MULTIMEDIA] ❌ Error en ${elapsed}ms:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar datos de multimedia',
      error: error.message
    });
  }
});

app.get('/api/auth/debug-storage', (req, res) => {
  res.json({
    success: true,
    message: 'Este endpoint es solo para debugging',
    note: 'Para verificar si hay token, usa /api/auth/verify-server',
    instructions: 'Asegúrate de estar logueado correctamente en login.html',
    troubleshooting: [
      '1. Ve a login.html e inicia sesión con un usuario admin',
      '2. El token se guardará automáticamente en cookies',
      '3. Regresa a empleado-del-mes.html',
      '4. Los permisos se verificarán automáticamente'
    ]
  });
});

// Debug: Exponer cache de init-dashboard para pruebas rápidas (no protegido)
app.get('/api/init-dashboard-debug', (req, res) => {
  try {
    const cache = global.initDashboardCache || { data: null, updatedAt: 0 };
    return res.json({ success: true, cache });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Dev helper: emitir un token JWT de prueba para debugging local (NO en production)
app.post('/api/auth/test-token', (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ success: false, message: 'Not allowed in production' });
    const originIp = req.ip || req.connection && req.connection.remoteAddress || '';
    // permitir solo llamadas desde localhost
    if (!(originIp === '::1' || originIp === '127.0.0.1' || originIp.endsWith('::1') || originIp.startsWith('127.0.0.1'))) {
      return res.status(403).json({ success: false, message: 'Allowed only from localhost' });
    }

    const body = req.body || {};
    const username = body.username || body.user || 'dev.admin';
    const role = body.role || 'Administrador';
    const payload = { username, role };
    const token = require('jsonwebtoken').sign(payload, process.env.JWT_SECRET || 'tu_clave_secreta_super_segura', { expiresIn: '2h' });
    return res.json({ success: true, token, payload });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Endpoint para obtener teams con supervisores asignados
app.get('/api/teams', protect, authorize('Administrador', 'admin', 'administrador', 'Administrativo'), (req, res) => {
  try {
    console.log('[TEAMS] Solicitando lista de teams...');
    
    // Teams con supervisores predefinidos (datos estáticos)
    const teamsWithSupervisors = [
      {
        value: 'TEAM IRANIA',
        label: 'TEAM IRANIA',
        supervisor: 'irania.serrano',
        supervisorName: 'Irania Serrano'
      },
      {
        value: 'TEAM BRYAN PLEITEZ',
        label: 'TEAM BRYAN PLEITEZ', 
        supervisor: 'bryan.pleitez',
        supervisorName: 'Bryan Pleitez'
      },
      {
        value: 'TEAM MARISOL BELTRAN',
        label: 'TEAM MARISOL BELTRAN',
        supervisor: 'marisol.beltran', 
        supervisorName: 'Marisol Beltrán'
      },
      {
        value: 'TEAM ROBERTO VELASQUEZ',
        label: 'TEAM ROBERTO VELASQUEZ',
        supervisor: 'roberto.velasquez',
        supervisorName: 'Roberto Velásquez'
      },
      {
        value: 'TEAM RANDAL MARTINEZ', 
        label: 'TEAM RANDAL MARTINEZ',
        supervisor: 'randal.martinez',
        supervisorName: 'Randal Martínez'
      },
      {
        value: 'TEAM LINEAS',
        label: 'TEAM LÍNEAS',
        supervisor: 'jonathan.figueroa',
        supervisorName: 'Jonathan Figueroa'
      },
      {
        value: 'Backoffice',
        label: 'Backoffice',
        supervisor: null,
        supervisorName: 'Sin supervisor específico'
      },
      {
        value: 'Administración',
        label: 'Administración', 
        supervisor: null,
        supervisorName: 'Sin supervisor específico'
      }
    ];
    
    console.log('[TEAMS] Devolviendo', teamsWithSupervisors.length, 'teams');
    
    res.json({
      success: true,
      teams: teamsWithSupervisors
    });
    
  } catch (error) {
    console.error('[TEAMS] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener teams' 
    });
  }
});

// Endpoint para obtener supervisores por team (simplificado - ya no se usa)
app.get('/api/supervisors/:team', protect, authorize('Administrador', 'admin', 'administrador', 'Administrativo'), (req, res) => {
  try {
    const { team } = req.params;
    console.log('[SUPERVISORS] Solicitando supervisores para team:', team);
    
    // Ya no necesitamos este endpoint porque los supervisores se asignan automáticamente
    // Pero lo mantenemos por compatibilidad
    res.json({
      success: true,
      supervisors: []
    });
    
  } catch (error) {
    console.error('[SUPERVISORS] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener supervisores' 
    });
  }
});

// Endpoint para registrar nuevo usuario (solo administradores)
app.post('/api/auth/register', protect, authorize('Administrador', 'admin', 'administrador', 'Administrativo'), async (req, res) => {
  try {
    const { username, password, role, team, supervisor } = req.body;

    // Validaciones básicas
    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Username, password y role son requeridos'
      });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 8 caracteres'
      });
    }

    // Normalizar el rol recibido a valores canónicos usados en la app
    const normalizeRole = (r) => {
      if (!r) return 'Usuario';
      const rr = String(r).trim().toLowerCase();
      if (['admin', 'administrador', 'administrator', 'administrativo'].includes(rr)) return 'Administrador';
      if (['backoffice', 'back office', 'back_office', 'bo', 'b.o', 'b-o'].includes(rr)) return 'Backoffice';
      if (['supervisor'].includes(rr)) return 'Supervisor';
      if (['vendedor', 'agente', 'agentes', 'agent'].includes(rr)) return 'Agente';
      if (['team lineas', 'team_lineas', 'teamlineas', 'lineas', 'lineas-agentes'].includes(rr)) return 'Team Lineas';
      // Capitalizar la primera letra por defecto
      return rr.charAt(0).toUpperCase() + rr.slice(1);
    };

    const canonicalRole = normalizeRole(role);
    
    // Crear el nuevo usuario
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }
    if (!db) db = getDb();

    // Verificar si el usuario ya existe
    const existingUser = await db.collection('users').findOne({ username: username });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'El usuario ya existe'
      });
    }

    // Hashear la contraseña
    const bcrypt = require('bcryptjs');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Normalizar el team: si es Backoffice no asignar team (Backoffice ve todo)
    let teamNormalized = team ? String(team).trim() : null;
    if (canonicalRole === 'Backoffice') teamNormalized = null;

    // Definir permisos por rol (coincidente con PERMISOS_POR_ROL.md)
    const rolePermissions = {
      'Administrador': ['read', 'write', 'delete', 'manage_users', 'manage_teams'],
      'Backoffice': ['read', 'write', 'export', 'view_finance'],
      'Supervisor': ['read_team', 'write_team', 'view_reports'],
      'Agente': ['read_own', 'write_own'],
      'Team Lineas': ['read_team:lineas', 'write_team:lineas']
    };

    const permissions = rolePermissions[canonicalRole] || ['read_own'];

    // Crear el nuevo usuario
    const newUser = {
      username: String(username).trim(),
      password: hashedPassword,
      role: canonicalRole,
      team: teamNormalized || null,
      supervisor: supervisor || null,
      name: (req.body.name && String(req.body.name).trim()) || String(username).trim(),
      permissions,
      createdBy: req.user && req.user.username ? req.user.username : 'system',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('users').insertOne(newUser);
    // No devolver la contraseña
    delete newUser.password;
    
    console.log(`[REGISTER] Nuevo usuario creado: ${username} (${role}) en team: ${team} con supervisor: ${supervisor} por: ${req.user.username}`);
    
    res.json({ 
      success: true, 
      message: 'Usuario creado exitosamente',
      user: {
        username: newUser.username,
        role: newUser.role,
        team: newUser.team,
        supervisor: newUser.supervisor
      }
    });
    
  } catch (error) {
    console.error('[REGISTER] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// Endpoint para restablecer contraseña (solo administradores)
app.post('/api/auth/reset-password', protect, authorize('Administrador', 'admin', 'administrador', 'Administrativo'), async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    
    if (!username || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username y nueva contraseña son requeridos' 
      });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: 'La contraseña debe tener al menos 8 caracteres' 
      });
    }
    
    // Asegurar conexión BD
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }
    let db;
    try {
      db = await connectToMongoDB();
    } catch (dbError) {
      console.error('[AUTH] Error conectando a MongoDB en resetPassword:', dbError);
      return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }

    // Buscar el usuario en MongoDB
    const user = await db.collection('users').findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    // Hashear la nueva contraseña
    const bcrypt = require('bcryptjs');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar la contraseña
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );
    
    console.log(`[RESET] Contraseña restablecida para usuario: ${username} por: ${req.user.username}`);
    
    res.json({ 
      success: true, 
      message: 'Contraseña restablecida exitosamente' 
    });
    
  } catch (error) {
    console.error('[RESET] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// ===== ENDPOINTS MULTIMEDIA =====

// Endpoint para subir archivos multimedia
app.post('/api/upload', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se recibió ningún archivo'
      });
    }
    // Asegurar conexión BD
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }
    if (!db) db = getDb();
    const collection = db.collection('mediafiles');
    
    // Determinar categoría del archivo (permite override desde el cliente)
    let categoryOverride = (req.body && req.body.category) || req.query.category || req.headers['x-media-category'];
    let category = null;
    if (categoryOverride && typeof categoryOverride === 'string') {
      category = categoryOverride.toLowerCase();
    } else {
      category = 'image';
      if (req.file.mimetype === 'image/gif') {
        category = 'gif';
      } else if (req.file.mimetype.startsWith('video/')) {
        category = 'video';
      }
    }
    
    // URL del archivo (local por defecto); si hay Cloudinary, subir allí
    let fileUrl = `/uploads/${req.file.filename}`;
    let cloudinaryPublicId = null;
    let source = 'local';
    
    const hasCloudinary = cloudinary && process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
    if (hasCloudinary) {
      try {
        const folder = `crm/${category || 'general'}`;
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder,
          resource_type: 'auto',
        });
        fileUrl = result.secure_url;
        cloudinaryPublicId = result.public_id;
        source = 'cloudinary';
        // Borrar archivo local tras subir a Cloudinary
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (e) {
        console.warn('[UPLOAD] Cloudinary fallo, se mantiene archivo local:', e.message);
      }
    }

    // Guardar información en la base de datos (Mongo nativo)
    const now = new Date();
    const doc = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      url: fileUrl,
      cloudinaryPublicId,
      source,
      uploadedBy: req.user.username,
      category: category,
      uploadDate: now,
      createdAt: now,
      updatedAt: now
    };
    const insertResult = await collection.insertOne(doc);
    const saved = { _id: insertResult.insertedId, ...doc };

    console.log(`[UPLOAD] Archivo subido: ${req.file.originalname} por ${req.user.username}`);

    res.json({
      success: true,
      message: 'Archivo subido exitosamente',
      file: {
        id: saved._id,
        name: saved.originalName,
        url: saved.url,
        type: saved.mimetype,
        size: saved.size,
        category: saved.category,
        uploadDate: saved.uploadDate,
        source: saved.source
      }
    });

  } catch (error) {
    console.error('[UPLOAD] Error:', error);
    
    // Eliminar archivo si hubo error guardando en BD
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Error subiendo archivo'
    });
  }
});

// Endpoint para obtener lista de archivos multimedia (con verificación de existencia)
app.get('/api/media', protect, async (req, res) => {
  try {
    console.log('[MEDIA] Solicitud a /api/media recibida');

    // Usar MongoDB nativo en lugar de Mongoose
    if (!db) await connectToMongoDB();
    const collection = db.collection('mediafiles');

    // Filtros opcionales
    const { category, limit = 50, offset = 0, orderBy = 'uploadDate', sort = 'desc' } = req.query;

    let query = {};
    if (category && category !== 'all') {
      query.category = category;
    }

    // Configurar ordenamiento dinámico
    const allowedSortFields = {
      'uploadDate': 'uploadDate',
      'createdAt': 'createdAt', 
      'updatedAt': 'updatedAt',
      'originalName': 'originalName',
      'size': 'size'
    };
    
    const sortField = allowedSortFields[orderBy] || 'uploadDate';
    const sortDirection = sort.toLowerCase() === 'asc' ? 1 : -1;
    const sortSpec = { [sortField]: sortDirection };

    console.log(`[MEDIA] Ejecutando consulta a mediafiles con orden: ${JSON.stringify(sortSpec)}`);
    const files = await collection
      .find(query, { 
        sort: sortSpec,
        limit: parseInt(limit),
        skip: parseInt(offset)
      })
      .toArray();

    console.log(`[MEDIA] Encontrados ${files.length} archivos en BD`);

    // Verificar existencia de archivos locales y aceptar Cloudinary sin verificación en disco
    const uploadsDir = path.join(__dirname, 'uploads');
    const validFiles = [];

    for (const file of files) {
      try {
        const isCloudinary = file.source === 'cloudinary' || /https?:\/\/res\.cloudinary\.com\//i.test(file.url || '');
        if (isCloudinary) {
          // Para Cloudinary, confiamos en la URL segura almacenada
          validFiles.push(file);
          console.log(`[MEDIA] ✓ Archivo Cloudinary: ${file.originalName}`);
          continue;
        }

        const filePath = path.join(uploadsDir, path.basename(file.url || ''));
        if (file.url && fs.existsSync(filePath)) {
          validFiles.push(file);
          console.log(`[MEDIA] ✓ Archivo local válido: ${file.originalName}`);
        } else {
          console.log(`[MEDIA] 🗑️ Eliminando referencia a archivo local inexistente: ${file.url}`);
          await collection.deleteOne({ _id: file._id });
        }
      } catch (error) {
        console.error(`[MEDIA] Error verificando archivo ${file.url}:`, error);
      }
    }

    console.log(`[MEDIA] Devolviendo ${validFiles.length} archivos válidos`);

    const formattedFiles = validFiles.map(file => ({
      id: file._id,
      name: file.originalName,
      url: file.url,
      type: file.mimetype,
      size: file.size,
      category: file.category,
      uploadDate: file.uploadDate,
      uploadedBy: file.uploadedBy
    }));

    res.json(formattedFiles);

  } catch (error) {
    console.error('[MEDIA] Error obteniendo archivos:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo archivos'
    });
  }
});

// Endpoint para eliminar archivo multimedia
app.delete('/api/media/:id', protect, async (req, res) => {
  try {
    if (!db) await connectToMongoDB();
    const collection = db.collection('mediafiles');
    const { id } = req.params;

    const file = await collection.findOne({ _id: new ObjectId(id) });
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'Archivo no encontrado'
      });
    }

    // Verificar permisos: solo el que subió el archivo o admin puede eliminarlo
    const isAdmin = ['admin', 'Administrador', 'administrador', 'Administrativo'].includes(req.user.role);
    if (file.uploadedBy !== req.user.username && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para eliminar este archivo'
      });
    }

    // Eliminar archivo físico
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    // Eliminar registro de la base de datos
    await collection.deleteOne({ _id: new ObjectId(id) });

    console.log(`[DELETE] Archivo eliminado: ${file.originalName} por ${req.user.username}`);

    res.json({
      success: true,
      message: 'Archivo eliminado exitosamente'
    });

  } catch (error) {
    console.error('[DELETE] Error eliminando archivo:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando archivo'
    });
  }
});

// Endpoint para obtener estadísticas de multimedia
app.get('/api/media/stats', protect, async (req, res) => {
  try {
    if (!db) await connectToMongoDB();
    const collection = db.collection('mediafiles');

    // Usar aggregate con MongoDB nativo
    const stats = await collection.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalSize: { $sum: '$size' }
        }
      }
    ]).toArray();

    const totalFiles = await collection.countDocuments();
    const totalSizeResult = await collection.aggregate([
      { $group: { _id: null, total: { $sum: '$size' } } }
    ]).toArray();

    res.json({
      success: true,
      stats: {
        total: totalFiles,
        totalSize: totalSizeResult[0]?.total || 0,
        byCategory: stats
      }
    });

  } catch (error) {
    console.error('[STATS] Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas'
    });
  }
});

// Endpoint temporal para debugging - ver información del usuario actual
app.get('/api/debug/user', protect, async (req, res) => {
  try {
    console.log('[DEBUG] Usuario actual:', req.user);
    
    // También buscar en la base de datos
    let dbUser = null;
    if (req.user && req.user._id) {
      // Usar MongoDB en lugar de UserMemory
      try {
        if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }
    if (!db) db = getDb();
        dbUser = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
      } catch (error) {
        console.error('[DEBUG] Error buscando usuario en MongoDB:', error);
      }
    }
    
    res.json({
      success: true,
      tokenUser: req.user,
      dbUser: dbUser,
      canCreateAccounts: ['Administrador', 'admin', 'administrador', 'Administrativo'].includes(req.user?.role)
    });
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para ver usuarios disponibles (solo desarrollo)
app.get('/api/debug/users', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' });
    }

    // Usar MongoDB en lugar de UserMemory
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: 'Servicio no disponible. No hay conexión a la base de datos.' });
    }
    if (!db) db = getDb();
    const users = await db.collection('users')
      .find({}, { username: 1, role: 1, _id: 1 })
      .toArray();

    const sanitizedUsers = users.map(u => ({
      _id: u._id,
      username: u.username,
      role: u.role,
      team: u.team,
      createdAt: u.createdAt
    }));

    res.json({
      success: true,
      message: 'Usuarios disponibles en MongoDB',
      users: sanitizedUsers,
      note: 'Credenciales de prueba: usuario="Kelvin Rodriguez" contraseña="Kelvin2025" o "Daniel Martinez" contraseña="password"'
    });
  } catch (error) {
    try {
      if (!db) await connectToMongoDB();
      const collection = db.collection('mediafiles');

      // Obtener todos los archivos multimedia de la BD
      const mediaFiles = await collection.find({}).toArray();
      const uploadsDir = path.join(__dirname, 'uploads');

      let cleaned = 0;
      let errors = 0;

      console.log(`[CLEAN-MEDIA] Revisando ${mediaFiles.length} archivos multimedia...`);

      for (const file of mediaFiles) {
        try {
          const filePath = path.join(uploadsDir, path.basename(file.url));

          // Verificar si el archivo existe físicamente
          if (!fs.existsSync(filePath)) {
            console.log(`[CLEAN-MEDIA] Eliminando referencia a archivo inexistente: ${file.url}`);
            await collection.deleteOne({ _id: file._id });
            cleaned++;
          }
        } catch (error) {
          console.error(`[CLEAN-MEDIA] Error procesando archivo ${file.url}:`, error);
          errors++;
        }
      }

      res.json({
        success: true,
        message: 'Limpieza de archivos multimedia completada',
        cleaned,
        errors,
        total: mediaFiles.length
      });
    } catch (error) {
      console.error('[CLEAN-MEDIA] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Endpoint para crear un usuario administrador inicial (solo desarrollo + secreto por .env)
app.post('/api/create-admin', async (req, res) => {
  try {
    // Bloquear en producción
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ success: false, message: 'No encontrado' });
    }

    const { username, password, secret } = req.body || {};
    const SETUP_SECRET = process.env.ADMIN_SETUP_SECRET;
    const headerSecret = req.headers['x-admin-setup-secret'];
    const providedSecret = headerSecret || secret;

    if (!SETUP_SECRET || !providedSecret || providedSecret !== SETUP_SECRET) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña son requeridos' });
    }

    // Verificar si la base de datos está conectada
    if (!db) {
      console.log('Base de datos no conectada, intentando conectar...');
      db = await connectToMongoDB();
    }

    // Verificar si el usuario ya existe
    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'El usuario ya existe' });
    }

    // Hashear la contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear el usuario administrador
    const newUser = {
      username,
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('users').insertOne(newUser);
    // No devolver la contraseña
    delete newUser.password;

    return res.status(201).json({ success: true, message: 'Usuario administrador creado exitosamente', user: newUser });
  } catch (error) {
    console.error('Error al crear usuario administrador:', error);
    return res.status(500).json({ success: false, message: 'Error al crear el usuario administrador' });
  }
});

    // Listar agentes desde la colección de usuarios (para hidratar sidebar)
    app.get('/api/users/agents', protect, async (req, res) => {
  try {
    if (!db) await connectToMongoDB();
    const usersColl = db.collection('users');
    // Filtrar roles que contengan 'agente' o 'vendedor' (case-insensitive)
    const roleFilter = { role: { $regex: /(agente|vendedor)/i } };
    const users = await usersColl
      .find(roleFilter)
      .project({ username: 1, name: 1, nombre: 1, fullName: 1, role: 1, supervisor:1, supervisorName:1, supervisorId:1, team:1 })
      .toArray();
    const sanitized = users.map(u => ({
      id: (u._id && u._id.toString()) || null,
      username: u.username || null,
      name: u.name || u.nombre || u.fullName || u.username || null,
      role: u.role || 'Agentes'
    }));
    return res.json({ success: true, agents: sanitized });
  } catch (e) {
    console.error('[users-agents] error:', e);
    return res.status(500).json({ success: false, message: 'Error obteniendo agentes', error: e.message });
  }
});

// Endpoint para el login
// Endpoint para el login (aplicar rate limit si disponible)
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Usuario y contraseña son requeridos' 
      });
    }
    
    // Verificar si la base de datos está conectada
    if (!db) {
      console.log('Base de datos no conectada, intentando conectar...');
      await connectToMongoDB();
    }
    
    // Buscar el usuario en la base de datos
    const user = await db.collection('users').findOne({ username });
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Usuario o contraseña incorrectos' 
      });
    }
    
    // Verificar la contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Usuario o contraseña incorrectos' 
      });
    }
    
    // Generar token JWT (usar clave 'id' de forma unificada)
    const token = jwt.sign(
      { 
        id: user._id?.toString(), 
        username: user.username,
        role: user.role || 'user'
      }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Establecer cookie HttpOnly con el token (compatibilidad con lecturas desde cookie)
    try {
      const opts = cookieOptionsForReq(req, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
      });
      res.cookie && res.cookie('token', token, opts);
    } catch {}

    // Enviar respuesta exitosa sin la contraseña
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      token,
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({
      success: false,
      message: 'Error en el servidor durante el inicio de sesión'
    });
  }
});

// Endpoint para obtener comentarios de un lead (usado por Costumer.html)
app.get('/api/comments', async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'Se requiere el parámetro leadId' });
    }
    if (!db) {
      await connectToMongoDB();
    }
    let leadObjectId;
    try {
      leadObjectId = new ObjectId(leadId);
    } catch {
      return res.status(400).json({ success: false, message: 'leadId inválido' });
    }
    const comments = await db
      .collection('Vcomments')
      .find({ leadId: leadObjectId })
      .sort({ createdAt: 1 })
      .toArray();
    // Adaptar para frontend: devolver arreglo en propiedad comments
    const payload = (comments || []).map(c => ({
      _id: c._id?.toString(),
      autor: c.autor || c.author || 'Desconocido',
      texto: c.texto || c.text || '',
      fecha: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString()
    }));
    return res.json({ success: true, comments: payload, message: 'Comentarios cargados correctamente' });
  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    return res.status(500).json({ success: false, message: 'Error al cargar los comentarios', error: error.message });
  }
});

// Endpoints de comentarios por lead (solo administradores)
// Listar comentarios
app.get('/api/leads/:id/comentarios', protect, (req, res, next) => {
  // Verificar si el usuario es administrador
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado. Se requiere rol de administrador.'
    });
  }
  next();
}, async (req, res) => {
  try {
    const leadId = req.params.id;
    if (!db) await connectToMongoDB();
    let leadObjectId;
    try { leadObjectId = new ObjectId(leadId); } catch { return res.status(400).json({ success: false, message: 'leadId inválido' }); }
    const list = await db.collection('Vcomments').find({ leadId: leadObjectId }).sort({ createdAt: 1 }).toArray();
    const mapped = list.map(c => ({
      _id: c._id?.toString(),
      autor: c.autor || c.author || 'Desconocido',
      fecha: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
      texto: c.texto || c.text || ''
    }));
    return res.json(mapped);
  } catch (err) {
    console.error('GET comentarios error:', err);
    return res.status(500).json({ success: false, message: 'Error al obtener comentarios', error: err.message });
  }
});

// Crear comentario
app.post('/api/leads/:id/comentarios', protect, async (req, res) => {
  try {
    const leadId = req.params.id;
    const { texto, comentario, autor: autorBody } = req.body || {};
    if (!db) await connectToMongoDB();
    let leadObjectId;
    try { 
      leadObjectId = new ObjectId(leadId); 
    } catch { 
      return res.status(400).json({ success: false, message: 'leadId inválido' }); 
    }
    const now = new Date();
    const doc = {
      leadId: leadObjectId,
      texto: (texto ?? comentario ?? '').toString().slice(0, 1000),
      autor: autorBody || req.user?.username || 'Sistema',
      createdAt: now,
      updatedAt: now
    };
    const result = await db.collection('Vcomments').insertOne(doc);
    return res.status(201).json({
      success: true,
      message: 'Comentario creado',
      data: { _id: result.insertedId.toString(), ...doc }
    });
  } catch (err) {
    console.error('POST comentario error:', err);
    return res.status(500).json({ success: false, message: 'Error al crear comentario', error: err.message });
  }
});

// Actualizar comentario
app.put('/api/leads/:id/comentarios/:comentarioId', protect, async (req, res) => {
  try {
    const { id, comentarioId } = req.params;
    const { texto } = req.body || {};
    if (!db) await connectToMongoDB();
    let leadObjectId, commentObjectId;
    try { leadObjectId = new ObjectId(id); commentObjectId = new ObjectId(comentarioId); } catch { return res.status(400).json({ success: false, message: 'IDs inválidos' }); }
    const result = await db.collection('Vcomments').findOneAndUpdate(
      { _id: commentObjectId, leadId: leadObjectId },
      { $set: { texto: (texto ?? '').toString().slice(0, 1000), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ success: false, message: 'Comentario no encontrado' });
    const c = result.value;
    return res.json({ success: true, message: 'Comentario actualizado', data: { _id: c._id.toString(), autor: c.autor, texto: c.texto, fecha: new Date(c.createdAt).toISOString() } });
  } catch (err) {
    console.error('PUT comentario error:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar comentario', error: err.message });
  }
});

// Eliminar comentario
app.delete('/api/leads/:id/comentarios/:comentarioId', protect, async (req, res) => {
  try {
    const { id, comentarioId } = req.params;
    if (!db) await connectToMongoDB();
    let leadObjectId, commentObjectId;
    try { leadObjectId = new ObjectId(id); commentObjectId = new ObjectId(comentarioId); } catch { return res.status(400).json({ success: false, message: 'IDs inválidos' }); }
    const result = await db.collection('Vcomments').deleteOne({ _id: commentObjectId, leadId: leadObjectId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Comentario no encontrado' });
    return res.json({ success: true, message: 'Comentario eliminado' });
  } catch (err) {
    console.error('DELETE comentario error:', err);
    return res.status(500).json({ success: false, message: 'Error al eliminar comentario', error: err.message });
  }
});

// Actualizar el "status" de un lead/cliente
app.put('/api/leads/:id/status', protect, authorize('Administrador','Backoffice'), async (req, res) => {
  try {
    // Verificar conexión a BD
    if (!db) await connectToMongoDB();

    // Roles permitidos para actualizar status
    const role = req.user?.role || '';
    console.log('[PUT /api/leads/:id/status] Rol del usuario:', role);
    const allowedRoles = ['Administrador', 'Backoffice'];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ success: false, message: 'No autorizado para actualizar el estado' });
    }

    // Validar ID
    const { id } = req.params;
    let leadObjectId = null;
    try { leadObjectId = new ObjectId(id); } catch { /* puede ser string */ }
    console.log('[PUT /api/leads/:id/status] ID recibido:', id, 'ObjectId válido:', !!leadObjectId);

    // Validar body
    const allowed = ['pending', 'hold', 'cancelled', 'rescheduled', 'completed'];
    const rawStatus = (req.body?.status || '').toString().trim();
    const status = rawStatus.toLowerCase();
    console.log('[PUT /api/leads/:id/status] Status recibido:', rawStatus);
    if (!rawStatus) {
      return res.status(400).json({ success: false, message: 'El campo status es requerido' });
    }
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Status inválido. Permitidos: ${allowed.join(', ')}` });
    }

    // Normalizar a Capitalized para almacenar (opcional)
    const capitalized = status.charAt(0).toUpperCase() + status.slice(1);

    // Intentar actualización por etapas para evitar rarezas con $or
    const coll = db.collection('costumers');
    let result = null;

    // 1) Intentar por _id:ObjectId si es válido
    if (leadObjectId) {
      console.log('[PUT /api/leads/:id/status] Intentando update por _id:ObjectId');
      result = await coll.findOneAndUpdate(
        { _id: leadObjectId },
        { $set: { status: capitalized, actualizadoEn: new Date() } },
        { returnDocument: 'after' }
      );
      console.log('[PUT /api/leads/:id/status] Resultado _id:ObjectId:', !!(result && result.value));
    }

    // 2) Si no funcionó, intentar por _id:string
    if (!result || !result.value) {
      console.log('[PUT /api/leads/:id/status] Intentando update por _id:string');
      result = await coll.findOneAndUpdate(
        { _id: id },
        { $set: { status: capitalized, actualizadoEn: new Date() } },
        { returnDocument: 'after' }
      );
      console.log('[PUT /api/leads/:id/status] Resultado _id:string:', !!(result && result.value));
    }

    // 3) Si no funcionó, intentar por campo alterno id:string
    if (!result || !result.value) {
      console.log('[PUT /api/leads/:id/status] Intentando update por id:string');
      result = await coll.findOneAndUpdate(
        { id: id },
        { $set: { status: capitalized, actualizadoEn: new Date() } },
        { returnDocument: 'after' }
      );
      console.log('[PUT /api/leads/:id/status] Resultado id:string:', !!(result && result.value));
    }

    if (!result || !result.value) {
      // Diagnóstico adicional: comprobar cada criterio por separado
      try {
        const tests = [];
        if (leadObjectId) tests.push({ name: '_id:ObjectId', q: { _id: leadObjectId } });
        tests.push({ name: '_id:string', q: { _id: id } });
        tests.push({ name: 'id:string', q: { id: id } });
        for (const t of tests) {
          const found = await coll.findOne(t.q);
          console.log(`[PUT /api/leads/:id/status] Test criterio ${t.name}:`, found ? 'ENCONTRADO' : 'NO_ENCONTRADO');
        }
        // Intentar updateOne directo y loguear matched/modified para aislar el problema
        if (leadObjectId) {
          console.log('[PUT /api/leads/:id/status] Fallback updateOne por _id:ObjectId');
          const upd = await coll.updateOne(
            { _id: leadObjectId },
            { $set: { status: capitalized, actualizadoEn: new Date() } }
          );
          console.log('[PUT /api/leads/:id/status] updateOne resultado:', { matchedCount: upd.matchedCount, modifiedCount: upd.modifiedCount, acknowledged: upd.acknowledged });
          if (upd.matchedCount > 0) {
            console.log('[PUT /api/leads/:id/status] updateOne aplicó cambios, devolviendo éxito');
            return res.json({ success: true, message: 'Status actualizado correctamente (fallback updateOne)', data: { id, status: capitalized } });
          }
        }
      } catch (e) {
        console.warn('[PUT /api/leads/:id/status] Error durante diagnóstico de criterios:', e?.message);
      }
      console.warn('[PUT /api/leads/:id/status] Lead no encontrado con ninguno de los criterios para id:', id);
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    return res.json({ success: true, message: 'Status actualizado correctamente', data: { id, status: capitalized } });
  } catch (error) {
    console.error('Error al actualizar status del lead:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar el status', error: error.message });
  }
});

// ELIMINADO: Endpoint duplicado que interfería con routes/api.js

// Endpoint para obtener clientes desde la base de datos (solo administradores)
app.get('/api/customers', protect, async (req, res) => {
  try {
    console.log('Solicitud recibida en /api/customers');
    
    // Verificar si la base de datos está conectada
    if (!db) {
      console.log('Base de datos no conectada, intentando conectar...');
      await connectToMongoDB();
    }

    // Obtener los parámetros de paginación y filtros
    const page = parseInt(req.query.page) || 1;
    const userRole = (req.user?.role || '').toLowerCase();
    const isAdminOrBO = userRole === 'administrador' || userRole === 'backoffice' || userRole === 'admin';
    // Administradores pueden ver hasta 10,000 registros, otros hasta 500
    const maxLimit = isAdminOrBO ? 10000 : 500;
    const limit = Math.min(parseInt(req.query.limit) || 200, maxLimit);
    const skip = (page - 1) * limit;
    const fechaInicio = req.query.fechaInicio ? new Date(req.query.fechaInicio) : null;
    const fechaFin = req.query.fechaFin ? new Date(req.query.fechaFin) : null;

    console.log(`Parámetros - Página: ${page}, Límite: ${limit}, Saltar: ${skip}`);

    // Verificar colecciones disponibles
    const collections = await db.listCollections().toArray();
    console.log('Colecciones disponibles en crmagente:', collections.map(c => c.name));

    // ===== PARA ADMIN/BACKOFFICE: AGREGAR DE TODAS LAS COLECCIONES =====
    const shouldAggregateAll = isAdminOrBO && !req.query.agenteId && !req.query.agentId;
    
    if (shouldAggregateAll) {
      console.log('[INFO] Admin/Backoffice: agregando de TODAS las colecciones costumers*');
      
      // Obtener todas las colecciones costumers*
      const costumersCollections = collections
        .map(c => c.name)
        .filter(name => /^costumers(_|$)/i.test(name));
      
      console.log(`[INFO] Colecciones a agregar: ${costumersCollections.length}`);
      
      let allCustomers = [];
      
      // Construir query base (sin filtros de agente)
      let baseQuery = {};
      
      // Aplicar filtros de fecha si existen
      if (fechaInicio && fechaFin) {
        baseQuery.creadoEn = {
          $gte: fechaInicio,
          $lte: fechaFin
        };
      } else if (fechaInicio) {
        baseQuery.creadoEn = { $gte: fechaInicio };
      } else if (fechaFin) {
        baseQuery.creadoEn = { $lte: fechaFin };
      }
      
      // Aplicar filtros adicionales del query
      if (req.query.status) {
        baseQuery.status = req.query.status;
      }
      
      console.log('[DEBUG] Query base para agregación:', JSON.stringify(baseQuery, null, 2));
      
      // Consultar cada colección
      for (const colName of costumersCollections) {
        try {
          const docs = await db.collection(colName).find(baseQuery).toArray();
          if (docs.length > 0) {
            console.log(`[INFO] ${colName}: ${docs.length} documentos`);
            allCustomers = allCustomers.concat(docs);
          }
        } catch (colErr) {
          console.warn(`[WARN] Error consultando ${colName}:`, colErr.message);
        }
      }
      
      console.log(`[INFO] Total documentos agregados: ${allCustomers.length}`);
      
      // Ordenar y aplicar paginación
      const sortField = req.query.sortBy || 'creadoEn';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      
      allCustomers.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        
        if (aVal instanceof Date && bVal instanceof Date) {
          return sortOrder * (aVal.getTime() - bVal.getTime());
        }
        
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder * aVal.localeCompare(bVal);
        }
        
        return sortOrder * ((aVal || 0) - (bVal || 0));
      });
      
      // Aplicar paginación
      const paginatedCustomers = allCustomers.slice(skip, skip + limit);
      
      console.log('Enviando respuesta con', paginatedCustomers.length, 'clientes');
      return res.json({
        success: true,
        data: paginatedCustomers,
        total: allCustomers.length,
        page,
        limit,
        aggregatedFromCollections: costumersCollections.length
      });
    }

    // ===== PARA SUPERVISOR: AGREGAR DE COLECCIONES DE SUS AGENTES =====
    const isSupervisor = userRole === 'supervisor' || userRole.includes('supervisor');
    const shouldAggregateSupervisor = isSupervisor && !req.query.agenteId && !req.query.agentId;
    
    if (shouldAggregateSupervisor) {
      console.log('[INFO] Supervisor: agregando de colecciones de sus agentes');
      
      const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || ''));
      
      // 1. Obtener agentes asignados al supervisor
      let agentIds = [];
      let agentCollections = new Set();
      
      try {
        // Buscar usuarios que tengan este supervisor asignado
        let supOid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) supOid = new ObjectId(currentUserId); } catch {}
        
        const agentes = await db.collection('users').find({
          $or: [
            { supervisorId: currentUserId },
            ...(supOid ? [{ supervisorId: supOid }] : [])
          ]
        }).toArray();
        
        console.log(`[INFO] Supervisor: encontrados ${agentes.length} agentes asignados`);
        
        // 2. Para cada agente, resolver su colección mapeada
        const uc = db.collection('user_collections');
        for (const agente of agentes) {
          const agenteId = agente._id?.toString?.() || String(agente._id);
          agentIds.push(agenteId);
          
          try {
            const mapping = await uc.findOne({ $or: [ { ownerId: agenteId }, { ownerId: agente._id } ] });
            if (mapping && mapping.collectionName) {
              agentCollections.add(mapping.collectionName);
              console.log(`[INFO] Agente ${agenteId} -> colección: ${mapping.collectionName}`);
            }
          } catch (e) {
            console.warn(`[WARN] Error resolviendo colección para agente ${agenteId}:`, e?.message);
          }
        }
      } catch (e) {
        console.warn('[WARN] Error obteniendo agentes del supervisor:', e?.message);
      }
      
      // Si no encontramos colecciones mapeadas, usar convención de nombres
      if (agentCollections.size === 0) {
        console.log('[INFO] No se encontraron colecciones mapeadas, intentando convención de nombres...');
        const allCollections = collections.map(c => c.name);
        
        // Buscar colecciones costumers_* que correspondan a los agentes
        for (const col of allCollections) {
          if (/^costumers_/i.test(col)) {
            agentCollections.add(col);
          }
        }
      }
      
      if (agentCollections.size === 0) {
        console.log('[WARN] Supervisor no tiene agentes asignados o no se encontraron colecciones');
        return res.json({
          success: true,
          data: [],
          total: 0,
          page,
          limit,
          message: 'El supervisor no tiene agentes asignados'
        });
      }
      
      console.log(`[INFO] Colecciones a consultar para supervisor: ${Array.from(agentCollections).join(', ')}`);
      
      let allCustomers = [];
      
      // Construir query base
      let baseQuery = {};
      
      // Aplicar filtros de fecha si existen
      if (fechaInicio && fechaFin) {
        baseQuery.creadoEn = {
          $gte: fechaInicio,
          $lte: fechaFin
        };
      } else if (fechaInicio) {
        baseQuery.creadoEn = { $gte: fechaInicio };
      } else if (fechaFin) {
        baseQuery.creadoEn = { $lte: fechaFin };
      }
      
      // Aplicar filtros adicionales
      if (req.query.status) {
        baseQuery.status = req.query.status;
      }
      
      console.log('[DEBUG] Query base para supervisor:', JSON.stringify(baseQuery, null, 2));
      
      // Consultar cada colección del supervisor
      for (const colName of agentCollections) {
        try {
          const docs = await db.collection(colName).find(baseQuery).toArray();
          if (docs.length > 0) {
            console.log(`[INFO] ${colName}: ${docs.length} documentos`);
            allCustomers = allCustomers.concat(docs);
          }
        } catch (colErr) {
          console.warn(`[WARN] Error consultando ${colName}:`, colErr.message);
        }
      }
      
      console.log(`[INFO] Total documentos agregados para supervisor: ${allCustomers.length}`);
      
      // Ordenar y aplicar paginación
      const sortField = req.query.sortBy || 'creadoEn';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      
      allCustomers.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        
        if (aVal instanceof Date && bVal instanceof Date) {
          return sortOrder * (aVal.getTime() - bVal.getTime());
        }
        
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder * aVal.localeCompare(bVal);
        }
        
        return sortOrder * ((aVal || 0) - (bVal || 0));
      });
      
      // Aplicar paginación
      const paginatedCustomers = allCustomers.slice(skip, skip + limit);
      
      console.log('Enviando respuesta con', paginatedCustomers.length, 'clientes (supervisor)');
      return res.json({
        success: true,
        data: paginatedCustomers,
        total: allCustomers.length,
        page,
        limit,
        aggregatedFromCollections: agentCollections.size
      });
    }

    // Default collection name is 'costumers'. However this project stores per-agent
    // collections like 'costumers_<agent>' and keeps a mapping in 'user_collections'.
    // Prefer a mapped collection when available for the requested agent.
    let collectionName = 'costumers';
    console.log(`Intentando acceder a la colección (default): ${collectionName}`);

    try {
      // If the request comes from an authenticated user who is an agent, try to
      // resolve their collection from the user_collections mapping.
      const uc = db.collection('user_collections');
      // Helper to fetch mapping by ownerId (string or ObjectId)
      const resolveMappingById = async (id) => {
        if (!id) return null;
        const idStr = String(id);
        const m = await uc.findOne({ $or: [ { ownerId: idStr }, { ownerId: { $in: [idStr] } }, { ownerId: id } ] });
        return m && m.collectionName ? m.collectionName : null;
      };

      // If agent explicitly requested via query ?agenteId or ?agentId, honor mapping for that id
      const agenteIdParamRaw = (req.query.agenteId || req.query.agentId || '').toString().trim();
      if (agenteIdParamRaw) {
        const mapped = await resolveMappingById(agenteIdParamRaw);
        if (mapped) {
          collectionName = mapped;
          console.log('[INFO] Using mapped collection for agenteId param:', collectionName);
        }
      }

      // If authenticated agent (role contains 'agente' or matches known agent roles), prefer their mapping
      if (req.user) {
        const roleLower = (req.user.role || '').toLowerCase();
        if (roleLower.includes('agente') || roleLower.includes('agent') || roleLower.includes('lineas-agentes')) {
          const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || ''));
          const mapped = await resolveMappingById(currentUserId);
          if (mapped) {
            collectionName = mapped;
            console.log('[INFO] Using mapped collection for current user:', collectionName);
          }
        }
      }
    } catch (e) {
      console.warn('[WARN] Could not resolve user_collections mapping:', e?.message);
    }
    
    // Verificar si la colección existe
    const collectionExists = collections.some(c => c.name === collectionName);
    if (!collectionExists) {
      console.error(`La colección "${collectionName}" no existe en la base de datos crmagente`);
      return res.status(404).json({
        success: false,
        message: `La colección "${collectionName}" no existe en la base de datos`,
        availableCollections: collections.map(c => c.name)
      });
    }
    
    const customersCollection = db.collection(collectionName);
    
    // Construir el filtro de consulta
    let query = {};
    const forceAllRaw = String(req.query.forceAll || 'false').toLowerCase();
    const forceAll = forceAllRaw === 'true' || forceAllRaw === '1';

    // Reglas de negocio de visibilidad:
    // - Agent: NUNCA puede ver "todos". Ignorar forceAll y filtrar por su propio agenteId.
    // - Supervisor: NUNCA puede ver "todos". Ignorar forceAll y filtrar por su equipo (agentes asignados a su supervisorId).
    // - Admin/Backoffice: pueden ver todos (sin filtro) y no necesitan forceAll.
    if (req.user) {
      const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || ''));
      const role = req.user?.role || '';
      console.log(`[DEBUG] Usuario autenticado - ID: ${currentUserId}, Rol: "${role}", Rol original: "${req.user.role}", forceAll=${forceAll}`);
      console.log(`[DEBUG] ¿Es supervisor? role === 'supervisor': ${role === 'supervisor'}, includes: ${role.includes('supervisor')}`);

      // Lista de posibles campos de asignación de agente en los documentos (IDs)
      const agentFieldCandidates = [
        'agenteId', 'agente_id', 'idAgente', 'agentId',
        'createdBy', 'creadoPor', 'creado_por',
        'ownerId', 'owner_id',
        'assignedId', 'assigned_to_id', 'assigned_toId',
        'salesAgentId', 'registeredById'
      ];

      if (role === 'Agentes' || role === 'Lineas-Agentes') {
        // Aplicar SIEMPRE filtro por su propio ID en múltiples variantes de campo
        let oid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) oid = new ObjectId(currentUserId); } catch {}
        const bothTypes = oid ? { $in: [currentUserId, oid] } : currentUserId;
        const idOr = agentFieldCandidates.map(f => ({ [f]: bothTypes }));

        // Fallback adicional por nombres del agente en campos de texto (case-insensitive)
        const nameCandidatesRaw = [req.user?.username, req.user?.name, req.user?.nombre, req.user?.fullName]
          .filter(v => typeof v === 'string' && v.trim().length > 0)
          .map(v => v.trim());
        const seen = new Set();
        const nameCandidates = nameCandidatesRaw.filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        const normalize = (s) => s.replace(/\s+/g, ' ').trim();
        const regexes = nameCandidates.map(n => {
          try {
            const escaped = normalize(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Coincidencia flexible (insensible a mayúsculas/minúsculas)
            return new RegExp(escaped, 'i');
          } catch { return null; }
        }).filter(Boolean);
        // Solo campos explícitos de agente para evitar sobre-inclusión
        const textFields = [
          'agente', 'agent', 'agenteNombre', 'agentName',
          'nombre_agente', 'agente_nombre'
        ];
        // Además, recopilar nombres reales en documentos que ya coinciden por ID (distinct)
        let dynamicNameRegexes = [];
        try {
          const baseMatch = { $or: idOr };
          const distinctPromises = textFields.map(f => db.collection('costumers').distinct(f, baseMatch));
          const distinctResults = await Promise.allSettled(distinctPromises);
          const fromDb = [];
          for (const r of distinctResults) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
              for (const v of r.value) {
                if (typeof v === 'string' && v.trim()) fromDb.push(v.trim());
              }
            }
          }
          const merged = [...nameCandidates, ...fromDb];
          const uniq = Array.from(new Set(merged.map(s => normalize(s).toLowerCase())));
          dynamicNameRegexes = uniq.map(k => {
            try { return new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } catch { return null; }
          }).filter(Boolean);
        } catch {}
        const allRegexes = (dynamicNameRegexes.length ? dynamicNameRegexes : regexes);
        const nameOrSimple = allRegexes.length ? textFields.map(f => ({ [f]: { $in: allRegexes } })) : [];

        // Condición: solo aceptar coincidencia por NOMBRE si no hay IDs establecidos (evitar traer de otros agentes)
        const idFields = ['agenteId','agente_id','idAgente','agentId','createdBy','creadoPor','creado_por','ownerId','assignedId'];
        const idEmptyOrMissing = {
          $and: idFields.map(f => ({ $or: [ { [f]: { $exists: false } }, { [f]: null }, { [f]: '' } ] }))
        };
        const nameAndIfNoIds = (nameOrSimple.length ? { $and: [ { $or: nameOrSimple }, idEmptyOrMissing ] } : null);

        query.$or = nameAndIfNoIds ? [...idOr, nameAndIfNoIds] : [...idOr];
        console.log('[DEBUG] Rol agent: forceAll ignorado. Filtro por IDs aplicado en:', agentFieldCandidates, ' y fallback por nombre en campos:', textFields, ' names:', nameCandidates);
      } else if (role === 'supervisor' || role.includes('supervisor')) {
        // Ver solo los de su equipo (soportar ObjectId y string) SIEMPRE
        // 1) Intentar por IDs de agentes que tengan supervisorId = currentUserId (string u ObjectId)
        let supOid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) supOid = new ObjectId(currentUserId); } catch {}
        const agentes = await db.collection('users').find({
          $or: [
            { supervisorId: currentUserId },
            ...(supOid ? [{ supervisorId: supOid }] : [])
          ]
        }).toArray();
        const agentesIds = agentes.map(a => a._id).filter(Boolean);
        // Incluir también el propio ID del supervisor por si tiene asignaciones directas
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) agentesIds.push(new ObjectId(currentUserId)); } catch {}
        const bothTypesArray = [];
        agentesIds.forEach(id => { bothTypesArray.push(id, id.toString()); });
        const idInFilter = bothTypesArray.length ? { $in: bothTypesArray } : null;

        // 2) Fallback adicional por campos de texto de supervisor y/o nombre del supervisor en documentos
        //    Esto cubre casos donde los usuarios-agente no tienen supervisorId poblado en la colección users.
        const supNameCandidatesRaw = [req.user?.username, req.user?.name, req.user?.nombre, req.user?.fullName]
          .filter(v => typeof v === 'string' && v.trim().length > 0)
          .map(v => v.trim());
        const seenSup = new Set();
        const supNameCandidates = supNameCandidatesRaw.filter(n => { const k = n.toLowerCase(); if (seenSup.has(k)) return false; seenSup.add(k); return true; });
        const normalize = (s) => s.replace(/\s+/g, ' ').trim();
        // Agregar variantes: partes del nombre (nombre, apellido) para coincidir con "ROBERTO" cuando el user es "Roberto Velasquez"
        const allSupVariants = [];
        supNameCandidates.forEach(n => {
          allSupVariants.push(n);
          n.split(/\s+/).filter(p => p.length > 2).forEach(p => allSupVariants.push(p));
        });
        console.log('[DEBUG] Supervisor variantes de búsqueda:', allSupVariants);
        const supRegexes = allSupVariants.map(n => {
          try {
            const escaped = normalize(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(escaped, 'i');
          } catch { return null; }
        }).filter(Boolean);
        const supervisorTextFields = ['supervisor','team','teamName','supervisorName','supervisor_nombre','supervisorNombre'];
        const supervisorTextOr = supRegexes.length ? supervisorTextFields.map(f => ({ [f]: { $in: supRegexes } })) : [];

        // 2b) Fallback por NOMBRES DE LOS AGENTES DEL EQUIPO en campos de texto de agente
        //     Útil cuando los documentos solo guardan nombre del agente y no ID.
        const agentTextFields = [
          'agente','agent','agenteNombre','agentName','nombre_agente','agente_nombre','createdByName',
          'vendedor','seller','salesAgent','nombreAgente','ejecutivo',
          'asignadoA','asignado_a','assignedTo','assigned_to',
          'usuario','owner','registeredBy','ownerName'
        ];
        const agentNameCandidatesRaw = [];
        try {
          for (const a of agentes) {
            const vals = [a?.username, a?.name, a?.nombre, a?.fullName].filter(v => typeof v === 'string' && v.trim());
            vals.forEach(v => agentNameCandidatesRaw.push(v.trim()));
          }
        } catch {}
        // Si no encontramos nombres por users, intentar derivarlos desde la colección costumers
        if (agentNameCandidatesRaw.length === 0 && supRegexes.length) {
          try {
            const supOr = { $or: supervisorTextFields.map(f => ({ [f]: { $in: supRegexes } })) };
            const namesFromCostumers = new Set();
            for (const f of agentTextFields) {
              try {
                const vals = await db.collection('costumers').distinct(f, supOr);
                (vals || []).forEach(v => { if (typeof v === 'string' && v.trim()) namesFromCostumers.add(v.trim()); });
              } catch {}
            }
            if (namesFromCostumers.size) {
              agentNameCandidatesRaw.push(...Array.from(namesFromCostumers));
            }
          } catch {}
        }
        const seenAgent = new Set();
        const agentNameCandidates = agentNameCandidatesRaw.filter(n => { const k = normalize(n).toLowerCase(); if (seenAgent.has(k)) return false; seenAgent.add(k); return true; });
        const agentNameRegexes = agentNameCandidates.map(n => {
          try { return new RegExp(normalize(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } catch { return null; }
        }).filter(Boolean);
        const agentNamesTextOr = agentNameRegexes.length ? agentTextFields.map(f => ({ [f]: { $in: agentNameRegexes } })) : [];

        // 3) Construir query.$or combinando ID de agentes (si existe) y fallback por supervisor en texto (si existe)
        const orConds = [];
        // Diagnóstico: si ?debug=1, contar por sub-condición antes de fijar query.$or
        const debugFlag = (req.query && (req.query.debug === '1' || req.query.debug === 'true'));
        if (debugFlag) {
          try {
            const baseQuery = { ...query };
            delete baseQuery.$or;
            const col = db.collection('costumers');
            console.log('[DEBUG] Supervisor diag - agentesIds (bothTypesArray):', (bothTypesArray||[]).map(x=>x.toString()));
            console.log('[DEBUG] Supervisor diag - supNameCandidates:', supNameCandidates);
            console.log('[DEBUG] Supervisor diag - agentNameCandidates:', agentNameCandidates);
            if (idInFilter) {
              const idsOr = agentFieldCandidates.map(f => ({ [f]: idInFilter }));
              const c1 = await col.countDocuments({ ...baseQuery, $or: idsOr });
              console.log('[DEBUG] Subcuenta supervisor - IDs de agentes coincide:', c1);
            }
            if (supervisorTextOr.length) {
              const c2 = await col.countDocuments({ ...baseQuery, $or: supervisorTextOr });
              console.log('[DEBUG] Subcuenta supervisor - Texto de supervisor coincide:', c2);
            }
            if (agentNamesTextOr.length) {
              const c3 = await col.countDocuments({ ...baseQuery, $or: agentNamesTextOr });
              console.log('[DEBUG] Subcuenta supervisor - Nombres de agentes coincide:', c3);
            }
          } catch (e) {
            console.warn('[WARN] Error en diagnóstico supervisor (?debug=1):', e?.message);
          }
        }
        if (idInFilter) {
          orConds.push(...agentFieldCandidates.map(f => ({ [f]: idInFilter })));
        }
        if (supervisorTextOr.length) {
          orConds.push(...supervisorTextOr);
        }
        if (agentNamesTextOr.length) {
          orConds.push(...agentNamesTextOr);
        }
        // Si por algún motivo no hay condiciones, asegurar que no devuelva todo (forzar none)
        query.$or = orConds.length ? orConds : [{ _id: null }];
        console.log('[DEBUG] Rol supervisor: forceAll ignorado. Filtro aplicado. IDs agentes:', bothTypesArray.map(x=>x.toString()), ' | Campos supervisor:', supervisorTextFields, ' | Nombres sup:', supNameCandidates, ' | Campos agente:', agentTextFields, ' | Nombres agentes:', agentNameCandidates);
      } else {
        // Solo roles privilegiados ven todo; para cualquier otro rol, filtrar por su propio ID
        const privileged = ['administrador','admin','backoffice'];
        if (privileged.includes(role)) {
          console.log('[DEBUG] Rol privilegiado: sin filtro por agenteId');
        } else {
          // Filtro estricto por ID del usuario
          let oid = null;
          try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) oid = new ObjectId(currentUserId); } catch {}
          const bothTypes = oid ? { $in: [currentUserId, oid] } : currentUserId;
          const agentFieldCandidates = [
            'agenteId','agente_id','idAgente','agentId','createdBy','creadoPor','creado_por','ownerId','assignedId'
          ];
          query.$or = agentFieldCandidates.map(f => ({ [f]: bothTypes }));
          console.log('[DEBUG] Rol no privilegiado: aplicando filtro propio por ID en campos:', agentFieldCandidates);
        }
      }

      console.log(`[DEBUG] Filtro aplicado:`, JSON.stringify(query, null, 2));
    }
    
    // Filtro por agenteId directo si se especifica via query ?agenteId=
    // Alias: aceptar también ?agentId=
    const agenteIdParamRaw = (req.query.agenteId || req.query.agentId || '').toString().trim();
    if (agenteIdParamRaw) {
      console.log('[DEBUG] Parámetro agenteId recibido:', agenteIdParamRaw);
      if (req.user && (role === 'agentes' || role === 'lineas-agentes' || role === 'agent')) {
        // Un agente siempre se filtra a sí mismo 
        const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || ''));
        // Mantener restricción propia, ignorando el parámetro explícito
        let oid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) oid = new ObjectId(currentUserId); } catch {}
        const bothTypes = oid ? { $in: [currentUserId, oid] } : currentUserId;
        const agentFieldCandidates = ['agenteId', 'agente_id', 'idAgente', 'agentId', 'createdBy', 'creadoPor', 'creado_por', 'ownerId', 'assignedId'];
        query.$or = agentFieldCandidates.map(f => ({ [f]: bothTypes }));
        console.log('[DEBUG] Rol agent + agenteId param: se aplica filtro propio en múltiples campos');
      } else {
        // Soportar ObjectId y string
        let oid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(agenteIdParamRaw)) oid = new ObjectId(agenteIdParamRaw); } catch {}
        const bothTypes = oid ? { $in: [oid, agenteIdParamRaw] } : agenteIdParamRaw;
        const agentFieldCandidates = ['agenteId', 'agente_id', 'idAgente', 'agentId', 'createdBy', 'creadoPor', 'creado_por', 'ownerId', 'assignedId'];
        const paramOr = agentFieldCandidates.map(f => ({ [f]: bothTypes }));
        // Regla: si el usuario es supervisor, honrar SIEMPRE el agenteId explícito y además incluir filtro por NOMBRE del agente
        if (userRole === 'supervisor') {
          let nameOr = [];
          try {
            const usersColl = db.collection('users');
            const idsToTry = [];
            if (oid) idsToTry.push(oid);
            // Si recibimos cadena válida tipo ObjectId, agregarla
            try { if (!oid && ObjectId.isValid(agenteIdParamRaw)) idsToTry.push(new ObjectId(agenteIdParamRaw)); } catch {}
            let candidateUsers = [];
            if (idsToTry.length) {
              candidateUsers = await usersColl.find({ _id: { $in: idsToTry } }).project({ username:1, name:1, nombre:1, fullName:1 }).toArray();
            }
            const names = new Set();
            candidateUsers.forEach(u => {
              [u?.username, u?.name, u?.nombre, u?.fullName].forEach(v => { if (v && String(v).trim()) names.add(String(v).trim()); });
            });
            // Considerar también el propio agenteId en texto (algunos documentos guardan el id como string en campos de texto)
            if (String(agenteIdParamRaw).trim()) names.add(String(agenteIdParamRaw).trim());
            const textFields = ['agente','agent','agenteNombre','agentName','nombreAgente','vendedor','seller','salesAgent','asignadoA','assignedTo','usuario','owner','registeredBy','ownerName'];
            const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\]/g,'\\]');
            const stripDiacritics = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu,'');
            const collapse = (s) => stripDiacritics(String(s)).replace(/\s+/g,'').replace(/[^\p{L}\p{N}]/gu,'');
            const makeVariants = (raw) => {
              const base = String(raw).trim();
              if (!base) return [];
              const noDiac = stripDiacritics(base);
              const collapsed = collapse(base);
              // patrón con espacios opcionales entre palabras
              const spaceOptional = noDiac.replace(/\s+/g, '\\s*');
              return [base, noDiac, collapsed, spaceOptional];
            };
            const namesWithVariants = new Set();
            for (const n of names) {
              makeVariants(n).forEach(v => namesWithVariants.add(v));
            }
            const regexes = [...namesWithVariants].map(n => { try { return new RegExp(escapeRe(n), 'i'); } catch { return null; } }).filter(Boolean);
            nameOr = regexes.length ? textFields.map(f => ({ [f]: { $in: regexes } })) : [];
          } catch (e) {
            console.warn('[DEBUG] No se pudieron resolver nombres para agenteId (fallback solo IDs):', e?.message);
          }
          query.$or = nameOr.length ? [...paramOr, ...nameOr] : paramOr;
          console.log('[DEBUG] Rol supervisor + agenteId param: filtro por IDs y nombres aplicado.');
        } else {
          // Para otros roles, intentar intersección si ya existe filtro previo
          if (query.$or && Array.isArray(query.$or) && query.$or.length) {
            const allowed = [];
            query.$or.forEach(cond => {
              const k = Object.keys(cond)[0];
              const v = cond[k];
              if (v && v.$in) allowed.push(...v.$in.map(x=>x.toString()));
            });
            const candidates = Array.isArray(bothTypes.$in) ? bothTypes.$in.map(x=>x.toString()) : [bothTypes.toString()];
            const overlap = candidates.some(x => allowed.includes(x));
            query.$or = overlap ? paramOr : [{ _id: new ObjectId('000000000000000000000000') }];
          } else {
            query.$or = paramOr;
          }
        }
      }
    }

    // Filtro adicional por agente si se especifica via query ?agente=
    let agenteParam = (req.query.agente || '').toString().trim();
    // Aceptar parámetros alternos de nombre y unificarlos en agenteParam
    if (!agenteParam) {
      const altNameKeys = ['agenteNombre','nombreAgente','agent','agentName','vendedor','salesAgent','asignadoA','assignedTo','usuario','owner','registeredBy','ownerName'];
      for (const k of altNameKeys) {
        const v = (req.query[k] || '').toString().trim();
        if (v) { agenteParam = v; break; }
      }
    }
    if (!agenteIdParamRaw && agenteParam) {
      console.log('[DEBUG] Parámetro agente recibido:', agenteParam);
      // Si el usuario autenticado es 'agent', forzamos su propio ID y omitimos el parámetro
      if (req.user && (role === 'agentes' || role === 'lineas-agentes' || role === 'agent')) {
        console.log('[DEBUG] Rol agent: ignorando parámetro agente y usando su propio ID con filtro tolerante');
        const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || ''));
        // Construir filtro robusto por múltiples campos de ID con soporte string y ObjectId
        let oid = null;
        try { if (/^[a-fA-F0-9]{24}$/.test(currentUserId)) oid = new ObjectId(currentUserId); } catch {}
        const bothTypes = oid ? { $in: [currentUserId, oid] } : currentUserId;
        const agentFieldCandidates = ['agenteId', 'agente_id', 'idAgente', 'agentId', 'createdBy', 'creadoPor', 'creado_por', 'ownerId', 'assignedId'];
        const idOr = agentFieldCandidates.map(f => ({ [f]: bothTypes }));

        // Fallback por nombre SOLO si todos los campos de ID del documento están vacíos/ausentes
        const nameCandidatesRaw = [req.user?.username, req.user?.name, req.user?.nombre, req.user?.email]
          .filter(v => typeof v === 'string' && v.trim().length > 0)
          .map(v => v.trim());
        const unique = new Set();
        const nameCandidates = nameCandidatesRaw.filter(n => { const k = n.toLowerCase(); if (unique.has(k)) return false; unique.add(k); return true; });
        const regexes = nameCandidates.map(n => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        const textFields = ['agente', 'agent', 'agenteNombre', 'agentName'];
        const nameOrSimple = regexes.length ? textFields.map(f => ({ [f]: { $in: regexes } })) : [];
        const idEmptyOrMissing = { $and: agentFieldCandidates.map(f => ({ $or: [ { [f]: { $exists: false } }, { [f]: null }, { [f]: '' } ] })) };
        const nameAndIfNoIds = (nameOrSimple.length ? { $and: [ { $or: nameOrSimple }, idEmptyOrMissing ] } : null);

        query.$or = nameAndIfNoIds ? [...idOr, nameAndIfNoIds] : [...idOr];
        console.log('[DEBUG] Filtro agent aplicado (IDs + fallback por nombre si faltan IDs)');
      } else {
        // Intentar resolver por ObjectId válido
        let resolvedId = null;
        let resolvedIds = null; // soporte para múltiples coincidencias por nombre
        try {
          if (/^[a-fA-F0-9]{24}$/.test(agenteParam)) {
            resolvedId = new ObjectId(agenteParam);
          }
        } catch {}
        // Si no es ObjectId, resolver por nombre/username en colección users
        if (!resolvedId) {
          try {
            const safe = agenteParam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(safe, 'i');
            const usuarios = await db.collection('users').find({
              $or: [
                { username: rx },
                { name: rx },
                { nombre: rx },
                { fullName: rx }
              ]
            }, { projection: { _id: 1 } }).toArray();
            if (usuarios.length > 0) {
              resolvedIds = usuarios.map(u => u._id);
              console.log(`[DEBUG] Coincidencias de usuarios para agente="${agenteParam}":`, resolvedIds.map(x => x.toString()));
            }
          } catch (e) {
            console.warn('[WARN] Error buscando usuarios por regex para agente:', e?.message);
          }
        }
        // Si se pudo resolver a uno o varios IDs, filtrar por agenteId
        if (resolvedId || (resolvedIds && resolvedIds.length)) {
          const ids = resolvedIds && resolvedIds.length ? resolvedIds : [resolvedId];
          const bothTypesArray = [];
          ids.forEach(id => { bothTypesArray.push(id, id.toString()); });
          const bothTypes = { $in: bothTypesArray };
          if (query.agenteId && query.agenteId.$in) {
            const allowed = query.agenteId.$in.map(x => x.toString());
            const overlap = bothTypesArray.some(x => allowed.includes(x.toString()));
            if (overlap) {
              query.agenteId = bothTypes;
            } else {
              query.agenteId = new ObjectId('000000000000000000000000');
            }
          } else {
            query.agenteId = bothTypes;
          }
          console.log('[DEBUG] Filtro por agenteId aplicado (ids encontrados):', bothTypesArray.map(x=>x.toString()));
        } else {
          // Como fallback, filtrar por campos de texto presentes en costumers
          // con coincidencia PARCIAL (case-insensitive)
          const safe = agenteParam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const containsCI = new RegExp(safe, 'i');
          query.$or = [
            { agente: containsCI },
            { agent: containsCI },
            { agenteNombre: containsCI },
            { agentName: containsCI }
          ];
          console.log('[DEBUG] Filtro por nombre de agente (texto, partial, i) aplicado:', agenteParam);
        }
      }
    }

    // Aplicar filtro por rango de fechas si viene en la query (usar campo 'creadoEn')
    if (fechaInicio || fechaFin) {
      query.creadoEn = {};
      if (fechaInicio) {
        query.creadoEn.$gte = fechaInicio;
      }
      if (fechaFin) {
        const finDia = new Date(fechaFin);
        finDia.setHours(23, 59, 59, 999);
        query.creadoEn.$lte = finDia;
      }
    }

    // Obtener el total de documentos para la paginación
    // Log detallado del query final y parámetros recibidos para diagnóstico
    try {
      console.log('[DEBUG] req.query recibido en /api/customers:', JSON.stringify(req.query));
      console.log('[DEBUG] Query final a usar en MongoDB:', JSON.stringify(query));
    } catch { /* noop */ }
    const total = await customersCollection.countDocuments(query);
    console.log(`Total de documentos en la colección: ${total}`);
    
    // Consulta con paginación y orden dinámico (por defecto: creadoEn desc)
    const rawSortBy = (req.query.sortBy || '').toString().trim();
    const rawOrder = (req.query.order || 'desc').toString().trim().toLowerCase();
    const allowedSortFields = {
      creadoEn: 'creadoEn',
      actualizadoEn: 'actualizadoEn',
      dia_venta: 'dia_venta',
      fecha_contratacion: 'fecha_contratacion',
      fecha: 'fecha',
      status: 'status',
      puntaje: 'puntaje',
      riesgo: 'riesgo',
      agenteNombre: 'agenteNombre',
      agente: 'agente',
      agenteId: 'agenteId'
    };
    const sortField = allowedSortFields[rawSortBy] || 'creadoEn';
    const sortDir = rawOrder === 'asc' ? 1 : -1;
    const sortSpec = { [sortField]: sortDir };
    console.log('[DEBUG] Orden aplicándose:', sortSpec);

    const customers = await customersCollection
      .find(query)
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .toArray();

    console.log(`Documentos encontrados: ${customers.length}`);
    if (customers.length > 0) {
      console.log('Primer documento de ejemplo:', JSON.stringify(customers[0], null, 2));
    }

    // Helpers de enriquecimiento
    const norm = (s) => {
      try { return String(s || '').normalize('NFD').replace(/\p{Diacritic}+/gu,'').trim().toLowerCase().replace(/\s+/g,' ');} catch { return ''; }
    };
    const AGENT_TO_SUP = new Map([
      // TEAM IRANIA
      ['josue renderos','irania serrano'],
      ['tatiana ayala','irania serrano'],
      ['giselle diaz','irania serrano'],
      ['miguel nunez','irania serrano'],
      ['roxana martinez','irania serrano'],
      ['irania serrano','irania serrano'],
      // TEAM BRYAN PLEITEZ
      ['abigail galdamez','bryan pleitez'],
      ['alexander rivera','bryan pleitez'],
      ['diego mejia','bryan pleitez'],
      ['evelin garcia','bryan pleitez'],
      ['fabricio panameno','bryan pleitez'],
      ['luis chavarria','bryan pleitez'],
      ['steven varela','bryan pleitez'],
      // TEAM ROBERTO VELASQUEZ
      ['cindy flores','roberto velasquez'],
      ['daniela bonilla','roberto velasquez'],
      ['francisco aguilar','roberto velasquez'],
      ['levy ceren','roberto velasquez'],
      ['lisbeth cortez','roberto velasquez'],
      ['lucia ferman','roberto velasquez'],
      ['nelson ceren','roberto velasquez'],
      // TEAM RANDAL MARTINEZ
      ['anderson guzman','randal martinez'],
      ['carlos grande','randal martinez'],
      ['guadalupe santana','randal martinez'],
      ['julio chavez','randal martinez'],
      ['priscila hernandez','randal martinez'],
      ['riquelmi torres','randal martinez']
    ]);
    const inferSupervisorByAgent = (agentName) => {
      const key = norm(agentName);
      return key ? (AGENT_TO_SUP.get(key) || '') : '';
    };
    const extractZipFromAddress = (addr) => {
      try {
        const s = String(addr || '');
        const m = s.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/); // último ZIP de 5 dígitos
        return m ? m[1] : '';
      } catch { return ''; }
    };
    const getByPath = (obj, path) => {
      try { return path.split('.').reduce((o, k) => (o && o[k] !== undefined && o[k] !== null) ? o[k] : undefined, obj); } catch { return undefined; }
    };
    const firstOf = (obj, paths) => {
      for (const p of paths) {
        const v = p.includes('.') ? getByPath(obj, p) : (obj ? obj[p] : undefined);
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return undefined;
    };
    const enrichMode = (req.query.enrich === '1' || req.query.enrich === 'true');

    const mappedCustomers = customers.map(customer => {
      const sistemaVal = firstOf(customer, [
        'sistema','system','sistema_operativo','platform','plataforma',
        '_raw.sistema','_raw.system','_raw.platform','_raw.plataforma'
      ]);
      const mapped = {
        ...customer,
        sistema: (sistemaVal && String(sistemaVal).trim()) ? sistemaVal : 'N/A'
      };

      // Normalizar booleanos para visualización
      if (typeof mapped.autopago === 'boolean') {
        mapped.autopago = mapped.autopago ? 'Sí' : 'No';
      }

      // Enriquecimientos finales opcionales (solo si enrich=1)
      if (enrichMode) {
        if ((!mapped.supervisor || mapped.supervisor === '') && mapped.agenteNombre) {
          const sup = inferSupervisorByAgent(mapped.agenteNombre);
          if (sup) mapped.supervisor = sup;
        }
        if ((!mapped.zip_code || mapped.zip_code === '') && mapped.direccion) {
          const zip = extractZipFromAddress(mapped.direccion);
          if (zip) mapped.zip_code = zip;
        }
      }

      return mapped;
    });
    
    // Construir respuesta (con debug opcional enriquecido)
    const debugMode = (req.query.debug === '1' || req.query.debug === 'true');
    const sampleCount = Math.min(mappedCustomers.length, 3);
    const samples = debugMode ? customers.slice(0, sampleCount) : [];
    const enrich = (req.query.enrich === '1' || req.query.enrich === 'true');

    const response = {
      success: true,
      leads: mappedCustomers,
      total,
      page,
      pages: Math.ceil(total / limit),
      message: 'Datos de clientes cargados correctamente',
      debug: debugMode ? {
        collection: collectionName,
        database: db.databaseName,
        totalDocuments: total,
        documentsReturned: mappedCustomers.length,
        availableCollections: collections.map(c => c.name),
        sampleOriginalKeys: samples.map((s, i) => ({ idx: i, keys: Object.keys(s) })),
        sampleMappedKeys: mappedCustomers.slice(0, sampleCount).map((m, i) => ({ idx: i, keys: Object.keys(m) })),
        sampleOriginalDocs: samples,
        sampleMappedDocs: mappedCustomers.slice(0, sampleCount),
        enrich
      } : undefined
    };
    
    console.log('Enviando respuesta con', mappedCustomers.length, 'clientes');
    res.json(response);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar los clientes',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Resumen de agentes disponibles en la data de clientes (diagnóstico)
app.get('/api/customers/agents-summary', protect, async (req, res) => {
  try {
    if (!db) await connectToMongoDB();
    const coll = db.collection('costumers');
    // Agrupar por agenteId y agenteNombre para ver cuántos clientes tiene cada agente
    const pipeline = [
      {
        $group: {
          _id: { id: '$agenteId', nombre: '$agenteNombre' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ];
    const rows = await coll.aggregate(pipeline).toArray();
    // También recolectar valores de campos alternos por si los datos usan otras llaves
    const distintos = {
      agente: await coll.distinct('agente'),
      agent: await coll.distinct('agent'),
      agenteNombre: await coll.distinct('agenteNombre'),
      agentName: await coll.distinct('agentName')
    };
    return res.json({
      success: true,
      summary: rows.map(r => ({ agenteId: r._id.id || null, agenteNombre: r._id.nombre || null, count: r.count })),
      distincts: distintos
    });
  } catch (e) {
    console.error('[agents-summary] error:', e);
    return res.status(500).json({ success: false, message: 'Error generando resumen de agentes', error: e.message });
  }
});

// Middleware para verificar autenticación
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.redirect('/login.html');
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.redirect('/login.html');
    }
    req.user = user;
    next();
  });
};

// Ruta raíz - Redirigir a login.html
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Ruta de la aplicación principal (protección vía frontend con auth-check.js)
app.get('/inicio', (req, res) => {
  res.sendFile(path.join(__dirname, 'lead.html'));
});

// Ruta protegida para Costumer.html (solo administradores)
app.get('/Costumer.html', protect, (req, res, next) => {
  // Verificar si el usuario es administrador
  if (req.user && req.user.role === 'admin') {
    // Si es administrador, servir el archivo
    return res.sendFile(path.join(__dirname, 'Costumer.html'));
  } else {
    // Si no es administrador, redirigir a página de inicio con mensaje de error
    return res.redirect('/inicio?error=Acceso denegado. Se requiere rol de administrador.');
  }
});

// NOTA: Ruta catch-all movida al final del archivo para no interceptar APIs

// Conexión a MongoDB
let mongoClient; // Variable para mantener la referencia al cliente
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/crmagente';

// La función connectToMongoDB ahora se importa desde ./config/db.js

// --- ENDPOINT DUPLICADO DESHABILITADO ---
// Este endpoint fue movido a routes/api.js para manejar todos los roles
/*
app.get('/api/leads', protect, (req, res, next) => {
  // Verificar si el usuario es administrador
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado. Se requiere rol de administrador.'
    });
  }
  next();
}, async (req, res) => {
  try {
    const { 
      page, 
      limit = 10, 
      status, 
      desde, 
      hasta,
      telefono,
      // Parámetros específicos para gráficas
      agente,
      fechaInicio,
      fechaFin,
      // Flag para indicar si se necesitan datos para gráfica
      paraGrafica = 'false'
    } = req.query;
    
    // Si es para gráfica, devolver datos agregados
    if (paraGrafica === 'true') {
      const filtro = {};
      
      // Aplicar filtros según el rol del usuario
      if (req.user) {
        // Si es agente, solo ver sus datos
        if (req.user.role === 'agent') {
          filtro.agenteId = req.user.id;
        }
        // Si es supervisor, ver datos de su equipo
        else if (req.user.role === 'supervisor') {
          const agentes = await db.collection('users').find({ 
            supervisorId: req.user.id 
          }).toArray();
          
          const agentesIds = agentes.map(a => a._id);
          agentesIds.push(new ObjectId(req.user.id));
          
          filtro.agenteId = { $in: agentesIds };
        }
        // Admin no necesita filtro (ve todo)
      }
      
      // Filtro adicional por agente si se especifica
      if (agente) {
        filtro.agenteId = agente;
      }
      
      // Filtrar por rango de fechas si se proporciona
      if (fechaInicio || fechaFin) {
        filtro.creadoEn = {};
        if (fechaInicio) {
          filtro.creadoEn.$gte = new Date(fechaInicio);
        }
        if (fechaFin) {
          // Ajustar para incluir todo el día
          const finDia = new Date(fechaFin);
          finDia.setHours(23, 59, 59, 999);
          filtro.creadoEn.$lte = finDia;
        }
      }
      
      console.log('Consultando leads con filtro para gráfica:', JSON.stringify(filtro, null, 2));

        // Resolver colección objetivo según rol/usuario (agente -> su colección)
        async function resolveCollectionForUser() {
          function sanitizeName(s) {
            if (!s) return '';
            return String(s).trim().replace(/[^a-zA-Z0-9\s\-_.]/g, '').replace(/\s+/g, '_').replace(/__+/g, '_').slice(0, 90);
          }
          const ownerName = req.user?.username || req.user?.agenteNombre || req.user?.name || null;
          const ownerId = req.user?.id || req.user?.agenteId || null;
          // Only attempt per-agent collection for agents
          const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : '';
          if (role === 'agent' || role === 'agente') {
            if (ownerName) {
              const sanitized = sanitizeName(ownerName);
              const short = ownerId ? String(ownerId).replace(/[^a-zA-Z0-9]/g,'').slice(0,6) : null;
              const candidates = [];
              if (short) candidates.push(`costumers_${sanitized}_${short}`);
              candidates.push(`costumers_${sanitized}`);
              for (const c of candidates) {
                const exists = await db.listCollections({ name: c }).hasNext ? (await db.listCollections({ name: c }).toArray()).length > 0 : (await db.listCollections({ name: c }).toArray()).length > 0;
                if (exists) return c;
              }
            }
            // fallback to costumers
            return 'costumers';
          }
          // non-agents keep using global collection for now
          return 'costumers';
        }

        const targetCollectionForGraph = await resolveCollectionForUser();
        // Obtener los leads que coincidan con el filtro
        const leads = await db.collection(targetCollectionForGraph).find(filtro).toArray();
      
      // Procesar los datos para la gráfica
      const datosGrafica = [];
      const ventasPorDia = {};
      
      leads.forEach(lead => {
        if (!lead.creadoEn) return;
        
        const fecha = new Date(lead.creadoEn);
        const fechaStr = fecha.toISOString().split('T')[0];
        
        if (!ventasPorDia[fechaStr]) {
          ventasPorDia[fechaStr] = {
            fecha: fechaStr,
            ventas: 0,
            puntaje: 0,
            conteo: 0
          };
        }
        
        ventasPorDia[fechaStr].ventas += 1;
        ventasPorDia[fechaStr].puntaje += Number(lead.puntaje) || 0;
        ventasPorDia[fechaStr].conteo += 1;
      });
      
      // Calcular promedios y formatear datos para la gráfica
      Object.values(ventasPorDia).forEach(dia => {
        datosGrafica.push({
          fecha: dia.fecha,
          ventas: dia.ventas,
          puntaje: dia.conteo > 0 ? dia.puntaje / dia.conteo : 0
        });
      });
      
      // Ordenar por fecha
      datosGrafica.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      
      console.log(`Datos de gráfica generados: ${datosGrafica.length} puntos de datos`);
      
      // Asegurarse de que la respuesta sea JSON
      res.setHeader('Content-Type', 'application/json');
      return res.json(datosGrafica);
    }
    
    // Si no es para gráfica, devolver datos paginados
    const skip = page ? (parseInt(page) - 1) * parseInt(limit) : 0;
    const query = {};
    
    // Aplicar filtros
    if (status) query.status = status;
    if (telefono) query.telefono_principal = { $regex: telefono, $options: 'i' };
    
    // Filtrar por rango de fechas
    if (desde || hasta) {
      query.fecha_creacion = {};
      if (desde) query.fecha_creacion.$gte = new Date(desde);
      if (hasta) {
        const hastaDate = new Date(hasta);
        hastaDate.setHours(23, 59, 59, 999);
        query.fecha_creacion.$lte = hastaDate;
      }
    }
    
    // Resolve target collection based on user role (agents -> their collection)
    async function resolveCollectionForUserSimple() {
      function sanitizeName(s) {
        if (!s) return '';
        return String(s).trim().replace(/[^a-zA-Z0-9\s\-_.]/g, '').replace(/\s+/g, '_').replace(/__+/g, '_').slice(0, 90);
      }
      const ownerName = req.user?.username || req.user?.agenteNombre || req.user?.name || null;
      const ownerId = req.user?.id || req.user?.agenteId || null;
      const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : '';
      if (role === 'agent' || role === 'agente') {
        if (ownerName) {
          const sanitized = sanitizeName(ownerName);
          const short = ownerId ? String(ownerId).replace(/[^a-zA-Z0-9]/g,'').slice(0,6) : null;
          const candidates = [];
          if (short) candidates.push(`costumers_${sanitized}_${short}`);
          candidates.push(`costumers_${sanitized}`);
          for (const c of candidates) {
            const exists = (await db.listCollections({ name: c }).toArray()).length > 0;
            if (exists) return c;
          }
        }
        return 'costumers';
      }
      return 'costumers';
    }

    const targetCollection = await resolveCollectionForUserSimple();
    const [leads, total] = await Promise.all([
      db.collection(targetCollection)
        .find(query)
        .sort({ fecha_creacion: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray(),
      db.collection(targetCollection).countDocuments(query)
    ]);
    
    res.json({ 
      success: true, 
      data: leads,
      pagination: {
        total,
        page: parseInt(page || 1),
        totalPages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit)
      }
    });
    
  } catch (error) {
    console.error('Error al obtener los leads:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al cargar los leads',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Función para eliminar el índice único de telefono_principal si existe
async function removeUniqueIndexIfExists() {
  try {
    const indexes = await db.collection('costumers').indexes();
    const telefonoIndex = indexes.find(index => 
      index.key && index.key.telefono_principal === 1 && index.unique
    );
    
    if (telefonoIndex) {
      console.log('Eliminando índice único de telefono_principal...');
      await db.collection('costumers').dropIndex(telefonoIndex.name);
      console.log('Índice único eliminado exitosamente');
    } else {
      console.log('No se encontró un índice único en telefono_principal');
    }
  } catch (error) {
    console.error('Error al verificar/eliminar índices:', error);
  }
}

// Endpoint para crear un nuevo cliente (customer)
app.post('/api/customers', protect, async (req, res) => {
  // Configuración CORS
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', true);
  
  // Manejar preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    console.log('=== NUEVA SOLICITUD EN /api/customers ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body recibido:', JSON.stringify(req.body, null, 2));
    
    if (!req.body) {
      console.error('Error: No se recibieron datos en el cuerpo de la petición');
      return res.status(400).json({
        success: false,
        message: 'No se recibieron datos en la petición'
      });
    }
    
    const customerData = req.body;
    
    // Verificar autenticación
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado. Debe iniciar sesión para crear clientes.'
      });
    }

    // Validar que la conexión a la base de datos esté activa
    if (!db) {
      console.error('Error: No hay conexión a la base de datos');
      return res.status(500).json({
        success: false,
        message: 'Error de conexión con la base de datos'
      });
    }

    // Normalizar datos
    if (customerData.telefono && !customerData.telefono_principal) {
      customerData.telefono_principal = customerData.telefono;
    }

    // Validar datos requeridos
    const requiredFields = ['telefono_principal', 'nombre_cliente', 'direccion'];
    const missingFields = requiredFields.filter(field => !customerData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos requeridos: ${missingFields.join(', ')}`
      });
    }

    // Eliminada la validación de duplicados para permitir guardar cualquier cliente
    // Agregar fechas de creación y actualización
    const now = new Date();
    
    // Depuración: Mostrar información del usuario autenticado
    console.log('=== INFORMACIÓN DEL USUARIO AUTENTICADO ===');
    console.log('Usuario completo:', JSON.stringify(req.user, null, 2));
    console.log('ID del usuario:', req.user?.id);
    console.log('Rol del usuario:', req.user?.role);
    
    // Determinar ID del usuario autenticado en string y en ObjectId (con fallbacks robustos)
    function getIdFromUser(u) {
      if (!u) return null;
      try { if (u._id && typeof u._id.toHexString === 'function') return u._id.toHexString(); } catch {}
      try { if (u._id && typeof u._id.toString === 'function') return u._id.toString(); } catch {}
      try { if (u.id) return String(u.id); } catch {}
      return null;
    }
    let currentUserIdStr = getIdFromUser(req.user);
    // Fallback: decodificar token si no se obtuvo del user
    if (!currentUserIdStr) {
      try {
        const rawToken = (req.headers.authorization && req.headers.authorization.startsWith('Bearer'))
          ? req.headers.authorization.split(' ')[1]
          : (req.cookies && req.cookies.token) ? req.cookies.token : null;
        if (rawToken && rawToken !== 'temp-token-dev') {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(rawToken, process.env.JWT_SECRET || 'tu_clave_secreta_super_segura');
          currentUserIdStr = String(decoded.userId || decoded.id || '');
        }
      } catch (e) {
        console.warn('[POST /api/customers] No se pudo extraer userId desde token:', e?.message);
      }
    }
    // Normalizar valor vacío a null
    if (!currentUserIdStr) currentUserIdStr = null;
    // Fallback final: si no hay userId pero tenemos username, usar un marcador estable basado en username
    if (!currentUserIdStr) {
      const uname = (req.user?.username || req.user?.name || req.user?.nombre || '').toString().trim();
      if (uname) {
        currentUserIdStr = `user:${uname}`;
        console.warn('[POST /api/customers] Fallback aplicado: usando agenteId string derivado de username:', currentUserIdStr);
      } else {
        currentUserIdStr = 'user:anonymous';
        console.warn('[POST /api/customers] Fallback aplicado: username no disponible, usando agenteId="user:anonymous"');
      }
    }
    let currentUserIdObj = null;
    try { if (currentUserIdStr && /^[a-fA-F0-9]{24}$/.test(currentUserIdStr)) { currentUserIdObj = new ObjectId(currentUserIdStr); } } catch {}
    console.log('[POST /api/customers] currentUserIdStr:', currentUserIdStr, ' | hasObjectId:', !!currentUserIdObj);

    const customerToSave = {
      nombre_cliente: customerData.nombre_cliente || 'Sin nombre',
      telefono_principal: customerData.telefono_principal || '',
      direccion: customerData.direccion || '',
      tipo_servicio: customerData.tipo_servicio || 'desconocido',
      // Alias de compatibilidad para el frontend que usa 'tipo_servicios'
      tipo_servicios: customerData.tipo_servicios || customerData.tipo_servicio || customerData.servicios_texto || customerData.servicios || 'desconocido',
      creadoEn: now,
      actualizadoEn: now,
      status: (customerData.status || 'Nuevo').toString(),
      puntaje: parseFloat(customerData.puntaje) || 0,
      autopago: customerData.autopago === 'true' || customerData.autopago === true,
      // Campos adicionales provenientes del formulario (mantener nombres esperados por el frontend)
      producto: customerData.producto || customerData.producto_contratado || '',
      servicios: customerData.servicios || '',
      servicios_texto: customerData.servicios_texto || '',
      sistema: (customerData.sistema || '').toString().trim().toUpperCase(),
      mercado: (customerData.mercado || '').toString().trim().toUpperCase(),
      riesgo: (customerData.riesgo || '').toString().trim().toUpperCase(),
      motivo_llamada: customerData.motivo_llamada || '',
      comentario: customerData.comentario || '',
      numero_cuenta: customerData.numero_cuenta || customerData.numeroCuenta || '',
      // zip puede llegar como zip o zip_code; unificar en zip_code
      zip_code: customerData.zip_code || customerData.zip || '',
      // Supervisor/equipo (aceptar variantes)
      supervisor: customerData.supervisor || customerData.team || customerData.equipo || '',
      team: customerData.team || customerData.supervisor || customerData.equipo || '',
      agente: customerData.agente || customerData.agenteNombre || undefined,
      // Información de fechas (aceptar equivalentes)
      dia_instalacion: customerData.dia_instalacion || customerData.fecha_instalacion || '',
      // Guardar ambas representaciones para compatibilidad con la UI
      fecha_contratacion: customerData.fecha_contratacion || customerData.dia_venta || undefined,
      dia_venta: customerData.dia_venta || customerData.fecha_contratacion || '',
      // Datos de contacto adicionales
      telefono_alterno: customerData.telefono_alterno || '',
      email: customerData.email || '',
      // Asociar el cliente al usuario que lo crea (guardar ambos formatos: string y ObjectId)
      agenteId: currentUserIdStr,
      creadoPor: currentUserIdStr,
      createdBy: currentUserIdStr,
      ownerId: currentUserIdStr,
      agentId: currentUserIdObj || undefined,
      registeredById: currentUserIdObj || undefined,
      agenteNombre: (req.user?.username || req.user?.name || req.user?.nombre || 'Sistema'),
      // Agregar un timestamp único para evitar conflictos
      timestampUnico: now.getTime() + Math.random().toString(36).substr(2, 9)
    };
    
    console.log('=== DATOS A GUARDAR ===');
    console.log('agenteId que se intentará guardar:', customerToSave.agenteId);
    console.log('Datos completos a guardar:', JSON.stringify(customerToSave, null, 2));
    
    // Asegurarse de que no haya un _id en los datos para que MongoDB genere uno nuevo
    delete customerToSave._id;

    // ===== DETERMINAR COLECCIÓN DESTINO BASADA EN MAPEO =====
    let targetCollection = 'costumers'; // Fallback por defecto
    
    try {
      // 1. Intentar obtener colección desde user_collections usando el userId
      if (currentUserIdObj) {
        const mapping = await db.collection('user_collections').findOne({ userId: currentUserIdObj });
        if (mapping && mapping.collectionName) {
          targetCollection = mapping.collectionName;
          console.log('[POST /api/customers] Mapeo encontrado para userId:', currentUserIdObj, '-> colección:', targetCollection);
        } else {
          console.log('[POST /api/customers] No hay mapeo en user_collections para userId:', currentUserIdObj);
        }
      }
      
      // 2. Si no hay mapeo, intentar crear colección basada en el username
      if (targetCollection === 'costumers' && req.user?.username) {
        const displayName = req.user.username.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        const proposedCollection = `costumers_${displayName}`;
        
        // Verificar si ya existe esta colección
        const existingCollections = await db.listCollections({ name: proposedCollection }).toArray();
        
        if (existingCollections.length > 0) {
          targetCollection = proposedCollection;
          console.log('[POST /api/customers] Colección existente encontrada:', targetCollection);
        } else {
          // Crear nueva colección y mapeo
          targetCollection = proposedCollection;
          console.log('[POST /api/customers] Creando nueva colección:', targetCollection);
          
          // Crear el mapeo si tenemos ObjectId
          if (currentUserIdObj) {
            await db.collection('user_collections').updateOne(
              { userId: currentUserIdObj },
              { 
                $set: { 
                  collectionName: targetCollection,
                  displayName: req.user.username,
                  updatedAt: new Date()
                },
                $setOnInsert: { createdAt: new Date() }
              },
              { upsert: true }
            );
            console.log('[POST /api/customers] Mapeo creado en user_collections:', currentUserIdObj, '->', targetCollection);
          }
        }
      }
    } catch (mappingError) {
      console.error('[POST /api/customers] Error al determinar colección destino:', mappingError);
      // Continuar con colección por defecto
    }

    try {
      console.log('=== INTENTANDO GUARDAR EN LA BASE DE DATOS ===');
      console.log('Colección destino:', targetCollection);
      console.log('Usuario:', req.user?.username);
      console.log('Datos a guardar:', JSON.stringify(customerToSave, null, 2));
      
      // 1. Primero intentar eliminar el índice único si existe (solo para colección principal)
      if (targetCollection === 'costumers') {
        await removeUniqueIndexIfExists();
      }
      
      // 2. Intentar insertar el cliente en la colección determinada
      try {
        const result = await db.collection(targetCollection).insertOne(customerToSave);
        
        console.log('=== CLIENTE GUARDADO EXITOSAMENTE ===');
        console.log('ID del cliente:', result.insertedId);
        console.log('Colección utilizada:', targetCollection);
        
        // Verificar que el cliente realmente se guardó
        const clienteGuardado = await db.collection(targetCollection).findOne({ _id: result.insertedId });
        console.log('Cliente verificado en la base de datos:', clienteGuardado ? 'ENCONTRADO' : 'NO ENCONTRADO');
        
        return res.status(201).json({
          success: true,
          message: 'Cliente creado exitosamente',
          id: result.insertedId,
          collection: targetCollection,
          agent: req.user?.username
        });
      } catch (insertError) {
        // Si hay un error de duplicado, intentar forzar la inserción
        if (insertError.code === 11000) {
          console.log('=== INTENTO FALLIDO - CLIENTE DUPLICADO ===');
          console.log('Error de duplicado:', insertError.message);
          
          // Generar un ID único para forzar la inserción
          customerToSave._id = new require('mongodb').ObjectId();
          console.log('Nuevo ID generado para evitar duplicado:', customerToSave._id);
          
          // Intentar insertar con el nuevo ID en la colección correcta
          const result = await db.collection(targetCollection).insertOne(customerToSave);
          console.log('Cliente guardado con nuevo ID en colección:', targetCollection, '- ID:', result.insertedId);
          
          return res.status(201).json({
            success: true,
            message: 'Cliente creado exitosamente (se generó un nuevo ID único)',
            id: result.insertedId,
            collection: targetCollection,
            agent: req.user?.username,
            wasDuplicate: true
          });
        }
        throw insertError; // Relanzar otros errores
      }
    } catch (insertError) {
      console.error('=== ERROR AL GUARDAR EL CLIENTE ===');
      console.error('Código de error:', insertError.code);
      console.error('Mensaje de error:', insertError.message);
      console.error('Stack trace:', insertError.stack);
      
      // Si es un error de duplicado, devolver éxito pero marcado como duplicado
      if (insertError.code === 11000) {
        return res.status(200).json({
          success: true,
          message: 'Cliente procesado (duplicado ignorado)',
          isDuplicate: true
        });
      }
      
      // Para otros errores, devolver error 500
      return res.status(500).json({
        success: false,
        message: 'Error al guardar el cliente',
        error: insertError.message
      });
    }
  } catch (error) {
    console.error('Error al crear cliente:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Error al crear el cliente',
      error: error.message,
      errorCode: error.code
    });
  }
});
*/

// --- ENDPOINT DUPLICADO DESHABILITADO ---
// Este endpoint fue movido a routes/api.js para manejar todos los roles
/*
app.get('/api/leads', protect, (req, res, next) => {
  // Verificar si el usuario es administrador
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado. Se requiere rol de administrador.'
    });
  }
  next();
}, async (req, res) => {
  try {
    const { agente, fechaInicio, fechaFin } = req.query;
    
    // Construir el filtro de consulta
    const filtro = {};
    
    // Extraer información del usuario desde el token si existe
    let usuarioAutenticado = null;
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token && token !== 'temp-token-dev') {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key-default');
        usuarioAutenticado = {
          id: decoded.userId || decoded.id,
          username: decoded.username,
          role: decoded.role
        };
        console.log('Usuario autenticado desde token:', usuarioAutenticado);
      } catch (jwtError) {
        console.log('Error decodificando token:', jwtError.message);
      }
    }

    // Si hay usuario autenticado, filtrar por agente
    if (usuarioAutenticado) {
      filtro.$or = [
        { agenteNombre: usuarioAutenticado.username },
        { agente: usuarioAutenticado.username }
      ];
      console.log(`Filtrando leads para el usuario: ${usuarioAutenticado.username}`);
    } else if (agente) {
      // Si es un administrador o supervisor y se especifica un agente
      filtro.agente = agente;
      console.log('Sin usuario autenticado, devolviendo todos los leads');
    }
    
    // Filtrar por rango de fechas si se proporciona
    if (fechaInicio || fechaFin) {
      filtro.creadoEn = {};
      if (fechaInicio) {
        filtro.creadoEn.$gte = new Date(fechaInicio);
      }
      if (fechaFin) {
        // Ajustar para incluir todo el día
        const finDia = new Date(fechaFin);
        finDia.setHours(23, 59, 59, 999);
        filtro.creadoEn.$lte = finDia;
      }
    }
    
    console.log('Consultando leads con filtro:', JSON.stringify(filtro, null, 2));
    
    // Obtener los leads que coincidan con el filtro
    const leads = await db.collection('costumers').find(filtro).toArray();
    
    // Procesar los datos para la gráfica
    const datosGrafica = [];
    const ventasPorDia = {};
    
    leads.forEach(lead => {
      if (!lead.creadoEn) return;
      
      const fecha = new Date(lead.creadoEn);
      const fechaStr = fecha.toISOString().split('T')[0];
      
      if (!ventasPorDia[fechaStr]) {
        ventasPorDia[fechaStr] = {
          fecha: fechaStr,
          ventas: 0,
          puntaje: 0,
          conteo: 0
        };
      }
      
      ventasPorDia[fechaStr].ventas += 1;
      ventasPorDia[fechaStr].puntaje += Number(lead.puntaje) || 0;
      ventasPorDia[fechaStr].conteo += 1;
    });
    
    // Calcular promedios y formatear datos para la gráfica
    Object.values(ventasPorDia).forEach(dia => {
      datosGrafica.push({
        fecha: dia.fecha,
        ventas: dia.ventas,
        puntaje: dia.conteo > 0 ? dia.puntaje / dia.conteo : 0
      });
    });
    
    // Ordenar por fecha
    datosGrafica.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    
    console.log(`Datos de gráfica generados: ${datosGrafica.length} puntos de datos`);
    
    res.json(datosGrafica);
    
  } catch (error) {
    console.error('Error al obtener datos para la gráfica:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos para la gráfica',
      error: error.message
    });
  }
});
*/


// Endpoint para crear un nuevo lead
app.post('/api/leads', protect, async (req, res) => {
  // Set CORS headers
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', true);
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const leadData = req.body;
    console.log('=== NUEVA SOLICITUD EN /api/leads ===');
    console.log('Datos recibidos:', leadData);
    // Extra guard: require authenticated user (protect should enforce this)
    if (!req.user) {
      console.warn('[POST /api/leads] solicitud sin usuario autenticado - rechazando');
      return res.status(401).json({ success: false, message: 'Acceso denegado. Debes autenticarte para enviar leads.' });
    }
    
    // Validar datos del lead
    const requiredFields = ['telefono_principal', 'direccion', 'tipo_servicio', 'nombre_cliente'];
    const missingFields = requiredFields.filter(field => {
      const value = leadData[field];
      return value === undefined || value === null || value === '';
    });
    
    if (missingFields.length > 0) {
      console.error('Campos faltantes o inválidos:', missingFields);
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos o son inválidos',
        missingFields: missingFields
      });
    }
    
    // Se ha eliminado la validación de duplicados para permitir guardar cualquier lead
    console.log('Guardando nuevo lead sin validación de duplicados');
    
    // Crear nuevo lead con formato consistente
    const newLead = {
      ...leadData,
      fecha_creacion: new Date(),
      status: leadData.status || 'PENDING',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
      // Agregar campos adicionales con valores por defecto
      puntaje: leadData.puntaje || 0,
      fuente: leadData.fuente || 'WEB',
      asignadoA: leadData.asignadoA || null,
      notas: leadData.notas || [],
      // IMPORTANTE: Agregar el nombre del agente que creó el lead
      agente: req.user?.username || 'Agente Desconocido', // Nombre del usuario autenticado
      agenteNombre: req.user?.username || 'Agente Desconocido', // Nombre del usuario autenticado
      agenteId: req.user?.id, // ID del usuario autenticado
      createdBy: req.user?.username, // Agregar también createdBy para compatibilidad
      historial: [{
        accion: 'CREADO',
        fecha: new Date(),
        usuario: req.user?.username || leadData.usuario || 'SISTEMA',
        detalles: 'Lead creado a través del formulario web',
        agenteId: req.user?.id // Incluir también el ID del agente en el historial
      }]
    };
    
    // Canonical collection selection improved:
    // 1) use a persistent mapping collection `user_collections` (ownerId -> collectionName) if present
    // 2) otherwise try to find existing collections by shortId or by normalized display name
    // 3) if none found, create deterministic canonical name using shortId + normalized display

    // Normalize owner id input into a stable string (prefer hex ObjectId when possible)
    function normalizeOwnerIdInput(v) {
      try {
        if (!v) return '';
        // If it's already an object like {$oid: '...'}
        if (typeof v === 'object') {
          if (v.$oid) return String(v.$oid);
          if (v.toHexString && typeof v.toHexString === 'function') return String(v.toHexString());
          // fallback to string representation
          const s = String(v);
          const m = s.match(/([a-fA-F0-9]{24})/);
          if (m) return m[1];
          return s.trim();
        }
        const s = String(v).trim();
        // match patterns like ObjectId('...') or raw 24-hex
        const m1 = s.match(/^ObjectId\('([a-fA-F0-9]{24})'\)$/);
        if (m1) return m1[1];
        const m2 = s.match(/^([a-fA-F0-9]{24})$/);
        if (m2) return m2[1];
        return s;
      } catch (e) {
        return String(v || '').trim();
      }
    }

    const ownerId = normalizeOwnerIdInput(req.user?.id || newLead.agenteId || newLead.ownerId || '');
    if (!ownerId) {
      console.warn('[POST /api/leads] usuario autenticado sin id válido - rechazando');
      return res.status(401).json({ success: false, message: 'Usuario sin id válido' });
    }

    // Ensure the lead stores a normalized agenteId so future scans match consistently
    try { newLead.agenteId = ownerId; } catch (e) { /* noop */ }

    const shortId = ownerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);

    function normalizeDisplay(s) {
      if (!s) return '';
      return String(s)
        .normalize('NFD').replace(/[\u0000-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s\-_.]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/__+/g, '_')
        .slice(0, 60);
    }

    const displayNorm = normalizeDisplay(req.user?.username || req.user?.name || newLead.agenteNombre || newLead.agente || '');

    // 1) Check mapping collection first (do not overwrite an existing mapping)
    let targetCollection = null;
    let mappingExisted = false;
    try {
      // Try matching ownerId both as stored string and as ObjectId (some mappings were stored as ObjectId)
      const orQuery = [{ ownerId: ownerId }];
      if (/^[a-fA-F0-9]{24}$/.test(ownerId)) {
        try { orQuery.push({ ownerId: new ObjectId(ownerId) }); } catch (e) { }
      }
      const mapping = await db.collection('user_collections').findOne({ $or: orQuery });
      if (mapping && mapping.collectionName) {
        targetCollection = mapping.collectionName;
        mappingExisted = true;
        console.log('[POST /api/leads] found mapping for ownerId ->', targetCollection);
      }
    } catch (e) {
      console.warn('[POST /api/leads] error reading user_collections mapping:', e && e.message);
    }

    // If we have no target yet, scan candidate collections and pick the one with the
    // highest count of documents having agenteId === ownerIdRaw. This prevents creating
    // a new collection when the user's leads are already in another one.
    if (!targetCollection) {
      try {
        // Helper: create a loose regex matching the name ignoring spaces/punctuation
        function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
        function makeLooseNameRegex(n) {
          try {
            if (!n) return null;
            const normalized = String(n).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
            // keep only alnum chars
            const compact = normalized.replace(/[^a-z0-9]/g, '');
            if (!compact) return null;
            const parts = compact.split('');
            const pattern = parts.map(ch => escapeRegex(ch)).join('[^a-z0-9]*');
            return new RegExp('^' + pattern + '$', 'i');
          } catch (e) { return null; }
        }

        const allCols = await db.listCollections().toArray();
        const names = allCols.map(c => c.name).filter(Boolean);
        let best = { name: null, score: 0, countId: 0, countName: 0 };
        const username = req.user?.username || req.user?.name || '';
        const usernameRegex = makeLooseNameRegex(username);
        for (const n of names) {
          if (!n.startsWith('costumers_')) continue;
          try {
            const c = db.collection(n);
            // Match agenteId both as string and as ObjectId (if ownerIdRaw is a 24-hex)
            let cntId = 0;
            try {
              const orClauses = [{ agenteId: ownerId }];
              if (/^[a-fA-F0-9]{24}$/.test(ownerId)) {
                try { orClauses.push({ agenteId: new ObjectId(ownerId) }); } catch (e) { }
              }
              cntId = await c.countDocuments({ $or: orClauses });
            } catch (e) {
              cntId = 0;
            }
            // also count documents that have the agent's display name but missing agenteId
            let cntName = 0;
            if (username) {
              try {
                if (usernameRegex) {
                  const q = { $or: [] };
                  q.$or.push({ agente: { $regex: usernameRegex } });
                  q.$or.push({ agenteNombre: { $regex: usernameRegex } });
                  q.$or.push({ createdBy: { $regex: usernameRegex } });
                  cntName = await c.countDocuments(q);
                } else {
                  cntName = await c.countDocuments({ $or: [{ agente: username }, { agenteNombre: username }, { createdBy: username }] });
                }
              } catch (e) { cntName = 0; }
            }
            // Score: prefer exact agenteId matches, but also consider name matches
            const score = (cntId * 100) + (cntName * 10);
            if (score > best.score) best = { name: n, score, countId: cntId, countName: cntName };
          } catch (e) {
            // ignore per-collection errors
          }
        }
        if (best.score > 0) {
          // Prefer this existing collection which already contains leads for this agent
          if (targetCollection !== best.name) {
            console.log('[POST /api/leads] detected existing collection with agent docs:', best.name, 'countId:', best.countId, 'countName:', best.countName);
            targetCollection = best.name;
            // upsert mapping to point to the detected collection
            try {
              await db.collection('user_collections').updateOne(
                { ownerId: ownerId },
                { $set: { ownerId: ownerId, collectionName: targetCollection, updatedAt: new Date() } },
                { upsert: true }
              );
              console.log('[POST /api/leads] user_collections mapping updated to', targetCollection);
            } catch (e) {
              console.warn('[POST /api/leads] error updating mapping to detected collection:', e && e.message);
            }
          }
        }
      } catch (e) {
        // listing could fail, continue gracefully to other heuristics
      }
    }

    // 2) If no mapping, look for existing collections that match shortId or normalized name
    if (!targetCollection) {
      try {
        const allCols = await db.listCollections().toArray();
        const names = allCols.map(c => c.name);

        // Helper: normalize a string similar to normalizeDisplay but return alnum and underscores
        function norm(s) {
          if (!s) return '';
          return String(s)
            .normalize('NFD').replace(/[ -\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/__+/g, '_')
            .replace(/^_+|_+$/g, '');
        }

        const candidates = [];

        // Score collections: higher score = better match
        for (const n of names) {
          if (!n.startsWith('costumers_')) continue;
          const suffix = n.slice('costumers_'.length);
          const parts = suffix.split('_').filter(Boolean).map(p => norm(p));
          const fullNorm = norm(suffix);
          let score = 0;

          // exact costumers_<shortId>
          if (n === `costumers_${shortId}`) score += 100;

          // any part equals shortId
          if (parts.includes(shortId)) score += 50;

          // last part equals shortId (common pattern costumers_<display>_<shortId>)
          if (parts.length > 0 && parts[parts.length - 1] === shortId) score += 25;

          // display match
          if (displayNorm && fullNorm.includes(norm(displayNorm))) score += 20;

          // fallback small score if contains shortId substring
          if (fullNorm.indexOf(shortId) !== -1) score += 5;

          if (score > 0) candidates.push({ name: n, score });
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.score - a.score);
          targetCollection = candidates[0].name;
        }
      } catch (e) {
        console.warn('[POST /api/leads] error listando colecciones:', e && e.message);
      }
    }

    // 3) If still not found, create a deterministic canonical collection name using shortId
    if (!targetCollection) {
      targetCollection = displayNorm ? `costumers_${shortId}_${displayNorm}` : `costumers_${shortId}`;
      console.log('[POST /api/leads] no existing collection found; will use canonical name:', targetCollection);
    }

    // Persist mapping for future requests (upsert) ONLY if there wasn't a mapping at the start
    if (!mappingExisted) {
      try {
        await db.collection('user_collections').updateOne(
          { ownerId: ownerId },
          { $set: { ownerId: ownerId, collectionName: targetCollection, updatedAt: new Date() } },
          { upsert: true }
        );
        console.log('[POST /api/leads] user_collections mapping upserted for', ownerId, '->', targetCollection);
      } catch (e) {
        console.warn('[POST /api/leads] error upserting user_collections mapping:', e && e.message);
      }
    } else {
      console.log('[POST /api/leads] mapping existed; not overwriting user_collections for', ownerId);
    }

    console.log('[POST /api/leads] targetCollection (final):', targetCollection, 'shortId:', shortId, 'user:', req.user?.username);
    // Insertar en la base de datos (colección por agente o global)
    const result = await db.collection(targetCollection).insertOne(newLead);
    
    console.log('Lead creado exitosamente con ID:', result.insertedId);
    
    // Responder con éxito
    return res.status(201).json({
      success: true,
      message: 'Lead creado exitosamente',
      data: {
        id: result.insertedId,
        ...newLead
      }
    });
    
  } catch (error) {
    console.error('Error al procesar el lead:', error);
    
    // Manejar errores de duplicados
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un lead con este número de teléfono',
        error: error.message
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Error al procesar el lead',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor'
    });
  }
});

// Función para obtener la IP local
function getLocalIp() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  
  for (const iface of Object.values(ifaces)) {
    for (const details of iface) {
      if (details.family === 'IPv4' && !details.internal) {
        return details.address;
      }
    }
  }
  
  return 'localhost';
}

// Endpoints para Empleados del Mes (solo administradores o supervisores de equipo líneas para edición, público para lectura)
app.get('/api/employees-of-month', async (req, res) => {
  try {
    console.log('🌐 Cargando empleados del mes...');

    // Verificar si la base de datos está conectada
    if (!db) {
      console.log('Base de datos no conectada, intentando conectar...');
      await connectToMongoDB();
    }

    // Verificar si existe la colección
    const collections = await db.listCollections().toArray();
    const collectionName = 'employeesOfMonth';
    const collectionExists = collections.some(c => c.name === collectionName);

    if (!collectionExists) {
      console.log(`Colección ${collectionName} no existe, devolviendo array vacío`);
      return res.json({
        success: true,
        message: 'No hay empleados del mes registrados',
        employees: {}
      });
    }

    const employeesCollection = db.collection(collectionName);

    // Obtener todos los empleados del mes
    const employees = await employeesCollection.find({}).toArray();

    // Convertir a objeto para facilitar el acceso desde frontend
    const employeesObj = {};
    employees.forEach(emp => {
      const key = emp.position || emp.employee || 'first';
      employeesObj[key] = {
        employee: emp.employee || key,
        name: emp.name || 'Sin nombre',
        description: emp.description || 'Sin descripción',
        imageData: emp.imageData || null,
        imageClass: emp.imageClass || 'square',
        date: emp.date || new Date().toLocaleDateString('es-ES')
      };
    });

    console.log('✅ Empleados del mes cargados:', Object.keys(employeesObj).length);
    return res.json({
      success: true,
      message: 'Empleados del mes cargados correctamente',
      employees: employeesObj
    });
  } catch (error) {
    console.error('❌ Error cargando empleados del mes:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al cargar empleados del mes',
      error: error.message
    });
  }
});

// Guardar empleado del mes
app.post('/api/employees-of-month', protect, authorize('Administrador', 'Supervisor Team Lineas'), async (req, res) => {
  try {
    console.log('💾 Guardando empleado del mes...');

    // Verificar si la base de datos está conectada
    if (!db) {
      console.log('Base de datos no conectada, intentando conectar...');
      await connectToMongoDB();
    }

    const { employee, name, description, imageData } = req.body || {};

    if (!employee || !name) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el empleado y nombre'
      });
    }

    const employeesCollection = db.collection('employeesOfMonth');

    // Guardar o actualizar empleado
    const result = await employeesCollection.findOneAndUpdate(
      { employee: employee },
      {
        $set: {
          employee: employee,
          name: name,
          description: description || 'Sin descripción',
          imageData: imageData,
          date: new Date().toLocaleDateString('es-ES'),
          updatedAt: new Date()
        }
      },
      {
        upsert: true,
        returnDocument: 'after'
      }
    );

    console.log('✅ Empleado del mes guardado:', employee);
    return res.json({
      success: true,
      message: 'Empleado del mes guardado correctamente',
      data: result.value
    });
  } catch (error) {
    console.error('❌ Error guardando empleado del mes:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al guardar empleado del mes',
      error: error.message
    });
  }
});

// Eliminar empleado del mes
app.delete('/api/employees-of-month/:employee', protect, authorize('Administrador', 'Supervisor Team Lineas'), async (req, res) => {
  try {
    console.log('🗑️ Eliminando empleado del mes:', req.params.employee);

    // Verificar si la base de datos está conectada
    if (!db) {
      console.log('Base de datos no conectada, intentando conectar...');
      await connectToMongoDB();
    }

    const employeesCollection = db.collection('employeesOfMonth');
    const result = await employeesCollection.deleteOne({ employee: req.params.employee });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empleado del mes no encontrado'
      });
    }

    console.log('✅ Empleado del mes eliminado:', req.params.employee);
    return res.json({
      success: true,
      message: 'Empleado del mes eliminado correctamente'
    });
  } catch (error) {
    console.error('❌ Error eliminando empleado del mes:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar empleado del mes',
      error: error.message
    });
  }
});

// Manejar rutas de la aplicación (SPA) - DEBE IR AL FINAL
app.get('*', (req, res) => {
  // Si la ruta es una extensión de archivo, devolver 404
  if (req.path.includes('.')) {
    return res.status(404).send('Archivo no encontrado');
  }
  // Para cualquier otra ruta, servir lead.html (útil para SPA)
  res.sendFile(path.join(__dirname, 'lead.html'));
});

// Función para iniciar el servidor con Socket.io
function startServer(port) {
  // Configurar Socket.io
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
        if (whitelist.includes(origin)) return callback(null, true);
        callback(null, true);
      },
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Mapa de usuarios conectados
  const connectedUsers = new Map();
  const dashboardSubscribers = new Set(); // Usuarios suscritos a actualizaciones del dashboard

  io.on('connection', (socket) => {
    console.log('[Socket.io] Nueva conexión:', socket.id);

    // Usuario se registra con su identificador
    socket.on('register', (userData) => {
      const { odigo, agenteId, username, role } = userData || {};
      const identifier = odigo || agenteId || username;

      if (identifier) {
        socket.userId = identifier;
        socket.userData = userData;
        socket.join(`user:${identifier}`);
        if (role) socket.join(`role:${role}`);

        if (!connectedUsers.has(identifier)) {
          connectedUsers.set(identifier, new Set());
        }
        connectedUsers.get(identifier).add(socket.id);
        console.log(`[Socket.io] Usuario registrado: ${identifier}`);
      }
    });

    // ========== NUEVO: Suscripción a actualizaciones del dashboard ==========
    socket.on('subscribe', (data) => {
      const { channel, user } = data || {};
      
      if (channel === 'dashboard') {
        socket.dashboardUser = user;
        socket.join('dashboard-updates');
        dashboardSubscribers.add(socket.id);
        console.log(`[Dashboard WS] Usuario ${user} suscrito a actualizaciones (socket: ${socket.id})`);
        
        // Confirmar suscripción al cliente
        socket.emit('subscribed', { 
          success: true, 
          message: 'Suscrito a actualizaciones del dashboard',
          channel: 'dashboard'
        });
      }
    });

    // Recibir mensajes del dashboard (para logging)
    socket.on('dashboard-message', (message) => {
      console.log(`[Dashboard] Mensaje de ${socket.dashboardUser}:`, message);
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        const userSockets = connectedUsers.get(socket.userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) connectedUsers.delete(socket.userId);
        }
        console.log(`[Socket.io] Desconectado: ${socket.userId}`);
      }
      
      if (dashboardSubscribers.has(socket.id)) {
        dashboardSubscribers.delete(socket.id);
        console.log(`[Dashboard WS] Usuario desuscrito:`, socket.dashboardUser);
      }
    });
  });

  // Función para emitir actualizaciones del dashboard a todos los suscriptores
  // Se puede llamar desde otros endpoints o intervalos
  global.broadcastDashboardUpdate = (updateData) => {
    if (io) {
      console.log('[Dashboard Broadcast] Enviando actualización a', dashboardSubscribers.size, 'usuarios');
      io.to('dashboard-updates').emit('message', {
        type: 'dashboard-update',
        data: updateData,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Hacer io disponible globalmente
  app.set('io', io);
  global.io = io;

  // Pre-warm init-dashboard cache once server is ready and schedule periodic refreshes
  (async () => {
    try {
      await refreshInitDashboardCache(getDb());
      console.log('[INIT-DASHBOARD] Cache pre-warmed on server start');
    } catch (e) {
      console.warn('[INIT-DASHBOARD] Pre-warm failed:', e?.message || e);
    }

    // Programar refresco periódico en background
    try {
      setInterval(() => {
        try {
          refreshInitDashboardCache(getDb()).catch(err => console.warn('[INIT-DASHBOARD] background refresh error', err));
        } catch (inner) { console.warn('[INIT-DASHBOARD] background schedule error', inner); }
      }, Math.max(10000, INIT_DASHBOARD_TTL));
      console.log('[INIT-DASHBOARD] background refresh scheduled (ms):', INIT_DASHBOARD_TTL);
    } catch (e) {
      console.warn('[INIT-DASHBOARD] Could not schedule background refresh:', e?.message || e);
    }

    httpServer.listen(port, () => {
      console.log(`[SERVER] Servidor corriendo en el puerto ${port}`);
      console.log(`[SERVER] Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[SERVER] URL: http://localhost:${port}`);
      console.log(`[Socket.io] WebSocket activo`);
    });
  })();

  httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[SERVER] Puerto ${port} en uso`);
      process.exit(1);
    } else {
      console.error('[SERVER] Error:', error);
    }
  });

  activeServer = httpServer;
  return httpServer;
}

// Arrancar servidor después de conectar BD
(async () => {
  let retries = 0;
  const maxRetries = 30;
  while (!isConnected() && retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }

  if (isConnected()) {
    console.log('[SERVER] Base de datos lista, iniciando servidor...');
    startServer(PORT);
  } else {
    console.error('[SERVER] BD no conectada, iniciando en modo degradado');
    startServer(PORT);
  }
})();

// Manejo de cierre graceful
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Cerrando servidor...');
  try {
    if (activeServer) activeServer.close(() => console.log('[SHUTDOWN] Servidor cerrado'));
    await closeConnection();
  } catch (error) {
    console.error('[SHUTDOWN] Error:', error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Señal SIGTERM...');
  try {
    if (activeServer) activeServer.close(() => console.log('[SHUTDOWN] Servidor cerrado'));
    await closeConnection();
  } catch (error) {
    console.error('[SHUTDOWN] Error:', error);
  }
  process.exit(0);
});

// Exportar
module.exports = { app, getIo: () => io };