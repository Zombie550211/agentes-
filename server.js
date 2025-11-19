const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
require('dotenv').config();

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
const { connectToMongoDB, getDb, closeConnection, isConnected } = require('./config/db');

// Middleware de autenticación unificado
const { protect, authorize } = require('./middleware/auth');

// Importar rutas
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const rankingRoutes = require('./routes/ranking');
const equipoRoutes = require('./routes/equipoRoutes');
const employeesOfMonthRoutes = require('./routes/employeesOfMonth');

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

// Variable para almacenar la referencia del servidor activo
let activeServer = null;

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

    // Permitir localhost y 127.0.0.1 en cualquier puerto (incluye 3001)
    const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\\d+)?$/i;
    if (localhostRegex.test(origin)) return callback(null, true);

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
(async () => {
  db = await connectToMongoDB(); // La lógica de error y fallback ya está dentro.
  if (isConnected()) {
    console.log('[SERVER] Conexión a base de datos establecida.');
  } else {
    console.warn('[SERVER] Iniciando en modo OFFLINE. Las operaciones de base de datos fallarán.');
  }
})();

// Configuración de middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
    if (!db) db = getDb();

    const body = req.body || {};

    // Helpers de normalización
    const toUpper = (s) => (s == null ? '' : String(s).trim().toUpperCase());
    const digitsOnly = (s) => (s == null ? '' : String(s).replace(/\D+/g, ''));
    const asDate = (s) => {
      if (!s) return null;
      try {
        // soportar yyyy-mm-dd y dd/mm/yyyy
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

    // Validaciones mínimas obligatorias (según especificación):
    const errors = [];
    const requiredFields = ['nombre_cliente','telefono_principal','numero_cuenta','autopay','pin_seguridad','direccion','servicios','dia_venta','dia_instalacion','status','cantidad_lineas','id','mercado','supervisor'];
    for (const f of requiredFields) {
      if (body[f] == null || body[f] === '' || (Array.isArray(body[f]) && body[f].length === 0)) {
        errors.push(`Campo requerido faltante: ${f}`);
      }
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Validación fallida', errors });
    }

    // Coerciones/normalizaciones
    const servicios = Array.isArray(body.servicios) ? body.servicios.map(v => String(v)) : [String(body.servicios)];
    const cantidadLineasSel = Array.isArray(body.cantidad_lineas) ? body.cantidad_lineas : [body.cantidad_lineas];
    const cantidadLineas = Number(cantidadLineasSel[0] || 0);
    const telefonosRaw = Array.isArray(body.telefonos) ? body.telefonos : [body.telefono_1, body.telefono_2, body.telefono_3, body.telefono_4, body.telefono_5].filter(v => v != null);
    const telefonos = telefonosRaw.map(digitsOnly).filter(Boolean).slice(0, Math.max(0, cantidadLineas || 0));

    // Validaciones de dominio
    const autopayVal = String(body.autopay || '').toLowerCase(); // 'si' | 'no'
    if (!['si','no'].includes(autopayVal)) errors.push('autopay debe ser si | no');
    const statusVal = String(body.status || '').toLowerCase(); // 'pending' | 'repro'
    if (!['pending','repro'].includes(statusVal)) errors.push('status inválido (permitidos: pending, repro)');
    const mercadoArr = Array.isArray(body.mercado) ? body.mercado : [body.mercado];
    const mercado = mercadoArr.map(String);
    if (mercado.length !== 1 || !['bamo','icon'].includes(mercado[0].toLowerCase())) errors.push('mercado debe ser uno: bamo | icon');
    const supervisorVal = String(body.supervisor || '').toLowerCase();
    if (!['jonathan','diego'].includes(supervisorVal)) errors.push('supervisor inválido (permitidos: JONATHAN, DIEGO)');
    if (!cantidadLineas || isNaN(cantidadLineas) || cantidadLineas < 1 || cantidadLineas > 5) errors.push('cantidad_lineas debe ser entre 1 y 5');
    if (telefonos.length !== cantidadLineas) errors.push('La cantidad de teléfonos debe coincidir con cantidad_lineas');
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Validación fallida', errors });
    }

    // Obtener información del usuario que crea el registro
    const user = req.user;
    const username = user?.username || '';
    
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
      servicios, // múltiples checks permitidos
      dia_venta: asDate(body.dia_venta),
      dia_instalacion: asDate(body.dia_instalacion),
      status: statusVal.toUpperCase(), // PENDING | REPRO
      cantidad_lineas: cantidadLineas,
      telefonos,
      ID: String(body.id || body.ID || '').trim(),
      mercado: mercado[0].toUpperCase(), // BAMO | ICON
      supervisor: supervisorVal.toUpperCase(), // JONATHAN | DIEGO
      // Información del agente que crea el registro
      agente: username,
      agenteNombre: username,
      createdBy: username,
      registeredBy: username,
      creadoEn: now,
      actualizadoEn: now,
      _raw: body
    };

    const result = await db.collection('Lineas').insertOne(doc);
    return res.status(201).json({ success: true, message: 'Formulario Lineas creado', id: result.insertedId?.toString(), data: doc });
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

// En caso de que esta ruta se evalúe después de static, servir igualmente a usuarios autenticados
app.get('/Costumer.html', protect, (req, res) => {
  return res.sendFile(path.join(__dirname, 'Costumer.html'));
});

// Handle CORS preflight for all routes
app.options('*', cors(corsOptions));

// El middleware de logueo para /api/leads ha sido eliminado ya que el endpoint duplicado fue deshabilitado.

// Usar rutas de autenticación (aplicar limiter suave al grupo si disponible)
app.use('/api/auth', authLimiter, authRoutes);
// Montar rutas de API públicas
app.use('/api', apiRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/employees-of-month', employeesOfMonthRoutes);
app.use('/api/equipos', equipoRoutes);

// Middleware inline (authenticateJWT) queda reemplazado por middleware/auth.js (protect)
// Wrapper mínimo por compatibilidad con referencias existentes
const authenticateJWT = (req, res, next) => protect(req, res, next);

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
app.get('/api/auth/verify-server', (req, res) => {
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

    res.json({
      success: true,
      message: 'Token válido',
      authenticated: true,
      user: {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
        permissions: decoded.permissions
      }
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
    
    // Validaciones
    if (!username || !password || !role) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username, password y role son requeridos' 
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: 'La contraseña debe tener al menos 8 caracteres' 
      });
    }
    
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

    // Crear el nuevo usuario
    const newUser = {
      username: username,
      password: hashedPassword,
      role: role,
      team: team || null,
      supervisor: supervisor || null,
      name: username, // Por defecto usar username como name
      createdBy: req.user.username,
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
    // Filtrar solo roles de agente
    const roleFilter = { role: { $in: ['Agentes', 'Lineas-Agentes'] } };
    const users = await usersColl
      .find(roleFilter)
      .project({ username: 1, name: 1, nombre: 1, fullName: 1, role: 1 })
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
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const skip = (page - 1) * limit;
    const fechaInicio = req.query.fechaInicio ? new Date(req.query.fechaInicio) : null;
    const fechaFin = req.query.fechaFin ? new Date(req.query.fechaFin) : null;

    console.log(`Parámetros - Página: ${page}, Límite: ${limit}, Saltar: ${skip}`);

    // Verificar colecciones disponibles
    const collections = await db.listCollections().toArray();
    console.log('Colecciones disponibles en crmagente:', collections.map(c => c.name));

    // Usamos la colección 'costumers' específicamente
    const collectionName = 'costumers';
    console.log(`Intentando acceder a la colección: ${collectionName}`);
    
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
    const userRole = (req.user?.role || '').toLowerCase();
    if (req.user) {
      const currentUserId = (req.user?._id?.toString?.() || req.user?.id?.toString?.() || String(req.user?._id || req.user?.id || ''));
      const role = (req.user.role || '').toLowerCase();
      console.log(`[DEBUG] Usuario autenticado - ID: ${currentUserId}, Rol: ${role}, forceAll=${forceAll}`);

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
      } else if (role === 'supervisor') {
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
        const supRegexes = supNameCandidates.map(n => {
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
        const privileged = ['administrador','admin','backoffice','supervisor','supervisor team lineas'];
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
    
    const [leads, total] = await Promise.all([
      db.collection('costumers')
        .find(query)
        .sort({ fecha_creacion: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray(),
      db.collection('costumers').countDocuments(query)
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

    try {
      console.log('=== INTENTANDO GUARDAR EN LA BASE DE DATOS ===');
      console.log('Colección:', 'costumers');
      console.log('Datos a guardar:', JSON.stringify(customerToSave, null, 2));
      
      // 1. Primero intentar eliminar el índice único si existe
      await removeUniqueIndexIfExists();
      
      // 2. Intentar insertar el cliente
      try {
        const result = await db.collection('costumers').insertOne(customerToSave);
        
        console.log('=== CLIENTE GUARDADO EXITOSAMENTE ===');
        console.log('ID del cliente:', result.insertedId);
        
        // Verificar que el cliente realmente se guardó
        const clienteGuardado = await db.collection('costumers').findOne({ _id: result.insertedId });
        console.log('Cliente verificado en la base de datos:', clienteGuardado ? 'ENCONTRADO' : 'NO ENCONTRADO');
        
        return res.status(201).json({
          success: true,
          message: 'Cliente creado exitosamente',
          id: result.insertedId
        });
      } catch (insertError) {
        // Si hay un error de duplicado, intentar forzar la inserción
        if (insertError.code === 11000) {
          console.log('=== INTENTO FALLIDO - CLIENTE DUPLICADO ===');
          console.log('Error de duplicado:', insertError.message);
          
          // Generar un ID único para forzar la inserción
          customerToSave._id = new require('mongodb').ObjectId();
          console.log('Nuevo ID generado para evitar duplicado:', customerToSave._id);
          
          // Intentar insertar con el nuevo ID
          const result = await db.collection('costumers').insertOne(customerToSave);
          console.log('Cliente guardado con nuevo ID:', result.insertedId);
          
          return res.status(201).json({
            success: true,
            message: 'Cliente creado exitosamente (se generó un nuevo ID único)',
            id: result.insertedId,
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
    
    // Insertar en la base de datos
    const result = await db.collection('costumers').insertOne(newLead);
    
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

// Función para iniciar el servidor
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`[SERVER] Servidor corriendo en el puerto ${port}`);
    console.log(`[SERVER] Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[SERVER] URL: http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[SERVER] Error: El puerto ${port} ya está en uso`);
      console.error('[SERVER] Intenta detener otros procesos que usen este puerto');
      process.exit(1);
    } else {
      console.error('[SERVER] Error del servidor:', error);
    }
  });

  activeServer = server;
  return server;
}

// Arrancar servidor
startServer(PORT);

// Manejo de cierre graceful
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Cerrando servidor...');
  try {
    if (activeServer) {
      activeServer.close(() => {
        console.log('[SHUTDOWN] Servidor cerrado');
      });
    }
    await closeConnection();
    console.log('[SHUTDOWN] Conexión a la base de datos cerrada');
  } catch (error) {
    console.error('[SHUTDOWN] Error cerrando conexión:', error);
  }
  process.exit(0);
});

// Manejo de señales de terminación
process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] Recibida señal SIGTERM...');
  try {
    if (activeServer) {
      activeServer.close(() => {
        console.log('[SHUTDOWN] Servidor cerrado');
      });
    }
    await closeConnection();
    console.log('[SHUTDOWN] Conexión a la base de datos cerrada');
  } catch (error) {
    console.error('[SHUTDOWN] Error cerrando conexión:', error);
  }
  process.exit(0);
});

// Exportar la aplicación
module.exports = app;