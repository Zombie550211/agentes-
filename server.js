// ============================================================
//  server.js
//  Cambios aplicados:
//  1. isColchon() — helper reutilizable para detectar ventas colchón
//  2. POST /api/leads — lógica de RESERVA corregida (dia_venta !== hoy)
//  3. GET /api/leads — incluye ventas colchón + campo "fecha" + límite 5000
//  4. GET /api/init-dashboard — KPIs distinguen colchón de ventas normales
// ============================================================

// 1. IMPORTS
const dns      = require('dns');
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const http     = require('http');
const https    = require('https');
const path     = require('path');
const multer   = require('multer');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const { ObjectId, GridFSBucket } = require('mongodb');
const { Server }   = require('socket.io');
const { Readable } = require('stream');
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

// ── STATUS NORMALIZATION (fuente única de verdad) ─────────────
const STATUS_COMPLETED = new Set([
  'completed','active','completado','activo','activa',
  'vendido','cerrado','cerrada','venta cerrada'
]);
const STATUS_PENDING   = new Set(['pending','pendiente','pendientes']);
const STATUS_CANCELLED = new Set(['cancelled','canceled','cancelado','cancelada']);
const STATUS_HOLD      = new Set(['hold','en hold','pausado','pausa']);
const STATUS_RESERVA   = new Set(['reserva','ventas en reserva','reserved','reservation']);
const STATUS_OFICINA   = new Set(['oficina','active_oficina']);
const STATUS_RESCHEDULED = new Set(['rescheduled','reagendado','reagendada','reprogramado','reprogramada']);

function normalizeStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'pending';
  if (STATUS_COMPLETED.has(s))    return 'completed';
  if (STATUS_PENDING.has(s))      return 'pending';
  if (STATUS_CANCELLED.has(s))    return 'cancelled';
  if (STATUS_HOLD.has(s))         return 'hold';
  if (STATUS_RESERVA.has(s))      return 'reserva';
  if (STATUS_OFICINA.has(s))      return 'oficina';
  if (STATUS_RESCHEDULED.has(s))  return 'rescheduled';
  if (s.includes('cancel'))                                           return 'cancelled';
  if (s.includes('pend'))                                             return 'pending';
  if (s.includes('complet') || s.includes('activ') ||
      s.includes('cerr')    || s.includes('vend'))                   return 'completed';
  if (s.includes('hold'))                                             return 'hold';
  if (s.includes('reser'))                                            return 'reserva';
  if (s.includes('resched') || s.includes('reagend') ||
      s.includes('reprogram'))                                        return 'rescheduled';
  if (s.includes('oficina'))                                          return 'oficina';
  return 'pending';
}

function isCompleted(status)  { return normalizeStatus(status) === 'completed'; }
function isCancelled(status)  { return normalizeStatus(status) === 'cancelled'; }
function isPending(status)    { return normalizeStatus(status) === 'pending'; }
function isReserva(status)    { return normalizeStatus(status) === 'reserva'; }
function isOficina(status)    { return normalizeStatus(status) === 'oficina'; }

// MongoDB $expr para usar en aggregates
const COMPLETED_VALUES_LOWER = ['completed','active','completado','activo','activa','vendido','cerrado','cerrada'];
const completedMatchExpr = { $in: [{ $toLower: { $ifNull: ['$status',''] } }, COMPLETED_VALUES_LOWER] };

// ── COLCHÓN DETECTION ─────────────────────────────────────────
// Una venta es colchón geográficamente cuando:
//   - dia_venta está en un mes DIFERENTE al mes de referencia
//   - dia_instalacion está en el mes de referencia
// IMPORTANTE: El status NO se valida aquí.
// Para CONTAR en rankings solo cuentan los colchones con status completed.
function isColchon(lead, referenceDate) {
  try {
    const ref         = referenceDate || new Date();
    const curYear     = ref.getFullYear();
    const curMonth    = String(ref.getMonth() + 1).padStart(2, '0');
    const curMonthStr = `${curYear}-${curMonth}`;

    const dv = String(lead.dia_venta       || lead.diaVenta       || '').slice(0, 7);
    const di = String(lead.dia_instalacion || lead.diaInstalacion || '').slice(0, 7);

    if (!dv || !di) return false;

    // Solo detectar el patrón de fechas — status no importa para la DETECCIÓN
    // (el badge colchón se muestra aunque esté pending)
    return dv !== curMonthStr && di === curMonthStr;
  } catch {
    return false;
  }
}

// Una venta colchón CUENTA en rankings SOLO si tiene status completed/active
// Si está pending/hold/etc. muestra el badge pero NO cuenta en rankings
function isColchonActivo(lead, referenceDate) {
  return isColchon(lead, referenceDate) && isCompleted(lead.status);
}
// ── FIN STATUS + COLCHÓN NORMALIZATION ───────────────────────

// 2. APP
const app = express();

const FRONTEND_DIR         = path.join(__dirname, 'frontend');
const FRONTEND_PUBLIC_DIR  = path.join(FRONTEND_DIR, 'public');
const FRONTEND_AGENTES_DIR = path.join(FRONTEND_DIR, 'agentes');

// 3. JWT SECRET
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET no definido.');
    process.exit(1);
  } else {
    console.warn('[WARN] JWT_SECRET no definido. Usando clave de desarrollo.');
  }
}
const JWT_SECRET_EFFECTIVE = JWT_SECRET || 'dev_only_insecure_key_do_not_use_in_prod';
const JWT_EXPIRES_IN = '24h';

// 4. SEGURIDAD Y CORS
const parseAllowedOrigins = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);
const envOrigins   = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const defaultAllowed = [
  'http://localhost:10000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:10000',
  'https://agentes-49dr.onrender.com',
  'https://agentes-frontend.onrender.com'
];
if (process.env.NODE_ENV === 'production') {
  const renderDomains = [
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_INSTANCE && `https://${process.env.RENDER_INSTANCE}.onrender.com`,
    'https://agentes-49dr.onrender.com'
  ].filter(Boolean);
  envOrigins.push(...renderDomains);
}
const corsWhitelist = () => Array.from(new Set([...defaultAllowed, ...envOrigins]));

app.use(helmet({
  contentSecurityPolicy: false,
  hsts: process.env.NODE_ENV === 'production'
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    const whitelist = corsWhitelist();
    if (whitelist.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido — ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','X-Admin-Setup-Secret']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 5. LOGS EN PRODUCCIÓN
if (process.env.NODE_ENV === 'production') {
  console.log   = () => {};
  console.info  = () => {};
  console.debug = () => {};
  const originalError = console.error;
  console.error = (...args) => {
    const filtered = args.map(arg => {
      if (typeof arg === 'string') return arg.replace(/password|token|secret|key|authorization/gi, '[REDACTED]');
      if (typeof arg === 'object' && arg !== null) {
        const f = { ...arg };
        ['password','token','secret','key','authorization','headers'].forEach(k => delete f[k]);
        return f;
      }
      return arg;
    });
    originalError(...filtered);
  };
}

// 6. PUERTO
const isRender = !!process.env.RENDER || /render/i.test(process.env.RENDER_EXTERNAL_URL || '');
const PORT = isRender
  ? Number(process.env.PORT)
  : (Number(process.env.PORT) || 3000);

// 7. MÓDULOS OPCIONALES
let rateLimit    = null;
let cookieParser = null;
try { rateLimit = require('express-rate-limit'); } catch (e) { console.warn('[INIT] express-rate-limit no instalado:', e.message); }
try { cookieParser = require('cookie-parser'); } catch (_) {}

// 8. IMPORTS INTERNOS
const { connectToMongoDB, getDb, getDbFor, closeConnection, isConnected } = require('./backend/config/db');
const { normalizeDateToString }  = require('./backend/utils/dateNormalizer');
const dateFormatterMiddleware    = require('./backend/middleware/dateFormatter');
const { protect, authorize }     = require('./backend/middleware/auth');

const authRoutes                 = require('./backend/routes/auth');
const forgotPasswordRoutes       = require('./backend/routes/auth-forgot-password');
const apiRoutes                  = require('./backend/routes/api');
const rankingRoutes              = require('./backend/routes/ranking');
const equipoRoutes               = require('./backend/routes/equipoRoutes');
const employeesOfMonthRoutes     = require('./backend/routes/employeesOfMonth');
const facturacionRoutes          = require('./backend/routes/facturacion');
const facturacionLineasRoutes    = require('./backend/routes/facturacionLineas');
const llamadasVentasLineasRoutes = require('./backend/routes/llamadasVentasLineas');

let teamsRoutes = null;
try { teamsRoutes = require('./backend/routes/teams'); } catch (e) { console.warn('[INIT] teams route:', e.message); }
let mediaProxy = null;
try { mediaProxy = require('./backend/routes/mediaProxy'); } catch (e) { console.warn('[INIT] mediaProxy:', e.message); }
let debugRoutes = null;
try { debugRoutes = require('./backend/routes/debug'); } catch (e) { console.warn('[INIT] debug route:', e.message); }
let debugNoAuthRoutes = null;
try { debugNoAuthRoutes = require('./backend/routes/debug_noauth'); } catch (e) { console.warn('[INIT] debug_noauth:', e.message); }

// 9. ESTADO GLOBAL
let gridFSBucket      = null;
let userAvatarsBucket = null;
let db                = null;
let activeServer      = null;
let io                = null;

const INIT_DASHBOARD_TTL = Number(process.env.INIT_DASHBOARD_TTL_MS) || 5 * 60 * 1000;
global.initDashboardCache           = global.initDashboardCache           || { data: null, updatedAt: 0 };
global.initDashboardCacheRefreshing = global.initDashboardCacheRefreshing || false;

const AGENT_TO_SUP = new Map([
  ['josue renderos','irania serrano'],    ['tatiana ayala','irania serrano'],
  ['giselle diaz','irania serrano'],      ['miguel nunez','irania serrano'],
  ['roxana martinez','irania serrano'],   ['irania serrano','irania serrano'],
  ['abigail galdamez','bryan pleitez'],   ['alexander rivera','bryan pleitez'],
  ['diego mejia','bryan pleitez'],        ['evelin garcia','bryan pleitez'],
  ['fabricio panameno','bryan pleitez'],  ['luis chavarria','bryan pleitez'],
  ['steven varela','bryan pleitez'],
  ['cindy flores','roberto velasquez'],   ['daniela bonilla','roberto velasquez'],
  ['francisco aguilar','roberto velasquez'], ['levy ceren','roberto velasquez'],
  ['lisbeth cortez','roberto velasquez'], ['lucia ferman','roberto velasquez'],
  ['nelson ceren','roberto velasquez'],
  ['anderson guzman','johana'],  ['carlos grande','johana'],
  ['guadalupe santana','johana'],['julio chavez','johana'],
  ['priscila hernandez','johana'],['riquelmi torres','johana']
]);

function normText(s) {
  try { return String(s || '').normalize('NFD').replace(/\p{Diacritic}+/gu,'').trim().toLowerCase().replace(/\s+/g,' '); }
  catch { return String(s || '').trim().toLowerCase(); }
}

function getSupervisorAgents(supervisorUsername) {
  const norm = normText(supervisorUsername);
  return Array.from(AGENT_TO_SUP.entries())
    .filter(([, sup]) => normText(sup) === norm)
    .map(([agent]) => agent);
}

// 10. HELPER COOKIE
function cookieOptionsForReq(req, baseOpts) {
  const defaults = baseOpts || {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge:   24 * 60 * 60 * 1000,
    path:     '/'
  };
  const proto   = (req.headers && req.headers['x-forwarded-proto']) || req.protocol;
  const isHttps = proto === 'https' || req.secure;
  const host    = (req.headers && req.headers.host) || '';
  if (/localhost:10000$/i.test(host) || !isHttps) return { ...defaults, secure: false, sameSite: 'lax' };
  return defaults;
}

// 11. RATE LIMITERS
const makeLimiter = (opts) => rateLimit
  ? rateLimit.rateLimit(opts)
  : ((req, res, next) => next());

const authLimiter  = makeLimiter({ windowMs: 15*60*1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = makeLimiter({ windowMs: 10*60*1000, limit: 20,  standardHeaders: 'draft-7', legacyHeaders: false });

// 12. HTTP SERVER
const httpServer = http.createServer(app);

// ── MIDDLEWARES ESTÁTICOS ─────────────────────────────────────

app.get('/health', (req, res) => {
  const state = mongoose.connection.readyState;
  const map   = { 0:'disconnected', 1:'connected', 2:'connecting', 3:'disconnecting' };
  res.json({ ok: state === 1, mongo: map[state] || String(state) });
});

app.get(['/crear-cuenta.html','/crear-cuenta'], (req, res) =>
  res.sendFile(path.join(FRONTEND_DIR, 'crear-cuenta.html'))
);

const videoSetHeaders = (res, p) => {
  if (p.endsWith('.mp4')) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Accept-Ranges', 'bytes');
  }
};
app.use('/images', express.static(path.join(FRONTEND_DIR,        'images'), { setHeaders: videoSetHeaders }));
app.use('/images', express.static(path.join(FRONTEND_PUBLIC_DIR, 'images'), { setHeaders: videoSetHeaders }));
app.use(express.static(FRONTEND_PUBLIC_DIR));
app.use(express.static(FRONTEND_AGENTES_DIR));
app.use('/utils',      express.static(path.join(__dirname, 'backend', 'utils')));
app.use('/scripts',    express.static(path.join(__dirname, 'scripts')));
app.use('/components', express.static(path.join(__dirname, 'components')));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    if (req.path && /\.html?$/i.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma',  'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });
}

app.use((req, res, next) => {
  try {
    if (req.path && /%25|%20|%2[0-9A-Fa-f]/.test(req.path)) {
      let decoded = req.path;
      for (let i = 0; i < 5; i++) {
        try { const once = decodeURIComponent(decoded); if (once === decoded) break; decoded = once; } catch { break; }
      }
      const candidate = path.join(FRONTEND_DIR, decoded.replace(/^\/+/, ''));
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return res.sendFile(candidate);
    }
  } catch (_) {}
  next();
});

app.use(express.static(FRONTEND_DIR, {
  extensions: ['html','htm'],
  index: false,
  setHeaders: (res, p) => {
    if (p.endsWith('.css'))      res.setHeader('Content-Type', 'text/css');
    else if (p.endsWith('.js'))  res.setHeader('Content-Type', 'application/javascript');
  }
}));

app.use('/api', dateFormatterMiddleware);

if (process.env.NODE_ENV !== 'production') {
  app.use('/api', (req, res, next) => { console.log('[API DEBUG]', req.method, req.originalUrl); next(); });
}

if (teamsRoutes) {
  app.use('/api/teams', teamsRoutes);
  if (process.env.NODE_ENV !== 'production') console.log('[INIT] /api/teams montada');
}

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

if (cookieParser) app.use(cookieParser());

// 13. CLOUDINARY
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});
const CLOUDINARY_HAS_CREDENTIALS = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY   &&
  process.env.CLOUDINARY_API_SECRET
);
const CLOUDINARY_BG_REMOVAL_FLAG    = String(process.env.CLOUDINARY_BG_REMOVAL || '').trim().toLowerCase();
const CLOUDINARY_BG_REMOVAL_ENABLED = CLOUDINARY_HAS_CREDENTIALS &&
  CLOUDINARY_BG_REMOVAL_FLAG !== '0' && CLOUDINARY_BG_REMOVAL_FLAG !== 'false';
const CLOUDINARY_AVATAR_FOLDER      = process.env.CLOUDINARY_AVATAR_FOLDER || 'dashboard/user-avatars';

// 14. MULTER
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`);
  }
});
const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg','image/jpg','image/png','image/gif','video/mp4','video/mov','video/avi','video/quicktime'];
  cb(allowed.includes(file.mimetype) ? null : new Error('Tipo no permitido'), allowed.includes(file.mimetype));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 10*1024*1024 } });

const noteFileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg','image/jpg','image/png','image/webp','image/gif',
    'audio/mpeg','audio/mp3','audio/wav','audio/m4a','audio/x-m4a','audio/mp4','audio/ogg','audio/webm',
    'video/mp4','video/webm','video/quicktime','application/pdf'
  ];
  cb(allowed.includes(file.mimetype) ? null : new Error('Tipo no permitido para notas'), allowed.includes(file.mimetype));
};
const noteUpload   = multer({ storage: multer.memoryStorage(), fileFilter: noteFileFilter, limits: { fileSize: 500*1024*1024 } });
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Tipo no permitido para avatar'), allowed.includes(file.mimetype));
  },
  limits: { fileSize: 4*1024*1024 }
});

// 15. CONEXIÓN A BD
(async () => {
  db = await connectToMongoDB();
  if (isConnected()) {
    console.log('[SERVER] Conexión a base de datos establecida.');
    try { gridFSBucket      = new GridFSBucket(db, { bucketName: 'noteFiles' });   console.log('[SERVER] GridFS noteFiles OK'); }
    catch (e) { console.error('[SERVER] GridFS noteFiles error:', e.message); }
    try { userAvatarsBucket = new GridFSBucket(db, { bucketName: 'userAvatars' }); console.log('[SERVER] GridFS userAvatars OK'); }
    catch (e) { console.error('[SERVER] GridFS userAvatars error:', e.message); }
  } else {
    console.warn('[SERVER] Modo OFFLINE — operaciones de BD fallarán.');
  }
})();

// ── ACTIVITY LOGGER ───────────────────────────────────────────
async function logActivity(db, activityType, leadId, leadClientName, actorUsername, actorRole, description, extra = {}) {
  try {
    await db.collection('activities').insertOne({
      activity_type:    activityType,
      lead_id:          leadId,
      lead_client_name: leadClientName,
      actor_username:   actorUsername,
      actor_role:       actorRole,
      description,
      timestamp:        new Date(),
      ...extra
    });
  } catch (e) { console.warn('[ACTIVITY-LOG] Error:', e.message); }
}

// ── INIT-DASHBOARD CACHE REFRESH ──────────────────────────────
async function refreshInitDashboardCache(_db) {
  if (global.initDashboardCacheRefreshing) {
    console.log('[INIT-DASHBOARD] Refresco ya en curso — omitiendo');
    return global.initDashboardCache.data;
  }
  global.initDashboardCacheRefreshing = true;
  try {
    if (!isConnected()) { console.warn('[INIT-DASHBOARD] BD no conectada'); return; }
    const startTime  = Date.now();
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const dateConditions = [
      { dia_venta:          { $gte: monthStart, $lt: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lt: monthEnd } },
      { creadoEn:           { $gte: monthStart, $lt: monthEnd } },
      { createdAt:          { $gte: monthStart, $lt: monthEnd } },
      { fecha:              { $gte: monthStart, $lt: monthEnd } }
    ];

    if (!_db) _db = getDb();
    const leads = await _db.collection('costumers_unified')
      .find({ $or: dateConditions })
      .project({ _id:1, agenteNombre:1, agente:1, usuario:1, servicios:1, puntaje:1, status:1, dia_venta:1, dia_instalacion:1, creadoEn:1, createdAt:1 })
      .sort({ dia_venta: -1 })
      .limit(2000)
      .toArray();

    const ventasLeads  = leads.filter(l => isCompleted(l.status) && !isColchon(l, now));
    const colchonLeads = leads.filter(l => isColchonActivo(l, now)); // solo colchones completed

    const kpis = {
      ventas:         ventasLeads.length,
      puntos:         ventasLeads.reduce((s, l) => s + parseFloat(l.puntaje || 0), 0),
      mayor_vendedor: '-',
      canceladas:     leads.filter(l => isCancelled(l.status) && !isColchon(l, now)).length,
      pendientes:     leads.filter(l => isPending(l.status)   && !isColchon(l, now)).length,
      colchon:        colchonLeads.length,
      colchon_puntos: colchonLeads.reduce((s, l) => s + parseFloat(l.puntaje || 0), 0)
    };

    if (ventasLeads.length > 0) {
      const agents = {};
      ventasLeads.forEach(l => {
        const a = l.agenteNombre || l.agente || '-';
        agents[a] = (agents[a] || 0) + parseFloat(l.puntaje || 0);
      });
      const top = Object.entries(agents).sort((a, b) => b[1] - a[1])[0];
      kpis.mayor_vendedor = top ? top[0] : '-';
    }

    const agentMap   = {};
    const productMap = {};
    ventasLeads.forEach(lead => {
      const agent = lead.agenteNombre || lead.agente || 'Sin asignar';
      agentMap[agent] = (agentMap[agent] || 0) + 1;
      const services = Array.isArray(lead.servicios) ? lead.servicios : [lead.servicios];
      services.forEach(s => { if (s) productMap[s] = (productMap[s] || 0) + 1; });
    });

    const chartTeams     = Object.entries(agentMap).map(([nombre, count]) => ({ nombre, count })).sort((a, b) => b.count - a.count).slice(0, 50);
    const chartProductos = Object.entries(productMap).map(([servicio, count]) => ({ servicio, count })).sort((a, b) => b.count - a.count).slice(0, 5);

    const elapsed  = Date.now() - startTime;
    const response = {
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: null, role: 'system', team: 'Global' },
      kpis,
      userStats: { ventasUsuario: kpis.ventas, puntosUsuario: kpis.puntos, equipoUsuario: 'Global' },
      chartTeams, chartProductos, isAdminOrBackoffice: true,
      monthYear: `${now.getMonth() + 1}/${now.getFullYear()}`
    };

    global.initDashboardCache.data      = response;
    global.initDashboardCache.updatedAt = Date.now();
    if (global.broadcastDashboardUpdate) global.broadcastDashboardUpdate({ kpis, chartTeams, chartProductos, timestamp: response.timestamp });
    console.log(`[INIT-DASHBOARD] Cache refrescada (${elapsed}ms)`);
    return response;
  } catch (e) {
    console.warn('[INIT-DASHBOARD] Error:', e.message);
    throw e;
  } finally {
    global.initDashboardCacheRefreshing = false;
  }
}

// ── ENDPOINTS GRIDFS NOTAS ────────────────────────────────────

app.post('/api/files/upload', protect, noteUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se proporcionó archivo' });
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else    return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    const { leadId } = req.body;
    const file       = req.file;
    const filename   = `${Date.now()}-${file.originalname}`;
    let   fileType   = 'document';
    if (file.mimetype.startsWith('image/'))       fileType = 'image';
    else if (file.mimetype.startsWith('audio/'))  fileType = 'audio';
    else if (file.mimetype.startsWith('video/'))  fileType = 'video';
    else if (file.mimetype === 'application/pdf') fileType = 'pdf';

    const uploadStream = gridFSBucket.openUploadStream(filename, {
      contentType: file.mimetype,
      metadata: { leadId: leadId || null, uploadedBy: req.user?.username || 'unknown', uploadedAt: new Date(), originalName: file.originalname, fileType }
    });
    uploadStream.write(file.buffer);
    uploadStream.end();
    await new Promise((resolve, reject) => { uploadStream.on('finish', resolve); uploadStream.on('error', reject); });

    return res.json({ success: true, data: {
      fileId: uploadStream.id.toString(), filename, originalName: file.originalname,
      contentType: file.mimetype, fileType, size: file.size, url: `/api/files/${uploadStream.id}`
    }});
  } catch (e) {
    console.error('[GridFS] Error upload:', e);
    return res.status(500).json({ success: false, message: 'Error al subir archivo', error: e.message });
  }
});

app.get('/api/files/:id', async (req, res) => {
  try {
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else    return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    let objectId;
    try { objectId = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }
    const fileDoc = await db.collection('noteFiles.files').findOne({ _id: objectId });
    if (!fileDoc) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });

    const fileSize    = fileDoc.length;
    const contentType = fileDoc.contentType || 'application/octet-stream';
    const range       = req.headers.range;

    if (range && (contentType.startsWith('audio/') || contentType.startsWith('video/'))) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': (end - start) + 1,
        'Content-Type':   contentType
      });
      gridFSBucket.openDownloadStream(objectId, { start, end: end + 1 }).pipe(res);
    } else {
      res.set({ 'Content-Type': contentType, 'Content-Length': fileSize, 'Accept-Ranges': 'bytes',
                'Content-Disposition': `inline; filename="${fileDoc.filename}"` });
      gridFSBucket.openDownloadStream(objectId).pipe(res);
    }
  } catch (e) {
    console.error('[GridFS GET]', e);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error', error: e.message });
  }
});

app.get('/api/files/:id/download', async (req, res) => {
  try {
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else    return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    let objectId;
    try { objectId = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }
    const fileDoc = await db.collection('noteFiles.files').findOne({ _id: objectId });
    if (!fileDoc) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
    res.set({ 'Content-Type': fileDoc.contentType || 'application/octet-stream', 'Content-Length': fileDoc.length,
              'Content-Disposition': `attachment; filename="${fileDoc.metadata?.originalName || fileDoc.filename}"` });
    gridFSBucket.openDownloadStream(objectId).pipe(res);
  } catch (e) {
    console.error('[GridFS DOWNLOAD]', e);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error', error: e.message });
  }
});

app.delete('/api/files/:id', protect, async (req, res) => {
  try {
    if (!gridFSBucket) {
      if (db) gridFSBucket = new GridFSBucket(db, { bucketName: 'noteFiles' });
      else    return res.status(503).json({ success: false, message: 'GridFS no disponible' });
    }
    let objectId;
    try { objectId = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }
    await gridFSBucket.delete(objectId);
    return res.json({ success: true, message: 'Archivo eliminado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error', error: e.message });
  }
});

// ── GRIDFS AVATARES ───────────────────────────────────────────
async function ensureUserAvatarBucket() {
  if (userAvatarsBucket) return userAvatarsBucket;
  if (!db) db = getDb();
  if (!db) throw new Error('GridFS no disponible');
  userAvatarsBucket = new GridFSBucket(db, { bucketName: 'userAvatars' });
  return userAvatarsBucket;
}

const IMAGE_MIME_EXT = { 'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif' };
function inferImageExtension(mime, fallback = 'png') { return IMAGE_MIME_EXT[(mime||'').toLowerCase()] || fallback; }
function bufferToStream(buffer) { return new Readable({ read() { this.push(buffer); this.push(null); } }); }

function downloadBufferFromUrl(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    try {
      const target = url.startsWith('//') ? `https:${url}` : url;
      const parsed = new URL(target);
      const client = parsed.protocol === 'https:' ? https : http;
      const request = client.get({
        hostname: parsed.hostname, path: `${parsed.pathname}${parsed.search}`,
        protocol: parsed.protocol, headers: { 'User-Agent': 'agentes-dashboard-avatar/1.0', Accept: 'image/*,*/*;q=0.8' }
      }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && redirectsLeft > 0) {
          resp.resume();
          return resolve(downloadBufferFromUrl(new URL(resp.headers.location, target).toString(), redirectsLeft - 1));
        }
        if (resp.statusCode !== 200) { resp.resume(); return reject(new Error(`HTTP ${resp.statusCode}`)); }
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => resolve(Buffer.concat(chunks)));
      });
      request.on('error', reject);
    } catch (e) { reject(e); }
  });
}

async function processAvatarWithCloudinary(inputBuffer, options = {}) {
  if (!Buffer.isBuffer(inputBuffer)) throw new Error('Buffer de avatar inválido');
  const { mimetype = 'image/png' } = options;
  const details = { backgroundRemoved: false, processor: CLOUDINARY_BG_REMOVAL_ENABLED ? 'cloudinary_ai' : null, bytesBefore: inputBuffer.length };

  if (!CLOUDINARY_BG_REMOVAL_ENABLED) {
    details.bytesAfter = inputBuffer.length;
    return { buffer: inputBuffer, contentType: mimetype || 'image/png', extension: inferImageExtension(mimetype), details };
  }

  const startedAt = Date.now();
  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: 'image', folder: CLOUDINARY_AVATAR_FOLDER, background_removal: 'cloudinary_ai',
        overwrite: true, format: 'png', use_filename: false, unique_filename: true,
        transformation: [{ width: 800, height: 800, crop: 'limit' }]
      }, (error, result) => error ? reject(error) : resolve(result));
      bufferToStream(inputBuffer).pipe(stream);
    });

    const processedUrl    = uploadResult?.secure_url || cloudinary.url(uploadResult.public_id, { secure: true, format: 'png' });
    const processedBuffer = await downloadBufferFromUrl(processedUrl);

    Object.assign(details, {
      backgroundRemoved: true, processor: 'cloudinary_ai', bytesAfter: processedBuffer.length,
      processingMs: Date.now() - startedAt, cloudinaryPublicId: uploadResult?.public_id || null,
      cloudinaryAssetId: uploadResult?.asset_id || null, cloudinaryVersion: uploadResult?.version || null,
      secureUrl: processedUrl, uploadedAt: uploadResult?.created_at ? new Date(uploadResult.created_at) : new Date()
    });
    return { buffer: processedBuffer, contentType: 'image/png', extension: 'png', details };
  } catch (e) {
    details.processingError = e?.message || String(e);
    details.bytesAfter = inputBuffer.length;
    console.warn('[Avatar] Cloudinary falló, usando original:', details.processingError);
    return { buffer: inputBuffer, contentType: mimetype || 'image/png', extension: inferImageExtension(mimetype), details };
  }
}

app.post('/api/users/me/avatar', protect, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.user?.username) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (!req.file)           return res.status(400).json({ success: false, message: 'No se proporcionó archivo' });
    if (!isConnected())      return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!db)                 return res.status(503).json({ success: false, message: 'BD no disponible' });

    const bucket   = await ensureUserAvatarBucket();
    const usersCol = db.collection('users');
    const existing = await usersCol.findOne({ username: req.user.username }, { projection: { avatarFileId:1, avatarCloudinaryPublicId:1 } });
    const sanitized = req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'avatar.png';
    const baseName  = path.basename(sanitized, path.extname(sanitized)) || 'avatar';
    const processing = await processAvatarWithCloudinary(req.file.buffer, { originalName: sanitized, mimetype: req.file.mimetype, username: req.user.username });
    const finalExt  = processing.extension || inferImageExtension(req.file.mimetype);
    const finalFile = `${Date.now()}-${baseName}.${finalExt}`;

    const metaRaw = {
      userId: req.user.id?.toString() || null, username: req.user.username, uploadedAt: new Date(),
      originalName: req.file.originalname, originalMimeType: req.file.mimetype, sanitizedFilename: sanitized,
      backgroundRemoved: Boolean(processing.details?.backgroundRemoved), backgroundProcessor: processing.details?.processor || null,
      cloudinaryPublicId: processing.details?.cloudinaryPublicId || null, cloudinaryAssetId: processing.details?.cloudinaryAssetId || null,
      cloudinaryVersion: processing.details?.cloudinaryVersion || null, cloudinarySecureUrl: processing.details?.secureUrl || null,
      bytesOriginal: processing.details?.bytesBefore ?? req.file.size, bytesProcessed: processing.details?.bytesAfter ?? null,
      processingMs: processing.details?.processingMs ?? null, processingError: processing.details?.processingError || null
    };
    const metadata = Object.fromEntries(Object.entries(metaRaw).filter(([,v]) => v !== undefined));

    const uploadStream = bucket.openUploadStream(finalFile, { contentType: processing.contentType, metadata });
    uploadStream.end(processing.buffer);
    await new Promise((resolve, reject) => { uploadStream.on('finish', resolve); uploadStream.on('error', reject); });

    const fileId    = uploadStream.id.toString();
    const avatarUrl = `/api/user-avatars/${fileId}`;
    const setP = { avatarFileId: fileId, avatarUrl, avatarUpdatedAt: new Date(), avatarBackgroundRemoved: Boolean(processing.details?.backgroundRemoved) };
    const unsetP = {};
    if (processing.details?.backgroundRemoved) setP.avatarProcessor = processing.details.processor;
    else unsetP.avatarProcessor = '';
    if (processing.details?.cloudinaryPublicId) {
      setP.avatarCloudinaryPublicId = processing.details.cloudinaryPublicId;
      if (processing.details?.cloudinaryVersion != null) setP.avatarCloudinaryVersion = processing.details.cloudinaryVersion;
      else unsetP.avatarCloudinaryVersion = '';
    } else { unsetP.avatarCloudinaryPublicId = ''; unsetP.avatarCloudinaryVersion = ''; }

    const updateDoc = { $set: setP };
    if (Object.keys(unsetP).length) updateDoc.$unset = unsetP;
    await usersCol.updateOne({ username: req.user.username }, updateDoc);

    if (existing?.avatarFileId && existing.avatarFileId !== fileId) {
      try { await bucket.delete(new ObjectId(existing.avatarFileId)); } catch (_) {}
    }
    if (existing?.avatarCloudinaryPublicId && existing.avatarCloudinaryPublicId !== (processing.details?.cloudinaryPublicId || null) && CLOUDINARY_HAS_CREDENTIALS) {
      try { await cloudinary.uploader.destroy(existing.avatarCloudinaryPublicId, { invalidate: true }); } catch (_) {}
    }

    return res.json({ success: true, message: 'Avatar actualizado', data: { url: avatarUrl, fileId, backgroundRemoved: Boolean(processing.details?.backgroundRemoved) } });
  } catch (e) {
    console.error('[Avatar Upload]', e);
    return res.status(500).json({ success: false, message: 'Error al actualizar avatar', error: e.message });
  }
});

app.get('/api/user-avatars/:id', async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const bucket = await ensureUserAvatarBucket();
    let objectId;
    try { objectId = new ObjectId(req.params.id); }
    catch { return res.status(400).json({ success: false, message: 'ID inválido' }); }

    const fileDoc = await db.collection('userAvatars.files').findOne({ _id: objectId });
    if (!fileDoc) {
      const defaultPath = path.join(__dirname, 'images', 'avatar.png');
      if (fs.existsSync(defaultPath)) { res.type('png'); res.set('Cache-Control','public, max-age=86400'); return res.sendFile(defaultPath); }
      const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="100%" height="100%" fill="#e2e8f0"/><circle cx="60" cy="45" r="26" fill="#f8fafc"/><rect x="15" y="80" width="90" height="22" rx="10" fill="#f8fafc"/></svg>`;
      res.type('image/svg+xml'); res.set('Cache-Control','public, max-age=86400'); return res.send(svg);
    }
    res.set({ 'Content-Type': fileDoc.contentType || 'image/png', 'Cache-Control': 'private, max-age=86400', 'Accept-Ranges': 'bytes' });
    const dl = bucket.openDownloadStream(objectId);
    dl.on('error', e => { if (!res.headersSent) res.status(500).json({ success: false, message: 'Error leyendo avatar', error: e.message }); });
    dl.pipe(res);
  } catch (e) {
    console.error('[Avatar Fetch]', e);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error interno', error: e.message });
  }
});

app.delete('/api/users/me/avatar', protect, async (req, res) => {
  try {
    if (!req.user?.username) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (!isConnected())      return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const bucket   = await ensureUserAvatarBucket();
    const usersCol = db.collection('users');
    const user     = await usersCol.findOne({ username: req.user.username }, { projection: { avatarFileId:1 } });
    if (!user?.avatarFileId) return res.json({ success: true, message: 'Sin avatar', data: { url: null } });
    try { await bucket.delete(new ObjectId(user.avatarFileId)); } catch (_) {}
    await usersCol.updateOne({ username: req.user.username }, { $unset: { avatarFileId:'', avatarUrl:'', avatarUpdatedAt:'' } });
    return res.json({ success: true, message: 'Avatar eliminado', data: { url: null } });
  } catch (e) {
    console.error('[Avatar Delete]', e);
    return res.status(500).json({ success: false, message: 'Error al eliminar avatar', error: e.message });
  }
});

// ── ENDPOINTS TEAM LÍNEAS ─────────────────────────────────────
app.get('/api/lineas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const { username, role } = req.user;
    const privilegedRoles = ['admin','administrador','backoffice','back office','back_office','bo','b.o','supervisor','supervisor team lineas'];
    const isPrivileged = privilegedRoles.some(r => (role||'').toLowerCase() === r || (role||'').toLowerCase().includes(r));
    const filter = isPrivileged ? {} : {
      $or: [{ agente: username },{ agenteNombre: username },{ createdBy: username },{ registeredBy: username }]
    };
    const registros = await db.collection('Lineas').find(filter).sort({ creadoEn: -1 }).toArray();
    return res.json({ success: true, data: registros, count: registros.length, user: username, filtered: !isPrivileged });
  } catch (e) {
    console.error('[GET /api/lineas]', e);
    return res.status(500).json({ success: false, message: 'Error al consultar Lineas', error: e.message });
  }
});

app.post('/api/lineas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const body     = req.body || {};
    const user     = req.user;
    const username = user?.username || '';

    const toUpper  = s => (s == null ? '' : String(s).trim().toUpperCase());
    const digitsOnly = s => (s == null ? '' : String(s).replace(/\D+/g,''));
    const asDate   = s => { if (!s) return null; return normalizeDateToString(s) || null; };
    const normalizeCollectionName = s => {
      try {
        return String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .replace(/[^A-Za-z0-9_\s-]/g,' ').replace(/[\s-]+/g,'_').replace(/_+/g,'_')
          .replace(/^_+|_+$/g,'').toUpperCase() || 'UNKNOWN';
      } catch { return String(s||'').trim().replace(/[\s-]+/g,'_').toUpperCase() || 'UNKNOWN'; }
    };
    const normalizeAgentDisplay = s => String(s||'').trim().replace(/_/g,' ').replace(/\s+/g,' ').toUpperCase();

    const errors   = [];
    const required = ['nombre_cliente','telefono_principal','numero_cuenta','autopay','pin_seguridad','direccion','dia_venta','dia_instalacion','status','cantidad_lineas','id','mercado','supervisor'];
    for (const f of required) {
      if (body[f] == null || body[f] === '' || (Array.isArray(body[f]) && !body[f].length)) errors.push(`Campo requerido: ${f}`);
    }
    if (errors.length) return res.status(400).json({ success: false, message: 'Validación fallida', errors });

    const cantidadLineas = Number(body.cantidad_lineas || 0);
    const telefonos = (Array.isArray(body.telefonos) ? body.telefonos : []).map(digitsOnly).filter(Boolean);
    const servicios  = Array.isArray(body.servicios) ? body.servicios.map(String) : [];

    const autopayVal = String(body.autopay || '').toLowerCase();
    if (!['si','no'].includes(autopayVal)) errors.push('autopay debe ser si | no');

    const statusNorm = normalizeStatus(body.status);
    if (!['pending','rescheduled'].includes(statusNorm)) errors.push('status inválido (permitidos: pending, repro/rescheduled)');

    const mercado = String(body.mercado||'').toLowerCase();
    if (!['bamo','icon'].includes(mercado)) errors.push('mercado debe ser bamo | icon');

    let supervisorVal = String(body.supervisor||'').toLowerCase();
    if (!supervisorVal && user.supervisor) supervisorVal = String(user.supervisor).toLowerCase();
    else if (!supervisorVal && user.team) {
      const t = String(user.team).toLowerCase();
      if (t.includes('jonathan')) supervisorVal = 'jonathan f';
      else if (t.includes('luis')) supervisorVal = 'luis g';
    }
    if (!supervisorVal) errors.push('No se pudo determinar el supervisor');
    if (!['jonathan f','luis g'].includes(supervisorVal)) errors.push('supervisor inválido (permitidos: JONATHAN F, LUIS G)');
    if (!cantidadLineas || isNaN(cantidadLineas) || cantidadLineas < 1 || cantidadLineas > 5) errors.push('cantidad_lineas debe ser 1-5');
    if (telefonos.length !== cantidadLineas) errors.push('La cantidad de teléfonos debe coincidir con cantidad_lineas');
    if (errors.length) return res.status(400).json({ success: false, message: 'Validación fallida', errors });

    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });

    let targetAgent = username;
    if ((user.role||'').toLowerCase().includes('supervisor') && body.agenteAsignado) targetAgent = body.agenteAsignado;
    const targetCollectionName = normalizeCollectionName(targetAgent);

    const payloadLines    = Array.isArray(body.lines) ? body.lines : (Array.isArray(body.lineas) ? body.lineas : []);
    const payloadLineasSt = (body.lineas_status && typeof body.lineas_status === 'object') ? body.lineas_status : null;
    const normalizeLineSt = v => String(v||'').trim().toUpperCase() || '';

    const initialLineasStatus = {};
    const initialLines = [];
    for (let i = 0; i < cantidadLineas; i++) {
      let st = '';
      if (payloadLineasSt && Object.prototype.hasOwnProperty.call(payloadLineasSt, i)) st = normalizeLineSt(payloadLineasSt[i]);
      if (!st && payloadLines[i]) st = normalizeLineSt(payloadLines[i].estado ?? payloadLines[i].status ?? '');
      if (!st) st = statusNorm === 'pending' ? 'PENDING' : statusNorm.toUpperCase();
      initialLineasStatus[i] = st;
      initialLines.push({ telefono: telefonos[i]||digitsOnly(payloadLines[i]?.telefono)||'', servicio: servicios[i]||String(payloadLines[i]?.servicio||''), estado: st });
    }

    const now = new Date();
    const doc = {
      team: 'team lineas', nombre_cliente: toUpper(body.nombre_cliente),
      telefono_principal: digitsOnly(body.telefono_principal), numero_cuenta: String(body.numero_cuenta||'').trim(),
      autopay: autopayVal === 'si', pin_seguridad: String(body.pin_seguridad||'').trim(),
      direccion: String(body.direccion||'').trim(), servicios,
      dia_venta: asDate(body.dia_venta), dia_instalacion: asDate(body.dia_instalacion),
      status: statusNorm.toUpperCase(), cantidad_lineas: cantidadLineas, telefonos,
      ID: String(body.id||'').trim(), mercado: mercado.toUpperCase(), supervisor: supervisorVal.toUpperCase(),
      userId: user?._id || user?.id || null,
      agente:                    normalizeAgentDisplay(username),
      agenteAsignado:            normalizeAgentDisplay(targetAgent),
      agenteAsignadoCollection:  targetCollectionName,
      lineas_status: initialLineasStatus, lines: initialLines,
      creadoEn: now, actualizadoEn: now, _raw: body
    };

    const result = await teamLineasDb.collection(targetCollectionName).insertOne(doc);
    return res.status(201).json({ success: true, message: `Guardado en TEAM_LINEAS > ${targetCollectionName}`, id: result.insertedId?.toString(), data: doc });
  } catch (e) {
    console.error('[POST /api/lineas]', e);
    return res.status(500).json({ success: false, message: 'Error al crear registro de Líneas', error: e.message });
  }
});

app.put('/api/lineas-team/update', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const body     = req.body || {};
    const clientId = body.id;
    if (!clientId) return res.status(400).json({ success: false, message: 'ID requerido' });

    const toUpper = s => (s == null ? '' : String(s).trim().toUpperCase());
    const asDate  = s => { if (!s) return null; return normalizeDateToString(s) || null; };

    const updateData = {
      nombre_cliente:     body.nombre_cliente     ? toUpper(body.nombre_cliente) : undefined,
      telefono_principal: body.telefono_principal ? String(body.telefono_principal).replace(/\D+/g,'') : undefined,
      numero_cuenta:      body.numero_cuenta      ? String(body.numero_cuenta).trim() : undefined,
      cantidad_lineas:    body.cantidad_lineas    ? Number(body.cantidad_lineas) : undefined,
      status:             body.status             ? normalizeStatus(body.status).toUpperCase() : undefined,
      dia_venta:          body.dia_venta          ? asDate(body.dia_venta) : undefined,
      dia_instalacion:    body.dia_instalacion    ? asDate(body.dia_instalacion) : undefined,
      actualizadoEn:      new Date()
    };
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);

    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });

    const cols = (await teamLineasDb.listCollections().toArray()).map(c => c.name).filter(Boolean);
    let updated = false;
    for (const colName of cols) {
      try {
        let filter;
        try { filter = { _id: new ObjectId(clientId) }; } catch (_) { filter = { _id: clientId }; }
        const result = await teamLineasDb.collection(colName).updateOne(filter, { $set: updateData });
        if (result && result.matchedCount > 0) { updated = true; break; }
      } catch (_) {}
    }
    if (!updated) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    return res.json({ success: true, message: 'Registro actualizado' });
  } catch (e) {
    console.error('[PUT /api/lineas-team/update]', e);
    return res.status(500).json({ success: false, message: 'Error al actualizar Líneas', error: e.message });
  }
});

app.post('/api/lineas-team/notes', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const { clientId, texto, type } = req.body || {};
    if (!clientId) return res.status(400).json({ success: false, message: 'clientId requerido' });
    let leadObjectId;
    try { leadObjectId = new ObjectId(clientId); } catch { leadObjectId = clientId; }
    const nota = { leadId: leadObjectId, texto: String(texto||'').slice(0, 1000), type: type || 'general', autor: req.user?.username || 'Sistema', createdAt: new Date() };
    await db.collection('lineas_notes').insertOne(nota);
    return res.json({ success: true, message: 'Nota guardada', data: nota });
  } catch (e) {
    console.error('[POST /api/lineas-team/notes]', e);
    return res.status(500).json({ success: false, message: 'Error al guardar nota', error: e.message });
  }
});

app.post('/api/lineas-team/notes/edit', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const { clientId, noteId, texto } = req.body || {};
    if (!clientId || !noteId) return res.status(400).json({ success: false, message: 'clientId y noteId requeridos' });
    let noteObjectId;
    try { noteObjectId = new ObjectId(noteId); } catch { noteObjectId = noteId; }
    const result = await db.collection('lineas_notes').updateOne(
      { _id: noteObjectId },
      { $set: { texto: String(texto||'').slice(0,1000), updatedAt: new Date(), updatedBy: req.user?.username } }
    );
    if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Nota no encontrada' });
    return res.json({ success: true, message: 'Nota actualizada' });
  } catch (e) {
    console.error('[POST /api/lineas-team/notes/edit]', e);
    return res.status(500).json({ success: false, message: 'Error al editar nota', error: e.message });
  }
});

app.post('/api/lineas-team/notes/delete', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const { noteId } = req.body || {};
    if (!noteId) return res.status(400).json({ success: false, message: 'noteId requerido' });
    let noteObjectId;
    try { noteObjectId = new ObjectId(noteId); } catch { noteObjectId = noteId; }
    const result = await db.collection('lineas_notes').deleteOne({ _id: noteObjectId });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: 'Nota no encontrada' });
    return res.json({ success: true, message: 'Nota eliminada' });
  } catch (e) {
    console.error('[POST /api/lineas-team/notes/delete]', e);
    return res.status(500).json({ success: false, message: 'Error al eliminar nota', error: e.message });
  }
});

app.delete('/api/lineas-team/delete', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const clientId = (req.body || {}).id;
    if (!clientId) return res.status(400).json({ success: false, message: 'ID requerido' });
    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });
    const cols = (await teamLineasDb.listCollections().toArray()).map(c => c.name).filter(Boolean);
    let deleted = false;
    for (const colName of cols) {
      try {
        const result = await teamLineasDb.collection(colName).deleteOne({ _id: new ObjectId(clientId) });
        if (result.deletedCount > 0) { deleted = true; break; }
      } catch (_) {}
    }
    if (!deleted) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    return res.json({ success: true, message: 'Registro eliminado' });
  } catch (e) {
    console.error('[DELETE /api/lineas-team/delete]', e);
    return res.status(500).json({ success: false, message: 'Error al eliminar registro de Líneas', error: e.message });
  }
});

// ── INIT-DASHBOARD ────────────────────────────────────────────
app.get('/api/init-dashboard', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const user     = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();
    const isAdmin  = ['admin','administrator','administrador','administradora'].some(r => userRole.includes(r));
    const isBO     = ['backoffice','bo'].some(r => userRole.includes(r));
    const isSup    = userRole.includes('supervisor');
    const isAgent  = userRole.includes('agente') || userRole.includes('agent');
    const isAdmOrBO = isAdmin || isBO;

    const now        = new Date();
    const curMonth   = now.getMonth();
    const curYear    = now.getFullYear();
    const monthStart = new Date(curYear, curMonth, 1);
    const monthEnd   = new Date(curYear, curMonth + 1, 1);

    const supervisorAgents = isSup ? getSupervisorAgents(username) : [];
    let usersForData = null;
    if (isSup) usersForData = supervisorAgents;

    const dateConditions = [
      { dia_venta:          { $gte: monthStart, $lt: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lt: monthEnd } },
      { creadoEn:           { $gte: monthStart, $lt: monthEnd } },
      { createdAt:          { $gte: monthStart, $lt: monthEnd } },
      { fecha:              { $gte: monthStart, $lt: monthEnd } }
    ];

    const colchonCondition = {
      $and: [
        { dia_instalacion: { $gte: monthStart, $lt: monthEnd } },
        { dia_venta:       { $lt: monthStart } },
        { $or: [
          { status: { $regex: /^(completed|active|pending|completado|activo|activa|vendido)$/i } }
        ]}
      ]
    };

    const userFilter = usersForData
      ? { $or: [{ agenteNombre: { $in: usersForData } },{ agente: { $in: usersForData } },{ usuario: { $in: usersForData } }] }
      : {};

    const baseFilter = { $or: [...dateConditions, colchonCondition] };
    const filter = (usersForData && usersForData.length > 0)
      ? { $and: [baseFilter, userFilter] }
      : baseFilter;

    const leads = await dbInst.collection('costumers_unified')
      .find(filter)
      .project({ _id:1, agenteNombre:1, agente:1, usuario:1, servicios:1, tipo_servicios:1, puntaje:1, status:1, dia_venta:1, dia_instalacion:1, creadoEn:1, createdAt:1, nombre_cliente:1 })
      .sort({ dia_venta: -1 })
      .limit(20000)
      .toArray();

    const colchonLeads = leads.filter(l => isColchonActivo(l, now)); // Solo colchones completed cuentan
    const ventasLeads  = leads.filter(l => isCompleted(l.status) && !isColchon(l, now));
    const totalPuntos  = ventasLeads.reduce((s, l) => s + parseFloat(l.puntaje || 0), 0);

    const kpis = {
      ventas:         ventasLeads.length,
      puntos:         totalPuntos,
      mayor_vendedor: '-',
      mejor_team:     '-',
      canceladas:     leads.filter(l => isCancelled(l.status) && !isColchon(l, now)).length,
      pendientes:     leads.filter(l => isPending(l.status)   && !isColchon(l, now)).length,
      colchon:        colchonLeads.length,
      colchon_puntos: colchonLeads.reduce((s, l) => s + parseFloat(l.puntaje || 0), 0)
    };

    if (ventasLeads.length > 0) {
      const agentPuntos = {};
      ventasLeads.forEach(l => {
        const a = l.agenteNombre || l.agente || '-';
        agentPuntos[a] = (agentPuntos[a] || 0) + parseFloat(l.puntaje || 0);
      });
      const top = Object.entries(agentPuntos).sort((a, b) => b[1] - a[1])[0];
      kpis.mayor_vendedor = top ? top[0] : '-';
    }

    try {
      const allLeadsTeams = await dbInst.collection('costumers_unified')
        .find({ $or: dateConditions })
        .project({ agenteNombre:1, agente:1, usuario:1, puntaje:1, status:1, dia_venta:1, dia_instalacion:1 })
        .toArray();
      const users = await dbInst.collection('users').find({}).project({ username:1, team:1 }).toArray();
      const agentTeamMap = new Map();
      users.forEach(u => { if (u.username) agentTeamMap.set(normText(u.username), u.team || 'Sin equipo'); });
      const teamPuntos = {};
      allLeadsTeams.filter(l => isCompleted(l.status) && !isColchon(l, now)).forEach(l => {
        const agent = l.agenteNombre || l.agente || l.usuario || '-';
        const team  = agentTeamMap.get(normText(agent)) || 'Sin equipo';
        teamPuntos[team] = (teamPuntos[team] || 0) + parseFloat(l.puntaje || 0);
      });
      const topTeam = Object.entries(teamPuntos).sort((a, b) => b[1] - a[1])[0];
      kpis.mejor_team = topTeam ? topTeam[0] : '-';
    } catch (_) {}

    const agentMap   = {};
    const productMap = {};
    ventasLeads.forEach(lead => {
      const agent = lead.agenteNombre || lead.agente || 'Sin asignar';
      agentMap[agent] = (agentMap[agent] || 0) + 1;
      let services = lead.servicios || lead.tipo_servicios || [];
      if (typeof services === 'string') services = [services];
      if (!Array.isArray(services)) services = [];
      services.forEach(s => { if (s) productMap[s] = (productMap[s] || 0) + 1; });
    });
    const chartTeams     = Object.entries(agentMap).map(([nombre, count]) => ({ nombre, count })).sort((a,b)=>b.count-a.count).slice(0,50);
    const chartProductos = Object.entries(productMap).map(([servicio, count]) => ({ servicio, count })).sort((a,b)=>b.count-a.count).slice(0,5);

    let userPersonalStats = { ventasPersonales:0, puntosPersonales:0, posicionRanking:'-', nombreUsuario: user?.name || username };
    if (!isAdmOrBO) {
      const userLeads = leads.filter(l => isCompleted(l.status) && !isColchon(l, now) && normText(l.agenteNombre || l.agente || l.usuario || '') === normText(username));
      userPersonalStats.ventasPersonales = userLeads.length;
      userPersonalStats.puntosPersonales = Math.round(userLeads.reduce((s, l) => s + parseFloat(l.puntaje || 0), 0) * 100) / 100;
    }
    if (isAgent && !isAdmOrBO) {
      const allLeads = await dbInst.collection('costumers_unified').find({ $or: dateConditions }).project({ agenteNombre:1, agente:1, puntaje:1, status:1, dia_venta:1, dia_instalacion:1 }).toArray();
      const agentStats = {};
      allLeads.filter(l => isCompleted(l.status) && !isColchon(l, now)).forEach(l => {
        const a = l.agenteNombre || l.agente || '-';
        agentStats[a] = (agentStats[a] || 0) + parseFloat(l.puntaje || 0);
      });
      const ranking = Object.entries(agentStats).map(([name, pts]) => ({ name, pts })).sort((a,b)=>b.pts-a.pts);
      const pos = ranking.findIndex(r => normText(r.name) === normText(username)) + 1;
      userPersonalStats.posicionRanking = pos > 0 ? `#${pos}/${ranking.length}` : '-';
    }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role, team: user?.team || 'Sin equipo', name: user?.name || username },
      kpis,
      userStats: { ventasUsuario: userPersonalStats.ventasPersonales, puntosUsuario: userPersonalStats.puntosPersonales, equipoUsuario: user?.team || 'Sin equipo' },
      userPersonalStats, chartTeams, chartProductos,
      isAdmin, isBackoffice: isBO, isSupervisor: isSup, isAgent,
      roleInfo: { supervisorAgents: isSup ? supervisorAgents : [], viewAllUsers: isAdmOrBO },
      monthYear: `${curMonth + 1}/${curYear}`
    });
  } catch (e) {
    console.error('[INIT-DASHBOARD] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar dashboard', error: e.message });
  }
});

app.get('/api/init-dashboard-debug', protect, (req, res) => {
  try {
    const cache = global.initDashboardCache || { data: null, updatedAt: 0 };
    return res.json({ success: true, cache });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── INIT-RANKINGS ─────────────────────────────────────────────
app.get('/api/init-rankings', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user = req.user;
    const now  = new Date();
    const curMonth   = now.getMonth();
    const curYear    = now.getFullYear();
    const monthStart = new Date(curYear, curMonth, 1);
    const monthEnd   = new Date(curYear, curMonth + 1, 0, 23, 59, 59);

    let currentMonthRanking = [];
    try {
      const rankAgg = await dbInst.collection('costumers_unified').aggregate([
        {
          $match: {
            $or: [
              { createdAt: { $gte: monthStart, $lte: monthEnd } },
              { dia_venta: { $gte: monthStart, $lte: monthEnd } },
              { fecha:     { $gte: monthStart, $lte: monthEnd } }
            ]
          }
        },
        { $match: { $expr: completedMatchExpr } },
        { $match: { $expr: { $gte: [{ $ifNull: ['$dia_venta', monthStart] }, monthStart] } } },
        {
          $group: {
            _id:          { $toLower: { $trim: { input: { $ifNull: ['$agenteNombre',''] } } } },
            agenteNombre: { $first: '$agenteNombre' },
            sumPuntaje:   { $sum: { $toDouble: { $ifNull: ['$puntaje', 0] } } },
            ventas:       { $sum: 1 }
          }
        },
        { $sort: { sumPuntaje: -1, ventas: -1 } },
        { $limit: 30 }
      ]).toArray();

      currentMonthRanking = rankAgg.map((r, idx) => ({
        agente:   r._id,
        nombre:   r.agenteNombre || r._id,
        puntos:   Number(r.sumPuntaje.toFixed(2)),
        puntaje:  Number(r.sumPuntaje.toFixed(2)),
        ventas:   r.ventas,
        posicion: idx + 1, position: idx + 1,
        mes:      `${curYear}-${String(curMonth + 1).padStart(2,'0')}`
      }));
    } catch (e) { console.warn('[INIT-RANKINGS] ranking mes actual:', e.message); }

    const monthlyRankings = {};
    try {
      for (let i = 0; i < 6; i++) {
        const d      = new Date(curYear, curMonth - i, 1);
        const m      = d.getMonth(); const y = d.getFullYear();
        const mStart = new Date(y, m, 1);
        const mEnd   = new Date(y, m + 1, 0, 23, 59, 59);
        const key    = `${y}-${String(m + 1).padStart(2,'0')}`;
        try {
          const agg = await dbInst.collection('costumers_unified').aggregate([
            { $match: { createdAt: { $gte: mStart, $lte: mEnd } } },
            { $match: { $expr: completedMatchExpr } },
            {
              $group: {
                _id:          { $toLower: { $trim: { input: { $ifNull: ['$agente',''] } } } },
                agenteNombre: { $first: '$agente' },
                sumPuntaje:   { $sum: { $toDouble: { $ifNull: ['$puntaje', 0] } } },
                ventas:       { $sum: 1 }
              }
            },
            { $sort: { sumPuntaje: -1, ventas: -1 } },
            { $limit: 15 }
          ]).toArray();
          monthlyRankings[key] = agg.map((r, idx) => ({
            agente: r._id, nombre: r.agenteNombre || r._id,
            puntos: Number((r.sumPuntaje || 0).toFixed(2)), ventas: r.ventas || 0,
            position: idx + 1, mes: key
          }));
        } catch (e) {
          console.warn(`[INIT-RANKINGS] ${key}:`, e.message);
          monthlyRankings[key] = [];
        }
      }
    } catch (e) { console.warn('[INIT-RANKINGS] histórico:', e.message); }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role, team: user?.team || 'Sin equipo' },
      data: {
        currentMonthRanking, monthlyRankings,
        topThree: { first: currentMonthRanking[0]||null, second: currentMonthRanking[1]||null, third: currentMonthRanking[2]||null },
        monthYear: `${curMonth + 1}/${curYear}`
      },
      ttl: 5 * 60 * 1000
    });
  } catch (e) {
    console.error('[INIT-RANKINGS] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar rankings', error: e.message });
  }
});

// ── INIT-ESTADÍSTICAS ─────────────────────────────────────────
app.get('/api/init-estadisticas', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user = req.user;
    const now  = new Date();
    const curMonth   = now.getMonth();
    const curYear    = now.getFullYear();
    const monthStart = new Date(curYear, curMonth, 1);
    const monthEnd   = new Date(curYear, curMonth + 1, 0, 23, 59, 59);
    const dateConditions = [
      { dia_venta:          { $gte: monthStart, $lte: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } },
      { creadoEn:           { $gte: monthStart, $lte: monthEnd } },
      { createdAt:          { $gte: monthStart, $lte: monthEnd } }
    ];

    let teamsData = [];
    try {
      const agg = await dbInst.collection('costumers_unified').aggregate([
        { $match: { $or: dateConditions } },
        {
          $group: {
            _id:         { $ifNull: ['$supervisor', 'Sin equipo'] },
            totalLeads:  { $sum: 1 },
            totalVentas: { $sum: { $cond: [{ $expr: completedMatchExpr }, 1, 0] } },
            ACTIVAS:     { $sum: { $cond: [{ $expr: completedMatchExpr }, 1, 0] } },
            promedio:    { $avg: { $toDouble: { $ifNull: ['$puntaje', 0] } } }
          }
        },
        { $sort: { totalLeads: -1 } },
        { $limit: 20 }
      ]).toArray();
      teamsData = agg.map(s => ({
        name: s._id || 'Sin equipo', equipo: s._id || 'Sin equipo',
        Total: s.totalLeads, totalVentas: s.totalVentas,
        Puntaje: Math.round(s.promedio || 0), ACTIVAS: s.ACTIVAS, porcentaje: 0
      }));
    } catch (e) { console.warn('[INIT-ESTADISTICAS] teams:', e.message); }

    let agentsData = [];
    try {
      const agg = await dbInst.collection('costumers_unified').aggregate([
        { $match: { $or: dateConditions } },
        {
          $group: {
            _id:           '$agenteNombre',
            totalClientes: { $sum: 1 },
            totalVentas:   { $sum: { $cond: [{ $expr: completedMatchExpr }, 1, 0] } },
            totalPuntos:   { $sum: { $cond: [{ $expr: completedMatchExpr }, { $toDouble: { $ifNull: ['$puntaje',0] } }, 0] } },
            agente:        { $first: '$agente' },
            supervisor:    { $first: '$supervisor' }
          }
        },
        { $sort: { totalPuntos: -1 } },
        { $limit: 30 }
      ]).toArray();
      agentsData = agg.map(a => ({
        nombre: a._id||'Sin asignar', agente: a.agente||'',
        totalClientes: a.totalClientes, totalVentas: a.totalVentas,
        totalPuntos: Number((a.totalPuntos||0).toFixed(2)), supervisor: a.supervisor||''
      }));
    } catch (e) { console.warn('[INIT-ESTADISTICAS] agents:', e.message); }

    let leadsChartData = [];
    try {
      const dateFrom = new Date(now); dateFrom.setDate(dateFrom.getDate() - 60);
      const agg = await dbInst.collection('leads').aggregate([
        { $match: { fecha: { $gte: dateFrom, $lte: now } } },
        {
          $group: {
            _id:         { $dateToString: { format:'%Y-%m-%d', date:'$fecha', timezone:'America/Mexico_City' } },
            count:       { $sum: 1 },
            completados: { $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$status',''] } }, COMPLETED_VALUES_LOWER] }, 1, 0] } }
          }
        },
        { $sort: { _id: 1 } }, { $limit: 60 }
      ]).toArray();
      leadsChartData = agg.map(l => ({ fecha: l._id, count: l.count, completados: l.completados||0 }));
    } catch (e) { console.warn('[INIT-ESTADISTICAS] leads chart:', e.message); }

    let statusSummary = {};
    try {
      const agg = await dbInst.collection('costumers_unified').aggregate([
        { $match: { $or: dateConditions } },
        { $group: { _id: { $toLower: { $ifNull: ['$status',''] } }, count: { $sum:1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      agg.forEach(s => { statusSummary[normalizeStatus(s._id)] = (statusSummary[normalizeStatus(s._id)] || 0) + s.count; });
    } catch (e) { console.warn('[INIT-ESTADISTICAS] status summary:', e.message); }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role, team: user?.team||'Sin equipo' },
      data: { teamsData, agentsData, leadsChartData, statusSummary, monthYear: `${curMonth+1}/${curYear}` },
      ttl: 5*60*1000
    });
  } catch (e) {
    console.error('[INIT-ESTADISTICAS] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar estadísticas', error: e.message });
  }
});

// ── INIT-ALL-PAGES ────────────────────────────────────────────
app.get('/api/init-all-pages', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user = req.user;
    const now  = new Date();
    const curMonth   = now.getMonth();
    const curYear    = now.getFullYear();
    const monthStart = new Date(curYear, curMonth, 1);
    const monthEnd   = new Date(curYear, curMonth + 1, 0, 23, 59, 59);
    const dateConditions = [
      { dia_venta:          { $gte: monthStart, $lte: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } },
      { creadoEn:           { $gte: monthStart, $lte: monthEnd } },
      { createdAt:          { $gte: monthStart, $lte: monthEnd } },
      { fecha:              { $gte: monthStart, $lte: monthEnd } }
    ];

    let dashboardData = null;
    try { dashboardData = global.initDashboardCache?.data || null; } catch (_) {}

    let customers = [];
    try {
      customers = await dbInst.collection('costumers_unified')
        .find({ $or: dateConditions })
        .project({ _id:1, nombre_cliente:1, status:1, telefono_principal:1, numero_cuenta:1, agente:1, agenteNombre:1, supervisor:1, dia_venta:1, dia_instalacion:1, autopago:1, pin_seguridad:1, direccion:1, telefonos:1, cantidad_lineas:1, servicios:1, servicios_texto:1, producto:1, mercado:1 })
        .limit(200).toArray();
    } catch (e) { console.warn('[INIT-ALL-PAGES] customers:', e.message); }

    let leads = [];
    try {
      leads = await dbInst.collection('leads')
        .find({ $or: dateConditions })
        .project({ _id:1, nombre:1, status:1, fecha:1, agente:1, agenteNombre:1, puntaje:1, servicios:1, empresa:1 })
        .limit(100).toArray();
    } catch (e) { console.warn('[INIT-ALL-PAGES] leads:', e.message); }

    let rankings = [];
    try {
      const rankAgg = await dbInst.collection('costumers_unified').aggregate([
        { $match: { $or: dateConditions } },
        { $match: { $expr: completedMatchExpr } },
        { $group: { _id: '$agenteNombre', sumPuntaje: { $sum: { $toDouble: { $ifNull: ['$puntaje',0] } } }, ventas: { $sum:1 } } },
        { $sort: { sumPuntaje: -1 } }, { $limit: 30 }
      ]).toArray();
      rankings = rankAgg.map((r, i) => ({ agente: r._id, agenteNombre: r._id, puntaje: Number((r.sumPuntaje||0).toFixed(2)), ventas: r.ventas, posicion: i+1 }));
    } catch (e) { console.warn('[INIT-ALL-PAGES] rankings:', e.message); }

    let statsAgg = {};
    try {
      const agg = await dbInst.collection('costumers_unified').aggregate([
        { $match: { $or: dateConditions } },
        { $group: {
          _id:         { $ifNull: ['$supervisor','general'] },
          totalLeads:  { $sum: 1 },
          totalVentas: { $sum: { $cond: [{ $expr: completedMatchExpr }, 1, 0] } },
          promedio:    { $avg: { $toDouble: { $ifNull: ['$puntaje',0] } } }
        }},
        { $sort: { totalLeads: -1 } }, { $limit: 15 }
      ]).toArray();
      agg.forEach(s => {
        statsAgg[s._id||'general'] = { totalLeads: s.totalLeads, totalVentas: s.totalVentas, promedio: Math.round(s.promedio||0) };
      });
    } catch (e) { console.warn('[INIT-ALL-PAGES] stats:', e.message); }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role, team: user?.team||'Sin equipo' },
      data: { dashboard: dashboardData, customers, leads, rankings, stats: statsAgg, monthYear: `${curMonth+1}/${curYear}` },
      ttl: 5*60*1000
    });
  } catch (e) {
    console.error('[INIT-ALL-PAGES] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar páginas', error: e.message });
  }
});

// ── INIT-LEAD ─────────────────────────────────────────────────
app.get('/api/init-lead', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user = req.user;
    const now  = new Date();
    const curMonth   = now.getMonth();
    const curYear    = now.getFullYear();
    const monthStart = new Date(curYear, curMonth, 1);
    const monthEnd   = new Date(curYear, curMonth + 1, 0, 23, 59, 59);
    const dateConditions = [{ fecha: { $gte: monthStart, $lte: monthEnd } }, { createdAt: { $gte: monthStart, $lte: monthEnd } }];

    let leadsData = [];
    try {
      leadsData = await dbInst.collection('leads').find({ $or: dateConditions })
        .project({ _id:1, nombre:1, status:1, fecha:1, agente:1, agenteNombre:1, puntaje:1, servicios:1, empresa:1 })
        .limit(200).toArray();
    } catch (e) { console.warn('[INIT-LEAD] leads:', e.message); }

    let statusSummary = {};
    try {
      const agg = await dbInst.collection('leads').aggregate([
        { $match: { $or: dateConditions } },
        { $group: { _id: { $toLower: { $ifNull: ['$status',''] } }, count: { $sum:1 } } },
        { $sort: { count:-1 } }
      ]).toArray();
      agg.forEach(s => { statusSummary[normalizeStatus(s._id)] = (statusSummary[normalizeStatus(s._id)]||0) + s.count; });
    } catch (e) { console.warn('[INIT-LEAD] status:', e.message); }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role },
      data: { leadsData, statusSummary, monthYear: `${curMonth+1}/${curYear}` },
      ttl: 5*60*1000
    });
  } catch (e) {
    console.error('[INIT-LEAD] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar leads', error: e.message });
  }
});

// ── INIT-FACTURACIÓN ──────────────────────────────────────────
app.get('/api/init-facturacion', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user = req.user;
    const now  = new Date();
    const curMonth   = now.getMonth();
    const curYear    = now.getFullYear();
    const monthStart = new Date(curYear, curMonth, 1);
    const monthEnd   = new Date(curYear, curMonth + 1, 0, 23, 59, 59);
    const dateConditions = [
      { dia_venta:          { $gte: monthStart, $lte: monthEnd } },
      { fecha_contratacion: { $gte: monthStart, $lte: monthEnd } },
      { createdAt:          { $gte: monthStart, $lte: monthEnd } }
    ];

    let facturacionData = [];
    try {
      facturacionData = await dbInst.collection('costumers_unified').find({ $or: dateConditions })
        .project({ _id:1, nombre_cliente:1, numero_cuenta:1, status:1, agente:1, agenteNombre:1, dia_venta:1, dia_instalacion:1, cantidad_lineas:1, autopago:1 })
        .limit(150).toArray();
    } catch (e) { console.warn('[INIT-FACTURACION] data:', e.message); }

    let ingresosSummary = { total: 0, completadas: 0 };
    try {
      const agg = await dbInst.collection('costumers_unified').aggregate([
        { $match: { $or: dateConditions } },
        { $group: {
          _id:         null,
          totalCount:  { $sum: 1 },
          completadas: { $sum: { $cond: [{ $expr: completedMatchExpr }, 1, 0] } }
        }}
      ]).toArray();
      if (agg.length) { ingresosSummary.total = agg[0].totalCount||0; ingresosSummary.completadas = agg[0].completadas||0; }
    } catch (e) { console.warn('[INIT-FACTURACION] summary:', e.message); }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role },
      data: { facturacionData, ingresosSummary, monthYear: `${curMonth+1}/${curYear}` },
      ttl: 5*60*1000
    });
  } catch (e) {
    console.error('[INIT-FACTURACION] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar facturación', error: e.message });
  }
});

// ── INIT-MULTIMEDIA ───────────────────────────────────────────
app.get('/api/init-multimedia', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user = req.user;

    let multimediaData = [];
    try {
      multimediaData = await dbInst.collection('media').find({})
        .project({ _id:1, fileName:1, fileType:1, uploadedBy:1, uploadedAt:1, fileSize:1 })
        .sort({ uploadedAt: -1 }).limit(100).toArray();
    } catch (e) { console.warn('[INIT-MULTIMEDIA] media:', e.message); }

    let typeSummary = {};
    try {
      const agg = await dbInst.collection('media').aggregate([
        { $group: { _id: '$fileType', count: { $sum:1 } } }, { $sort: { count:-1 } }
      ]).toArray();
      agg.forEach(t => { typeSummary[t._id||'desconocido'] = t.count; });
    } catch (e) { console.warn('[INIT-MULTIMEDIA] type summary:', e.message); }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true, timestamp: new Date().toISOString(), loadTime: elapsed,
      user: { username: user?.username, role: user?.role },
      data: { multimediaData, typeSummary },
      ttl: 5*60*1000
    });
  } catch (e) {
    console.error('[INIT-MULTIMEDIA] Error:', e);
    res.status(500).json({ success: false, message: 'Error al cargar multimedia', error: e.message });
  }
});

// ── RECENT ACTIVITY ───────────────────────────────────────────
function getTimeAgo(date) {
  if (!(date instanceof Date) || isNaN(date)) return 'Hace poco';
  const diffMs   = Date.now() - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffH    = Math.floor(diffMs / 3600000);
  const diffD    = Math.floor(diffMs / 86400000);
  if (diffMins < 1)  return 'Hace segundos';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffH < 24)    return `Hace ${diffH} h`;
  if (diffD < 7)     return `Hace ${diffD} días`;
  return date.toLocaleDateString('es-ES');
}

app.get('/api/recent-activity', protect, async (req, res) => {
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const user     = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();
    const isAdmin  = ['admin','administrator','administrador','administradora'].some(r => userRole.includes(r));
    const isBO     = ['backoffice','bo'].some(r => userRole.includes(r));
    const isSup    = userRole.includes('supervisor');
    const isAgent  = userRole.includes('agente') || userRole.includes('agent');

    const supervisorAgents = isSup ? getSupervisorAgents(username) : [];
    let usersForData = null;
    if (isSup)        usersForData = supervisorAgents;
    else if (isAgent) usersForData = [username];

    const lastDays  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateFilter = { $or: [
      { creadoEn:          { $gte: lastDays } }, { createdAt: { $gte: lastDays } },
      { dia_venta:         { $gte: lastDays } }, { fecha_contratacion: { $gte: lastDays } },
      { fecha:             { $gte: lastDays } }
    ]};

    const userFilter = usersForData ? { $or: [
      { agenteNombre: { $in: usersForData } }, { agente: { $in: usersForData } }, { usuario: { $in: usersForData } }
    ]} : {};

    const filter = usersForData ? { $and: [dateFilter, userFilter] } : dateFilter;

    const activities = await dbInst.collection('costumers_unified').find(filter)
      .sort({ creadoEn:-1, createdAt:-1, dia_venta:-1 })
      .limit(50)
      .project({ _id:1, nombre_cliente:1, agenteNombre:1, agente:1, usuario:1, status:1, servicios:1, tipo_servicios:1, puntaje:1, creadoEn:1, createdAt:1, dia_venta:1 })
      .toArray();

    const formatted = activities.map(lead => {
      const agent      = lead.agenteNombre || lead.agente || lead.usuario || '—';
      const clientName = lead.nombre_cliente || 'Cliente sin nombre';
      const services   = Array.isArray(lead.servicios) ? lead.servicios[0] : lead.tipo_servicios || 'Servicio general';
      const normSt     = normalizeStatus(lead.status);
      let activityType = 'Nuevo';
      if (normSt === 'completed')        activityType = 'Venta cerrada';
      else if (normSt === 'pending')     activityType = 'Seguimiento';
      else if (normSt === 'cancelled')   activityType = 'Cancelación';
      else if (normSt === 'hold')        activityType = 'En espera';
      else if (normSt === 'rescheduled') activityType = 'Reagendado';

      const dateCreated = lead.creadoEn || lead.createdAt || lead.dia_venta || new Date();
      return {
        id: lead._id, nombre_cliente: clientName, agente: agent, servicio: services,
        tipo_actividad: activityType, status: normSt,
        fecha: dateCreated, tiempo_relativo: getTimeAgo(dateCreated instanceof Date ? dateCreated : new Date(dateCreated))
      };
    });

    res.json({ success: true, data: formatted });
  } catch (e) {
    console.error('[RECENT-ACTIVITY]', e);
    res.status(500).json({ success: false, message: 'Error al cargar actividad', error: e.message });
  }
});

/* ── GET /api/agent-history ── */
app.get('/api/agent-history', protect, async (req, res) => {
  try {
    const dbInst = getDb();
    if (!dbInst) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const user     = req.user;
    const userRole = (user?.role || '').toLowerCase();
    const isAdmin  = ['admin','administrator','administrador','administradora','backoffice','bo'].some(r => userRole.includes(r));
    const isSup    = userRole.includes('supervisor');
    const isAgent  = userRole.includes('agente') || userRole.includes('agent');

    let { agente, fechaInicio, fechaFin, limit: limitRaw } = req.query;
    const limit = Math.min(parseInt(limitRaw) || 300, 500);

    // Restricciones de acceso: agentes solo pueden ver los suyos
    if (isAgent && !isAdmin && !isSup) agente = user.username;

    // Fechas por defecto: último mes
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dateFrom = fechaInicio ? new Date(fechaInicio + 'T00:00:00') : defaultStart;
    const dateTo   = fechaFin    ? new Date(fechaFin   + 'T23:59:59') : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // ── Actividades del agente (colección activities) ──
    const actFilter = {
      timestamp: { $gte: dateFrom, $lte: dateTo }
    };
    if (agente) {
      actFilter.$or = [
        { actor_username: agente },
        { actor_username: new RegExp('^' + agente.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
      ];
    }
    const rawActivities = await dbInst.collection('activities')
      .find(actFilter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    // ── Leads del agente (costumers_unified) para stats ──
    // Solo usamos creadoEn/createdAt para reflejar cuándo el agente realmente creó el lead,
    // evitando que dia_venta o fecha_contratacion jalaran leads de otros períodos.
    const leadDateFilter = { $or: [
      { creadoEn:  { $gte: dateFrom, $lte: dateTo } },
      { createdAt: { $gte: dateFrom, $lte: dateTo } }
    ]};
    const agentLeadFilter = agente ? { $and: [
      leadDateFilter,
      { $or: [
        { agenteNombre: { $regex: new RegExp('^' + agente.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } },
        { agente:       { $regex: new RegExp('^' + agente.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } },
        { usuario:      { $regex: new RegExp('^' + agente.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }
      ]}
    ]} : leadDateFilter;

    const leads = await dbInst.collection('costumers_unified')
      .find(agentLeadFilter)
      .project({ _id:1, nombre_cliente:1, status:1, servicios:1, tipo_servicios:1, puntaje:1, agenteNombre:1, creadoEn:1, createdAt:1, dia_venta:1 })
      .limit(1000)
      .toArray();

    // ── Stats ──
    const totalActividades = rawActivities.length;
    const ventasCerradas   = leads.filter(l => normalizeStatus(l.status) === 'completed').length;
    const leadsCreados     = rawActivities.filter(a => ['Lead creado','Venta ingresada'].includes(a.activity_type)).length;
    const cancelaciones    = leads.filter(l => normalizeStatus(l.status) === 'cancelled').length;
    const puntajeTotal     = leads.reduce((s, l) => s + (parseFloat(l.puntaje) || 0), 0);

    // ── Formatear actividades ──
    const actividades = rawActivities.map(a => ({
      id:           a._id,
      tipo:         a.activity_type || 'Acción',
      cliente:      a.lead_client_name || '—',
      descripcion:  a.description || '',
      agente:       a.actor_username || agente || '—',
      rol:          a.actor_role || '',
      fecha:        a.timestamp,
      extra:        { campos: a.campos, new_status: a.new_status, old_status: a.old_status }
    }));

    // ── Agrupar por día (fecha local del servidor, no UTC) ──
    const byDay = {};
    actividades.forEach(a => {
      const d = new Date(a.fecha);
      // Usar fecha local para evitar desfase de zona horaria UTC vs local
      const key = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0')
      ].join('-');
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(a);
    });
    const porDia = Object.entries(byDay)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, items]) => ({ fecha, total: items.length, items }));

    res.json({
      success: true,
      agente: agente || null,
      periodo: {
        desde: [dateFrom.getFullYear(), String(dateFrom.getMonth()+1).padStart(2,'0'), String(dateFrom.getDate()).padStart(2,'0')].join('-'),
        hasta: [dateTo.getFullYear(),   String(dateTo.getMonth()+1).padStart(2,'0'),   String(dateTo.getDate()).padStart(2,'0')].join('-')
      },
      resumen: { totalActividades, ventasCerradas, leadsCreados, cancelaciones, puntajeTotal: +puntajeTotal.toFixed(2) },
      porDia,
      actividades
    });
  } catch (e) {
    console.error('[AGENT-HISTORY]', e);
    res.status(500).json({ success: false, message: 'Error al cargar historial', error: e.message });
  }
});

// ── LLAMADAS Y VENTAS ─────────────────────────────────────────
app.get('/api/llamadas-ventas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const role = String(req.user?.role || '').toLowerCase();
    const isAllowed = ['admin','administrador','administrator','backoffice','bo'].some(r => role.includes(r));
    if (!isAllowed) return res.status(403).json({ success: false, message: 'No autorizado' });

    const now         = new Date();
    const targetMonth = req.query.month ? parseInt(req.query.month, 10) : now.getMonth() + 1;
    const targetYear  = req.query.year  ? parseInt(req.query.year,  10) : now.getFullYear();
    const startDate   = new Date(targetYear, targetMonth - 1, 1);
    const endDate     = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const registros = await db.collection('llamadas_ventas').aggregate([
      { $match: { fecha: { $gte: startDate, $lte: endDate } } },
      { $addFields: { __fechaKey: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } } } },
      { $sort: { actualizadoEn: -1, creadoEn: -1, _id: -1 } },
      { $group: { _id: { fechaKey: '$__fechaKey', team: '$team', tipo: '$tipo' }, doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $project: { __fechaKey: 0 } },
      { $sort: { fecha: 1, team: 1, tipo: 1 } }
    ]).toArray();

    return res.json({ success: true, data: registros, count: registros.length, month: targetMonth, year: targetYear });
  } catch (e) {
    console.error('[GET /api/llamadas-ventas]', e);
    return res.status(500).json({ success: false, message: 'Error al obtener llamadas-ventas', error: e.message });
  }
});

app.post('/api/llamadas-ventas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const role = String(req.user?.role || '').toLowerCase();
    const isAllowed = ['admin','administrador','administrator','backoffice','bo'].some(r => role.includes(r));
    if (!isAllowed) return res.status(403).json({ success: false, message: 'No autorizado' });

    const { day, team, type, value } = req.body;
    if (!day || !team || !type) return res.status(400).json({ success: false, message: 'Faltan campos: day, team, type' });

    if (type === 'LLAMADAS' || type === 'VENTAS') {
      const raw = (value ?? '').toString().trim();
      if (!raw || raw === '-') return res.status(400).json({ success: false, message: 'Valor inválido para LLAMADAS/VENTAS' });
      if (!Number.isFinite(Number(raw))) return res.status(400).json({ success: false, message: 'Valor no numérico para LLAMADAS/VENTAS' });
    }

    const now        = new Date();
    const fechaStart = new Date(now.getFullYear(), now.getMonth(), parseInt(day, 10));
    const fechaEnd   = new Date(now.getFullYear(), now.getMonth(), parseInt(day, 10) + 1);
    const valorFinal = type === 'TOTALES' ? value : (parseFloat(value) || 0);

    const result = await db.collection('llamadas_ventas').updateMany(
      { fecha: { $gte: fechaStart, $lt: fechaEnd }, team, tipo: type },
      {
        $set:         { valor: valorFinal, actualizadoEn: now, actualizadoPor: req.user?.username || 'unknown' },
        $setOnInsert: { fecha: fechaStart, creadoEn: now, creadoPor: req.user?.username || 'unknown' }
      },
      { upsert: true }
    );

    return res.json({ success: true, message: 'Datos guardados', data: { day, team, type, value: valorFinal, fecha: fechaStart, modifiedCount: result.modifiedCount, upsertedCount: result.upsertedCount } });
  } catch (e) {
    console.error('[POST /api/llamadas-ventas]', e);
    return res.status(500).json({ success: false, message: 'Error al guardar llamadas-ventas', error: e.message });
  }
});

// ── LLAMADAS-VENTAS-EXCEL ─────────────────────────────────────
const LLAMADAS_EXCEL_SHEETS = 'llamadas_ventas_excel_sheets';
const LLAMADAS_EXCEL_DATA   = 'llamadas_ventas_excel_data';
const LLAMADAS_EXCEL_USERS  = 'llamadas_ventas_excel_users';

const isAllowedLlamadasExcel = (roleRaw) => {
  const r = String(roleRaw || '').toLowerCase();
  return ['admin','administrador','administrator','backoffice','bo'].some(v => r.includes(v));
};
const normalizeSheetName = (name) => String(name || '').trim() || null;

app.get('/api/llamadas-ventas-excel/sheets', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const sheets = await db.collection(LLAMADAS_EXCEL_SHEETS).find({})
      .project({ _id:1, name:1, createdAt:1, createdBy:1, updatedAt:1, updatedBy:1 })
      .sort({ createdAt:1, _id:1 }).toArray();
    return res.json({ success: true, data: sheets.map(s => ({ _id: s._id?.toString()||'', name: s.name, createdAt: s.createdAt, createdBy: s.createdBy, updatedAt: s.updatedAt, updatedBy: s.updatedBy })) });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al obtener sheets', error: e.message });
  }
});

app.post('/api/llamadas-ventas-excel/sheets', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const now      = new Date();
    const baseName = normalizeSheetName(req.body?.name) || now.toISOString().slice(0,10);
    let name       = baseName;
    const exists   = await db.collection(LLAMADAS_EXCEL_SHEETS).findOne({ name });
    if (exists) name = `${baseName} (${now.toISOString().slice(11,19)})`;
    const doc    = { name, createdAt: now, createdBy: req.user?.username||'unknown', updatedAt: now, updatedBy: req.user?.username||'unknown' };
    const result = await db.collection(LLAMADAS_EXCEL_SHEETS).insertOne(doc);
    return res.json({ success: true, data: { _id: result.insertedId?.toString()||'', ...doc } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al crear sheet', error: e.message });
  }
});

app.get('/api/llamadas-ventas-excel/sheets/:sheetId', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const sid = String(req.params.sheetId || '').trim();
    if (!sid) return res.status(400).json({ success: false, message: 'sheetId inválido' });
    let _id;
    try { _id = new ObjectId(sid); } catch { return res.status(400).json({ success: false, message: 'sheetId inválido' }); }
    const sheet = await db.collection(LLAMADAS_EXCEL_SHEETS).findOne({ _id }, { projection: { name:1 } });
    if (!sheet) return res.status(404).json({ success: false, message: 'Sheet no encontrado' });
    const data  = await db.collection(LLAMADAS_EXCEL_DATA).find({ sheetId: sid }).project({ _id:0, kind:1, team:1, person:1, col:1, metric:1, value:1 }).toArray();
    const users = await db.collection(LLAMADAS_EXCEL_USERS).find({ sheetId: sid }).project({ _id:0, name:1, role:1, team:1 }).toArray();
    return res.json({ success: true, sheet: { _id: sheet._id?.toString()||sid, name: sheet.name }, data, users });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al cargar sheet', error: e.message });
  }
});

app.post('/api/llamadas-ventas-excel/cell', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const { sheetId, team, person, col, metric, value } = req.body || {};
    const sid = String(sheetId || '').trim();
    if (!sid) return res.status(400).json({ success: false, message: 'Falta sheetId' });
    const now = new Date();
    const v   = (value ?? '').toString().trim();
    let filter, kind;
    if (metric) {
      kind = 'summary'; filter = { sheetId: sid, kind, metric: String(metric).trim().toUpperCase() };
    } else {
      if (!team || !person || !col) return res.status(400).json({ success: false, message: 'Faltan campos: team, person, col' });
      kind = 'cell'; filter = { sheetId: sid, kind, team: String(team).trim(), person: String(person).trim(), col: String(col).trim().toUpperCase() };
    }
    if (v === '') {
      await db.collection(LLAMADAS_EXCEL_DATA).deleteOne(filter);
    } else {
      await db.collection(LLAMADAS_EXCEL_DATA).updateOne(filter,
        { $set: { value: v, updatedAt: now, updatedBy: req.user?.username||'unknown' }, $setOnInsert: { sheetId: sid, kind, createdAt: now, createdBy: req.user?.username||'unknown' } },
        { upsert: true }
      );
    }
    try { await db.collection(LLAMADAS_EXCEL_SHEETS).updateOne({ _id: new ObjectId(sid) }, { $set: { updatedAt: now, updatedBy: req.user?.username||'unknown' } }); } catch (_) {}
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al guardar celda', error: e.message });
  }
});

app.post('/api/llamadas-ventas-excel/user', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const { sheetId, name, role, team } = req.body || {};
    const sid = String(sheetId||'').trim();
    if (!sid || !name || !team) return res.status(400).json({ success: false, message: 'Faltan campos: sheetId, name, team' });
    const doc = { sheetId: sid, name: String(name).trim().toUpperCase(), role: String(role||'').trim(), team: String(team).trim(), updatedAt: new Date(), updatedBy: req.user?.username||'unknown' };
    await db.collection(LLAMADAS_EXCEL_USERS).updateOne(
      { sheetId: sid, name: doc.name, team: doc.team },
      { $set: doc, $setOnInsert: { createdAt: new Date(), createdBy: req.user?.username||'unknown' } },
      { upsert: true }
    );
    return res.json({ success: true, data: { name: doc.name, role: doc.role, team: doc.team } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al guardar usuario', error: e.message });
  }
});

app.post('/api/llamadas-ventas-excel/user-delete', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const sid = String((req.body||{}).sheetId||'').trim();
    const n   = String((req.body||{}).name  ||'').trim().toUpperCase();
    const t   = String((req.body||{}).team  ||'').trim();
    if (!sid || !n || !t) return res.status(400).json({ success: false, message: 'Faltan campos: sheetId, name, team' });
    await db.collection(LLAMADAS_EXCEL_USERS).deleteOne({ sheetId: sid, name: n, team: t });
    await db.collection(LLAMADAS_EXCEL_DATA).deleteMany({ sheetId: sid, kind: 'cell', team: t, person: n });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al eliminar usuario', error: e.message });
  }
});

app.delete('/api/llamadas-ventas-excel/sheets/:sheetId', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const sid = String(req.params.sheetId||'').trim();
    if (!sid) return res.status(400).json({ success: false, message: 'sheetId requerido' });
    const r = await db.collection(LLAMADAS_EXCEL_SHEETS).deleteOne({ _id: new ObjectId(sid) });
    if (!r.deletedCount) return res.status(404).json({ success: false, message: 'Sheet no encontrado' });
    await db.collection(LLAMADAS_EXCEL_USERS).deleteMany({ sheetId: sid });
    await db.collection(LLAMADAS_EXCEL_DATA).deleteMany({ sheetId: sid });
    return res.json({ success: true, message: 'Sheet eliminado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al eliminar sheet', error: e.message });
  }
});

app.patch('/api/llamadas-ventas-excel/sheets/:sheetId', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    if (!isAllowedLlamadasExcel(req.user?.role)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const sid     = String(req.params.sheetId||'').trim();
    const newName = String((req.body||{}).name||'').trim();
    if (!sid || !newName) return res.status(400).json({ success: false, message: 'sheetId y nombre requeridos' });
    const dateRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
    if (!dateRegex.test(newName)) return res.status(400).json({ success: false, message: 'Formato de fecha inválido. Use MM/DD/YYYY' });
    const result = await db.collection(LLAMADAS_EXCEL_SHEETS).updateOne(
      { _id: new ObjectId(sid) },
      { $set: { name: newName, updatedAt: new Date(), updatedBy: req.user?.username||'unknown' } }
    );
    if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Sheet no encontrado' });
    return res.json({ success: true, message: 'Nombre actualizado', data: { name: newName } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al actualizar nombre', error: e.message });
  }
});

// ── DEBUG ENDPOINTS ───────────────────────────────────────────
app.get('/api/crm/debug-fields', protect, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Not found' });
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ success: false, message: 'Parámetro agent requerido' });
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const database    = getDb();
    const collections = await database.listCollections().toArray();
    const names       = collections.map(c => c.name).filter(n => /^costumers|^customers_unified/i.test(n));
    let sampleDoc = null, sourceCollection = null;
    for (const colName of names) {
      try {
        sampleDoc = await database.collection(colName).findOne({
          $or: [{ agente: { $regex: agent, $options:'i' } },{ agenteNombre: { $regex: agent, $options:'i' } },{ nombreAgente: { $regex: agent, $options:'i' } }]
        });
        if (sampleDoc) { sourceCollection = colName; break; }
      } catch (_) {}
    }
    if (!sampleDoc) return res.status(404).json({ success: false, message: `No se encontraron documentos para: ${agent}` });
    const fields = Object.keys(sampleDoc).sort();
    return res.json({ success: true, agent, sourceCollection, totalFields: fields.length, fields: fields.map(f => ({ name: f, value: sampleDoc[f], type: typeof sampleDoc[f] })) });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al inspeccionar documentos', error: e.message });
  }
});

app.get('/api/debug/ingrid-score', protect, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Not found' });
  try {
    const database = getDb();
    if (!database) return res.status(503).json({ error: 'BD no disponible' });
    const agentPatterns = [
      { agente: 'INGRID.GARCIA' },{ agenteNombre: 'INGRID.GARCIA' },{ nombreAgente: 'INGRID.GARCIA' },
      { createdBy: 'INGRID.GARCIA' },{ registeredBy: 'INGRID.GARCIA' },{ vendedor: 'INGRID.GARCIA' }
    ];
    const decFilter = { $and: [
      { $or: agentPatterns },
      { $or: [{ dia_venta: { $gte: '2025-12-01', $lte: '2025-12-31' } },{ createdAt: { $gte: new Date(2025,11,1), $lte: new Date(2025,11,31) } }] }
    ]};
    const col   = database.collection('costumers_unified');
    const count = await col.countDocuments(decFilter);
    let result  = { count: 0, totalPuntaje: 0, avgPuntaje: 0 };
    if (count > 0) {
      const agg = await col.aggregate([
        { $match: decFilter },
        { $group: { _id: null, count: { $sum:1 }, totalPuntaje: { $sum: { $toDouble: '$puntaje' } }, avgPuntaje: { $avg: { $toDouble: '$puntaje' } } } }
      ]).toArray();
      result = agg[0] || result;
    }
    res.json({ costumers_unified: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/debug/user', protect, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Not found' });
  try {
    let dbUser = null;
    if (req.user?._id && isConnected()) {
      if (!db) db = getDb();
      try { dbUser = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) }); } catch (_) {}
    }
    res.json({ success: true, tokenUser: req.user, dbUser, canCreateAccounts: ['Administrador','admin','administrador','Administrativo'].includes(req.user?.role) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/debug/users', protect, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Not found' });
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const users = await db.collection('users').find({}).project({ username:1, role:1, team:1, createdAt:1 }).toArray();
    res.json({ success: true, users: users.map(u => ({ _id: u._id, username: u.username, role: u.role, team: u.team, createdAt: u.createdAt })) });
  } catch (e) {
    console.error('[debug/users]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/auth/debug-storage', protect, (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Not found' });
  res.json({ success: true, message: 'Endpoint de debugging', note: 'Para verificar token usa /api/auth/verify-server' });
});

// ── DEV ENDPOINTS ─────────────────────────────────────────────
function isLocalhost(req) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
  return ip === '::1' || ip === '127.0.0.1' || ip.endsWith('::1') || ip.startsWith('127.');
}

app.post('/api/auth/test-token', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ success: false, message: 'Not allowed in production' });
  if (!isLocalhost(req)) return res.status(403).json({ success: false, message: 'Allowed only from localhost' });
  const { username = 'dev.admin', role = 'Administrador' } = req.body || {};
  const token = jwt.sign({ username, role }, JWT_SECRET_EFFECTIVE, { expiresIn: '2h' });
  return res.json({ success: true, token, payload: { username, role } });
});

app.post('/api/dev/populate-test-data', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ success: false, message: 'Not allowed in production' });
  if (!isLocalhost(req)) return res.status(403).json({ success: false, message: 'Only allowed from localhost' });
  try {
    const database = getDb();
    if (!database) return res.status(500).json({ success: false, message: 'Database not connected' });
    const users = database.collection('users');
    let testUser = await users.findOne({ username: 'test.agent' });
    if (!testUser) {
      const hashedPassword = await bcrypt.hash('123456', 10);
      await users.insertOne({ username: 'test.agent', password: hashedPassword, name: 'Agente Test', email: 'test@example.com', role: 'agente', team: 'Test', createdAt: new Date(), verified: true });
      testUser = { username: 'test.agent' };
    }
    const costumers = database.collection('costumers_unified');
    const existing  = await costumers.countDocuments({ agenteNombre: 'test.agent' });
    if (existing === 0) {
      await costumers.insertMany([
        { nombre: 'María López',  telefono:'1234567890', agenteNombre:'test.agent', servicios:['Internet 100MB'], tipo_servicio:'Internet Hogar', puntaje:1,    status:'completed', dia_venta: new Date() },
        { nombre: 'Carlos Pérez', telefono:'9876543210', agenteNombre:'test.agent', servicios:['TV Premium'],    tipo_servicio:'TV',             puntaje:0.75, status:'completed', dia_venta: new Date() },
        { nombre: 'Ana Torres',   telefono:'5551234567', agenteNombre:'test.agent', servicios:['Combo 200MB'],   tipo_servicio:'Combo',          puntaje:1.5,  status:'completed', dia_venta: new Date() }
      ]);
    }
    return res.json({ success: true, message: 'Test data populated', user: testUser.username, leads: await costumers.countDocuments({ agenteNombre: 'test.agent' }) });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/dev/assign-real-leads-to-admin', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ success: false, message: 'Not allowed in production' });
  if (!isLocalhost(req)) return res.status(403).json({ success: false, message: 'Only allowed from localhost' });
  try {
    const database = getDb();
    if (!database) return res.status(500).json({ success: false, message: 'Database not connected' });
    const costumers = database.collection('costumers_unified');
    const total     = await costumers.countDocuments();
    if (!req.body?.confirm || req.body.confirm !== 'YES_I_UNDERSTAND_THIS_OVERWRITES_ALL') {
      return res.status(400).json({ success: false, message: 'Debes enviar { "confirm": "YES_I_UNDERSTAND_THIS_OVERWRITES_ALL" } en el body.' });
    }
    const result = await costumers.updateMany({}, { $set: { agenteNombre: 'admin' } });
    return res.json({ success: true, message: 'All leads assigned to admin', before: { totalLeads: total }, after: { modifiedCount: result.modifiedCount } });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── AUTH ENDPOINTS ────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/auth', forgotPasswordRoutes);

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Usuario y contraseña son requeridos' });
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const user = await db.collection('users').findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign({ id: user._id?.toString(), username: user.username, role: user.role||'user' }, JWT_SECRET_EFFECTIVE, { expiresIn: JWT_EXPIRES_IN });
    try {
      const opts = cookieOptionsForReq(req, { httpOnly:true, secure: process.env.NODE_ENV==='production', sameSite: process.env.NODE_ENV==='production'?'none':'lax', maxAge: 24*60*60*1000, path:'/' });
      if (res.cookie) res.cookie('token', token, opts);
    } catch (_) {}
    const { password: _, ...userWithout } = user;
    return res.json({ success: true, message: 'Inicio de sesión exitoso', token, user: userWithout });
  } catch (e) {
    console.error('[LOGIN]', e);
    return res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

app.get('/api/auth/verify-server', async (req, res) => {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.json({ success: false, message: 'No se encontró token', authenticated: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET_EFFECTIVE);
    let userDoc = null;
    if (isConnected()) {
      if (!db) db = getDb();
      try { userDoc = await db.collection('users').findOne({ username: decoded.username }, { projection: { password:0 } }); } catch (_) {}
    }
    const payload = userDoc ? {
      id: userDoc._id?.toString() || decoded.id, username: userDoc.username, role: userDoc.role,
      email: userDoc.email||null, team: userDoc.team||null, permissions: userDoc.permissions||decoded.permissions,
      avatarUrl: userDoc.avatarUrl||null, avatarFileId: userDoc.avatarFileId||null
    } : { id: decoded.id, username: decoded.username, role: decoded.role, email: decoded.email||null, team: decoded.team||null };
    return res.json({ success: true, message: 'Token válido', authenticated: true, user: payload });
  } catch (e) {
    return res.json({ success: false, message: 'Token inválido', authenticated: false, error: e.message });
  }
});

app.post('/api/auth/register', protect, authorize('Administrador','admin','administrador','Administrativo'), async (req, res) => {
  try {
    const { username, password, role, team, supervisor } = req.body;
    if (!username || !password || !role) return res.status(400).json({ success: false, message: 'username, password y role son requeridos' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ success: false, message: 'Contraseña debe tener al menos 8 caracteres' });
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();

    const normalizeRole = (r) => {
      const rr = String(r||'').trim().toLowerCase();
      if (['admin','administrador','administrator','administrativo'].includes(rr)) return 'Administrador';
      if (['backoffice','back office','back_office','bo','b.o','b-o'].includes(rr)) return 'Backoffice';
      if (['supervisor'].includes(rr)) return 'Supervisor';
      if (['vendedor','agente','agentes','agent'].includes(rr)) return 'Agente';
      if (['supervisor team lineas','supervisor_team_lineas','supervisor lineas'].includes(rr)) return 'Supervisor Team Lineas';
      if (['lineas-agentes','lineas agentes','lineas_agentes'].includes(rr)) return 'Lineas-Agentes';
      if (['team lineas','team_lineas','lineas','líneas'].includes(rr)) return 'Team Lineas';
      return rr.charAt(0).toUpperCase() + rr.slice(1);
    };

    const canonicalRole = normalizeRole(role);
    const existing = await db.collection('users').findOne({ username: String(username).trim() });
    if (existing) return res.status(400).json({ success: false, message: 'El usuario ya existe' });

    const hashedPassword = await bcrypt.hash(password, 10);
    let teamNorm = canonicalRole === 'Backoffice' ? null : (team ? String(team).trim() : null);
    let supVal   = supervisor || null;
    if (!supVal && teamNorm) {
      const t = String(teamNorm).toLowerCase();
      if (t.includes('jonathan')) supVal = 'JONATHAN F';
      else if (t.includes('luis')) supVal = 'LUIS G';
    }

    const rolePermissions = {
      'Administrador': ['read','write','delete','manage_users','manage_teams'],
      'Backoffice':    ['read','write','export','view_finance'],
      'Supervisor':    ['read_team','write_team','view_reports'],
      'Agente':        ['read_own','write_own'],
      'Team Lineas':   ['read_team:lineas','write_team:lineas'],
      'Lineas-Agentes':['read_team:lineas','write_team:lineas'],
      'Supervisor Team Lineas': ['read_team:lineas','write_team:lineas','view_reports']
    };

    const newUser = {
      username: String(username).trim(), password: hashedPassword, role: canonicalRole,
      team: teamNorm, supervisor: supVal,
      name: (req.body.name && String(req.body.name).trim()) || String(username).trim(),
      permissions: rolePermissions[canonicalRole] || ['read_own'],
      createdBy: req.user?.username || 'system', createdAt: new Date(), updatedAt: new Date()
    };
    await db.collection('users').insertOne(newUser);
    console.log(`[REGISTER] ${username} (${canonicalRole}) creado por ${req.user.username}`);
    return res.json({ success: true, message: 'Usuario creado', user: { username: newUser.username, role: newUser.role, team: newUser.team, supervisor: newUser.supervisor } });
  } catch (e) {
    console.error('[REGISTER]', e);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.post('/api/auth/reset-password', protect, authorize('Administrador','admin','administrador','Administrativo'), async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) return res.status(400).json({ success: false, message: 'username y newPassword requeridos' });
    if (newPassword.length < 8)     return res.status(400).json({ success: false, message: 'Contraseña debe tener al menos 8 caracteres' });
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    const user = await db.collection('users').findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.collection('users').updateOne({ _id: user._id }, { $set: { password: hashed, updatedAt: new Date() } });
    console.log(`[RESET] ${username} restablecida por ${req.user.username}`);
    return res.json({ success: true, message: 'Contraseña restablecida' });
  } catch (e) {
    console.error('[RESET]', e);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.post('/api/create-admin', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ success: false, message: 'No encontrado' });
  const { username, password, secret } = req.body || {};
  const SETUP_SECRET = process.env.ADMIN_SETUP_SECRET;
  const provided     = req.headers['x-admin-setup-secret'] || secret;
  if (!SETUP_SECRET || !provided || provided !== SETUP_SECRET) return res.status(403).json({ success: false, message: 'No autorizado' });
  if (!username || !password) return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
  if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
  if (!db) db = getDb();
  const existing = await db.collection('users').findOne({ username });
  if (existing) return res.status(400).json({ success: false, message: 'El usuario ya existe' });
  const hashed  = await bcrypt.hash(password, 10);
  const newUser = { username, password: hashed, role: 'admin', createdAt: new Date(), updatedAt: new Date() };
  await db.collection('users').insertOne(newUser);
  delete newUser.password;
  return res.status(201).json({ success: true, message: 'Administrador creado', user: newUser });
});

// ── TEAMS & SUPERVISORS ───────────────────────────────────────
app.get('/api/teams', protect, authorize('Administrador','admin','administrador','Administrativo'), (req, res) => {
  res.json({ success: true, teams: [
    { value:'TEAM IRANIA',            label:'TEAM IRANIA',            supervisor:'irania.serrano',    supervisorName:'Irania Serrano' },
    { value:'TEAM BRYAN PLEITEZ',     label:'TEAM BRYAN PLEITEZ',     supervisor:'bryan.pleitez',     supervisorName:'Bryan Pleitez' },
    { value:'TEAM MARISOL BELTRAN',   label:'TEAM MARISOL BELTRAN',   supervisor:'marisol.beltran',   supervisorName:'Marisol Beltrán' },
    { value:'TEAM ROBERTO VELASQUEZ', label:'TEAM ROBERTO VELASQUEZ', supervisor:'roberto.velasquez', supervisorName:'Roberto Velásquez' },
    { value:'team lineas jonathan',   label:'TEAM LÍNEAS - JONATHAN F', supervisor:'JONATHAN F',      supervisorName:'JONATHAN F' },
    { value:'team lineas luis',       label:'TEAM LÍNEAS - LUIS G',   supervisor:'LUIS G',            supervisorName:'LUIS G' },
    { value:'Backoffice',             label:'Backoffice',             supervisor:null,                supervisorName:'Sin supervisor' },
    { value:'Administración',         label:'Administración',         supervisor:null,                supervisorName:'Sin supervisor' }
  ]});
});

app.get('/api/supervisors/:team', protect, authorize('Administrador','admin','administrador','Administrativo'), (req, res) => {
  res.json({ success: true, supervisors: [] });
});

app.get('/api/users/agents', protect, async (req, res) => {
  try {
    if (!db) { if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' }); db = getDb(); }
    const users = await db.collection('users').find({ role: { $regex: /(agente|vendedor)/i } })
      .project({ username:1, name:1, nombre:1, fullName:1, role:1, supervisor:1, team:1 }).toArray();
    return res.json({ success: true, agents: users.map(u => ({ id: u._id?.toString()||null, username: u.username||null, name: u.name||u.nombre||u.fullName||u.username||null, role: u.role||'Agente' })) });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error obteniendo agentes', error: e.message });
  }
});

// ── COMENTARIOS ───────────────────────────────────────────────
app.get('/api/comments', async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) return res.status(400).json({ success: false, message: 'Se requiere leadId' });
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();
    let leadObjectId;
    try { leadObjectId = new ObjectId(leadId); } catch { return res.status(400).json({ success: false, message: 'leadId inválido' }); }
    const comments = await db.collection('Vcomments').find({ leadId: leadObjectId }).sort({ createdAt:1 }).toArray();
    return res.json({ success: true, comments: comments.map(c => ({ _id: c._id?.toString(), autor: c.autor||c.author||'Desconocido', texto: c.texto||c.text||'', fecha: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString() })) });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al cargar comentarios', error: e.message });
  }
});

app.get('/api/leads/:id/comentarios', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    let leadObjectId;
    try { leadObjectId = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, message: 'leadId inválido' }); }
    const list = await db.collection('Vcomments').find({ leadId: leadObjectId }).sort({ createdAt:1 }).toArray();
    return res.json(list.map(c => ({ _id: c._id?.toString(), autor: c.autor||c.author||'Desconocido', fecha: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(), texto: c.texto||c.text||'' })));
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al obtener comentarios', error: e.message });
  }
});

app.post('/api/leads/:id/comentarios', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    let leadObjectId;
    try { leadObjectId = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, message: 'leadId inválido' }); }
    const { texto, comentario, autor: autorBody } = req.body || {};
    const now = new Date();
    const doc = { leadId: leadObjectId, texto: (texto ?? comentario ?? '').toString().slice(0,1000), autor: autorBody || req.user?.username || 'Sistema', createdAt: now, updatedAt: now };
    const result = await db.collection('Vcomments').insertOne(doc);
    try {
      const lead = await db.collection('costumers_unified').findOne({ _id: leadObjectId });
      const clientName = lead?.nombre_cliente || 'Sin nombre';
      await logActivity(db, 'Nota agregada', leadObjectId, clientName, req.user?.username||'Sistema', req.user?.role||'Usuario', `Nota en ${clientName}: "${doc.texto.slice(0,50)}"`, { note_author: doc.autor });
    } catch (_) {}
    return res.status(201).json({ success: true, message: 'Comentario creado', data: { _id: result.insertedId.toString(), ...doc } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al crear comentario', error: e.message });
  }
});

app.put('/api/leads/:id/comentarios/:comentarioId', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    let leadObjectId, commentObjectId;
    try { leadObjectId = new ObjectId(req.params.id); commentObjectId = new ObjectId(req.params.comentarioId); }
    catch { return res.status(400).json({ success: false, message: 'IDs inválidos' }); }
    const result = await db.collection('Vcomments').findOneAndUpdate(
      { _id: commentObjectId, leadId: leadObjectId },
      { $set: { texto: (req.body?.texto ?? '').toString().slice(0,1000), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const c = result?.value || (result?._id ? result : null);
    if (!c) return res.status(404).json({ success: false, message: 'Comentario no encontrado' });
    return res.json({ success: true, data: { _id: c._id.toString(), autor: c.autor, texto: c.texto, fecha: new Date(c.createdAt).toISOString() } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al actualizar comentario', error: e.message });
  }
});

app.delete('/api/leads/:id/comentarios/:comentarioId', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    let leadObjectId, commentObjectId;
    try { leadObjectId = new ObjectId(req.params.id); commentObjectId = new ObjectId(req.params.comentarioId); }
    catch { return res.status(400).json({ success: false, message: 'IDs inválidos' }); }
    const result = await db.collection('Vcomments').deleteOne({ _id: commentObjectId, leadId: leadObjectId });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: 'Comentario no encontrado' });
    return res.json({ success: true, message: 'Comentario eliminado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al eliminar comentario', error: e.message });
  }
});

// ── LEADS STATUS ──────────────────────────────────────────────
app.put('/api/leads/:id/status', protect, authorize('Administrador','Backoffice'), async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();

    const role     = String(req.user?.role || '');
    const roleNorm = normText(role).replace(/\s+/g,'_');
    const allowedRoles = new Set(['administrador','admin','backoffice','rol_icon','rol_bamo']);
    if (!allowedRoles.has(roleNorm)) return res.status(403).json({ success: false, message: 'No autorizado' });

    const { id }    = req.params;
    const rawStatus = (req.body?.status || '').toString().trim();
    if (!rawStatus) return res.status(400).json({ success: false, message: 'Campo status requerido' });

    const normSt = normalizeStatus(rawStatus);
    const validStatuses = ['pending','hold','cancelled','rescheduled','completed','active','oficina','reserva'];
    if (!validStatuses.includes(normSt)) {
      return res.status(400).json({ success: false, message: `Status inválido. Permitidos: ${validStatuses.join(', ')}` });
    }

    const capitalized = normSt.charAt(0).toUpperCase() + normSt.slice(1);
    const coll = db.collection('costumers_unified');
    let leadObjectId = null;
    try { leadObjectId = new ObjectId(id); } catch (_) {}

    let resultDoc = null;
    for (const filter of [
      leadObjectId ? { _id: leadObjectId } : null,
      { _id: id },
      { id: id }
    ].filter(Boolean)) {
      try {
        const r = await coll.findOneAndUpdate(filter, { $set: { status: capitalized, actualizadoEn: new Date() } }, { returnDocument: 'after' });
        // Compatible con driver v4 (r.value) y v5+ (r directo)
        resultDoc = r?.value || (r?._id ? r : null);
        if (resultDoc) break;
      } catch (_) {}
    }

    if (!resultDoc && leadObjectId) {
      const upd = await coll.updateOne({ _id: leadObjectId }, { $set: { status: capitalized, actualizadoEn: new Date() } });
      if (upd.matchedCount > 0) {
        await logActivity(db, 'Cambio de Status', leadObjectId, '', req.user?.username||'Sistema', req.user?.role||'Backoffice', `Status cambiado a ${capitalized}`, { new_status: capitalized });
        return res.json({ success: true, message: 'Status actualizado', data: { id, status: capitalized } });
      }
    }

    if (!resultDoc) return res.status(404).json({ success: false, message: 'Lead no encontrado' });

    const oldStatus = resultDoc.status || 'Desconocido';
    await logActivity(db, 'Cambio de Status', resultDoc._id||id, resultDoc.nombre_cliente||'Sin nombre', req.user?.username||'Sistema', req.user?.role||'Backoffice', `Status de ${resultDoc.nombre_cliente||'Cliente'} cambiado de ${oldStatus} a ${capitalized}`, { old_status: oldStatus, new_status: capitalized });
    return res.json({ success: true, message: 'Status actualizado', data: { id, status: capitalized } });
  } catch (e) {
    console.error('[PUT /api/leads/:id/status]', e);
    return res.status(500).json({ success: false, message: 'Error al actualizar status', error: e.message });
  }
});

// ── PUT /api/leads/:id ────────────────────────────────────────
app.put('/api/leads/:id', protect, async (req, res) => {
  try {
    const { id }     = req.params;
    const updateData = req.body || {};
    if (!id)   return res.status(400).json({ success: false, message: 'ID requerido' });
    if (!Object.keys(updateData).length) return res.status(400).json({ success: false, message: 'No hay datos para actualizar' });

    Object.keys(updateData).forEach(k => (updateData[k] == null) && delete updateData[k]);
    if (updateData.status) updateData.status = normalizeStatus(updateData.status);

    updateData.actualizado_en  = new Date();
    updateData.actualizado_por = req.user?.username || 'Sistema';

    const dbInst = getDb();
    if (!dbInst) return res.status(500).json({ success: false, message: 'BD no disponible' });

    let leadObjectId = null;
    try { leadObjectId = new ObjectId(id); } catch (_) {}

    const collectionNames = ['costumers_unified', 'leads', 'costumers', 'customers'];
    for (const collName of collectionNames) {
      const coll = dbInst.collection(collName);
      for (const filter of [
        leadObjectId ? { _id: leadObjectId } : null,
        { _id: id },
        { id }
      ].filter(Boolean)) {
        try {
          const result = await coll.findOneAndUpdate(filter, { $set: updateData }, { returnDocument: 'after' });
          // Compatible con driver v4 (result.value) y v5+ (result directo)
          const doc = result?.value || (result?._id ? result : null);
          if (doc) {
            await logActivity(dbInst, 'Edición de Lead', doc._id, doc.nombre_cliente||'Sin nombre', req.user?.username||'Sistema', req.user?.role||'Usuario', `Campos actualizados: ${Object.keys(updateData).join(', ')}`, { campos: Object.keys(updateData) });
            return res.json({ success: true, message: 'Lead actualizado', data: doc });
          }
        } catch (_) {}
      }
    }
    return res.status(404).json({ success: false, message: 'Lead no encontrado' });
  } catch (e) {
    console.error('[PUT /api/leads/:id]', e);
    return res.status(500).json({ success: false, message: 'Error al actualizar lead', error: e.message });
  }
});

// ── DELETE /api/leads/:id ─────────────────────────────────────
app.delete('/api/leads/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'ID requerido' });
    const dbInst = getDb();
    if (!dbInst) return res.status(500).json({ success: false, message: 'BD no disponible' });
    let leadObjectId = null;
    try { leadObjectId = new ObjectId(id); } catch (_) {}

    const collectionNames = ['costumers_unified','leads','costumers','customers'];
    for (const collName of collectionNames) {
      const coll = dbInst.collection(collName);
      for (const filter of [leadObjectId ? { _id: leadObjectId } : null, { _id: id }, { id }].filter(Boolean)) {
        try {
          const result = await coll.findOneAndDelete(filter);
          const doc = result?.value || (result?._id ? result : null);
          if (doc) {
            await logActivity(dbInst, 'Lead eliminado', doc._id, doc.nombre_cliente||'Sin nombre', req.user?.username||'Sistema', req.user?.role||'Usuario', `Lead de ${doc.nombre_cliente||'Sin nombre'} eliminado`, {});
            return res.json({ success: true, message: 'Lead eliminado' });
          }
        } catch (_) {}
      }
    }
    return res.status(404).json({ success: false, message: 'Lead no encontrado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error al eliminar lead', error: e.message });
  }
});

// ── POST /api/leads ───────────────────────────────────────────
app.post('/api/leads', protect, async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    const leadData = req.body;
    const required = ['telefono_principal','direccion','tipo_servicio','nombre_cliente'];
    const missing  = required.filter(f => !leadData[f]);
    if (missing.length) return res.status(400).json({ success: false, message: 'Faltan campos requeridos', missingFields: missing });

    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();

    function isPlaceholderAgent(v) { const s = (v??'').toString().trim().toLowerCase(); return !s || s === 'agente' || s === 'agente desconocido'; }
    async function findUserByIdLoose(id) {
      if (!id) return null;
      const usersCol = db.collection('users');
      const s = String(id).trim();
      if (/^[a-fA-F0-9]{24}$/.test(s)) { try { return await usersCol.findOne({ _id: new ObjectId(s) }); } catch (_) {} }
      return usersCol.findOne({ $or: [{ id: s }, { _id: s }] });
    }

    let finalAgentName = null, finalAgentId = null, assignedByName = null, targetUser = null;
    if (leadData.agenteId && !isPlaceholderAgent(leadData.agenteId)) {
      targetUser = await findUserByIdLoose(leadData.agenteId);
      if (targetUser) {
        finalAgentId   = targetUser._id || targetUser.id;
        finalAgentName = (targetUser.name || targetUser.username || '').toString().trim();
        const creatorId = req.user?.id ? String(req.user.id) : '';
        const destId    = finalAgentId ? String(finalAgentId) : '';
        assignedByName  = (creatorId && destId && creatorId !== destId) ? (req.user?.username||'Sistema') : null;
      }
    }
    if (!finalAgentId && (leadData.agenteAsignado || leadData.agente)) {
      const assigned = leadData.agenteAsignado || leadData.agente;
      if (!isPlaceholderAgent(assigned)) {
        finalAgentName = String(assigned).replace(/_/g,' ').trim();
        assignedByName = req.user?.username || 'Sistema';
        try {
          const agentUser = await db.collection('users').findOne({ $or: [{ name: { $regex: new RegExp(finalAgentName,'i') } },{ username: { $regex: new RegExp(finalAgentName,'i') } }] });
          if (agentUser) finalAgentId = agentUser._id || agentUser.id;
        } catch (_) {}
      }
    }
    if (!finalAgentId)   finalAgentId   = req.user?.id;
    if (!finalAgentName) finalAgentName = req.user?.name || req.user?.username || 'Agente Desconocido';

    // ── Lógica de RESERVA ─────────────────────────────────────
    const toDateOnly = (v) => {
      if (!v) return '';
      try {
        const s = String(v).trim();
        // Si ya viene en formato YYYY-MM-DD lo usamos directo (fecha local del cliente)
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        // Si viene como ISO con Z (UTC), extraer solo la parte de fecha del string sin parsear
        const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T/);
        if (isoMatch) return isoMatch[1];
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${dy}`;
      } catch { return ''; }
    };

    // Usar fecha LOCAL del servidor (igual que el cliente que manda YYYY-MM-DD local)
    const nowLocal = new Date();
    const todayDateOnly = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth()+1).padStart(2,'0')}-${String(nowLocal.getDate()).padStart(2,'0')}`;
    const diaVentaDateOnly = toDateOnly(leadData.dia_venta || leadData.diaVenta || leadData.fecha);

    const rawStatus       = String(leadData.status || 'pending').toLowerCase();
    const statusNormInput = normalizeStatus(rawStatus);
    const canBeReserva    = (statusNormInput === 'pending' || statusNormInput === 'completed');
    // Solo es reserva si la fecha de venta es ESTRICTAMENTE anterior a hoy (no hoy, no futuro)
    const goToReserva     = !!(
      diaVentaDateOnly &&
      todayDateOnly    &&
      diaVentaDateOnly < todayDateOnly &&
      canBeReserva
    );

    let statusToStore = goToReserva ? 'reserva' : normalizeStatus(rawStatus);

    const newLead = {
      ...leadData,
      fecha_creacion: new Date(),
      status:         statusToStore,
      creadoEn:       new Date(), actualizadoEn: new Date(),
      puntaje:        leadData.puntaje || 0,
      fuente:         leadData.fuente || 'WEB',
      notas:          leadData.notas || [],
      agente:         finalAgentName, agenteNombre: finalAgentName,
      agenteId:       finalAgentId || req.user?.id,
      team:           (targetUser?.team) || req.user?.team || leadData.team || '',
      asignadoPor:    assignedByName || undefined,
      createdBy:      req.user?.username, creadoPor: req.user?.username,
      historial: [{ accion:'CREADO', fecha: new Date(), usuario: req.user?.username||'SISTEMA', detalles: assignedByName ? `Creado por ${assignedByName} y asignado a ${finalAgentName}` : 'Lead creado', agenteId: finalAgentId||req.user?.id }]
    };

    if (!newLead.supervisor || !String(newLead.supervisor).trim()) {
      if (req.user?.supervisor) newLead.supervisor = req.user.supervisor;
      else if (req.user?.team) {
        const t = String(req.user.team).toLowerCase();
        if (t.includes('jonathan')) newLead.supervisor = 'JONATHAN F';
        else if (t.includes('luis')) newLead.supervisor = 'LUIS G';
      }
    }

    const newId = new ObjectId();
    newLead._id              = newId;
    newLead.sourceCollection = 'app_leads';
    newLead.sourceId         = newId.toString();
    newLead.unifiedAt        = new Date();

    const result  = await db.collection('costumers_unified').insertOne(newLead);
    const isVenta = isCompleted(newLead.status);
    await logActivity(db, isVenta ? 'Venta ingresada' : 'Lead creado', result.insertedId, newLead.nombre_cliente||'Sin nombre', req.user?.username||'Sistema', req.user?.role||'Usuario',
      isVenta ? `Venta de ${newLead.nombre_cliente} por ${req.user?.username}` : `Lead de ${newLead.nombre_cliente} asignado a ${finalAgentName}`,
      { agente_asignado: finalAgentName, tipo_servicio: newLead.tipo_servicio, status: newLead.status }
    );

    return res.status(201).json({ success: true, message: 'Lead creado exitosamente', data: { id: result.insertedId, ...newLead } });
  } catch (e) {
    console.error('[POST /api/leads]', e);
    if (e.code === 11000) return res.status(409).json({ success: false, message: 'Ya existe un lead con este teléfono' });
    return res.status(500).json({ success: false, message: 'Error al procesar el lead', error: process.env.NODE_ENV !== 'production' ? e.message : 'Error interno' });
  }
});

// ── GET /api/leads ────────────────────────────────────────────
// CORREGIDO:
// 1. Campo "fecha" agregado al normalFilter
// 2. Límite default subido a 5000 (máximo 10000)
// 3. Incluye ventas colchón (dia_venta mes anterior + dia_instalacion mes actual)
app.get('/api/leads', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();

    const user     = req.user;
    const username = user?.username || '';
    const userRole = (user?.role || '').toLowerCase();
    const isAdmin  = ['admin','administrador','backoffice','bo'].some(r => userRole.includes(r));

    // ── FIX: límite default subido de 1000 a 5000 ──────────────
    // scope=ranking → todos los usuarios ven todos los leads (es una competencia global)
    const { fechaInicio, fechaFin, limit = 5000, scope } = req.query;
    const isRanking = scope === 'ranking';

    let dateFilter = {};
    if (fechaInicio && fechaFin) {
      const fi = new Date(fechaInicio);
      const ft = new Date(fechaFin + 'T23:59:59');

      const fiYear  = fi.getFullYear();
      const fiMonth = fi.getMonth();
      const colchonMonthStart = new Date(fiYear, fiMonth, 1);

      // ── FIX: campo "fecha" agregado al $or ──────────────────
      const normalFilter = {
        $or: [
          { dia_venta:          { $gte: fi, $lte: ft } },
          { fecha_contratacion: { $gte: fi, $lte: ft } },
          { createdAt:          { $gte: fi, $lte: ft } },
          { creadoEn:           { $gte: fi, $lte: ft } },
          { fecha:              { $gte: fi, $lte: ft } }  // ← FIX: leads con campo "fecha"
        ]
      };

      const colchonFilter = {
        $and: [
          { dia_instalacion: { $gte: fi, $lte: ft } },
          { dia_venta:       { $lt: colchonMonthStart } },
          {
            $or: [
              { status: { $regex: /^(completed|active|pending|completado|activo|activa|vendido)$/i } }
            ]
          }
        ]
      };

      dateFilter = { $or: [normalFilter, colchonFilter] };
    }

    let filter = dateFilter;
    // Si scope=ranking, todos ven todos los leads (sin filtro por agente)
    if (!isAdmin && !isRanking) {
      // FIX: normalizar username para matchear variantes en BD
      // username puede ser INGRID.GARCIA pero BD tiene Ingrid Garcia
      const v1 = username;
      const v2 = username.replace(/\./g, ' ');
      const cap = s => s.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      const v3 = cap(v2);
      const v4 = v2.toLowerCase();
      const v5 = v2.toUpperCase();
      const v6 = username.toLowerCase();
      const variants = [...new Set([v1,v2,v3,v4,v5,v6].filter(Boolean))];
      const rxEsc = v2.split('').map(c => c.replace(/[.+?^{}()|[\]\\]/,'\\'+c)).join('');
      const userRx = new RegExp("^" + rxEsc + "$", "i");
      const userClause = {
        $or: [
          { agenteNombre: { $in: variants } },
          { agente:       { $in: variants } },
          { usuario:      { $in: variants } },
          { agenteNombre: userRx },
          { agente:       userRx },
          { createdBy:    { $in: variants } },
          { registeredBy: { $in: variants } }
        ]
      };
      filter = Object.keys(dateFilter).length
        ? { $and: [dateFilter, userClause] }
        : userClause;
    }

    // Admins pueden ver más registros históricos
    const maxLimit = isAdmin ? 50000 : 10000;
    const leads = await db.collection('costumers_unified')
      .find(filter)
      .sort({ dia_venta: -1, creadoEn: -1, createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 5000, maxLimit))
      .toArray();

    const now    = new Date();
    const result = leads.map(lead => {
      // _es_colchon = true solo si tiene patron de colchon Y status completed
      const col = isColchonActivo(lead, now);
      // Asegurar que _id siempre llegue como string al frontend
      const base = { ...lead, _id: lead._id?.toString() || '' };
      return col ? { ...base, _es_colchon: true } : base;
    });

    return res.json(result);
  } catch (e) {
    console.error('[GET /api/leads]', e);
    return res.status(500).json({ success: false, message: 'Error al obtener leads', error: e.message });
  }
});

// ── GET /api/rankings-leads ───────────────────────────────────
// Endpoint dedicado para rankings — devuelve TODOS los leads
// sin filtro por agente, para que cualquier rol vea la tabla
// completa de competencia.
app.get('/api/rankings-leads', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();

    const { fechaInicio, fechaFin, limit = 5000 } = req.query;

    let dateFilter = {};
    if (fechaInicio && fechaFin) {
      const fi = new Date(fechaInicio);
      const ft = new Date(fechaFin + 'T23:59:59');
      const fiYear  = fi.getFullYear();
      const fiMonth = fi.getMonth();
      const colchonMonthStart = new Date(fiYear, fiMonth, 1);

      const normalFilter = {
        $or: [
          { dia_venta:          { $gte: fi, $lte: ft } },
          { fecha_contratacion: { $gte: fi, $lte: ft } },
          { createdAt:          { $gte: fi, $lte: ft } },
          { creadoEn:           { $gte: fi, $lte: ft } },
          { fecha:              { $gte: fi, $lte: ft } }
        ]
      };

      const colchonFilter = {
        $and: [
          { dia_instalacion: { $gte: fi, $lte: ft } },
          { dia_venta:       { $lt: colchonMonthStart } },
          { status: { $regex: /^(completed|active|pending|completado|activo|activa|vendido)$/i } }
        ]
      };

      dateFilter = { $or: [normalFilter, colchonFilter] };
    }

    const leads = await db.collection('costumers_unified')
      .find(dateFilter)
      .project({
        _id:1, agenteNombre:1, agente:1, createdBy:1, usuario:1,
        status:1, dia_venta:1, dia_instalacion:1,
        puntaje:1, supervisor:1, equipo:1, team:1,
        servicios:1, tipo_servicio:1, servicios_texto:1,
        producto:1, producto_contratado:1
      })
      .sort({ dia_venta: -1, createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 5000, 10000))
      .toArray();

    const now    = new Date();
    const result = leads.map(lead => {
      const col = isColchon(lead, now);
      return col ? { ...lead, _es_colchon: true } : lead;
    });

    return res.json(result);
  } catch (e) {
    console.error('[GET /api/rankings-leads]', e);
    return res.status(500).json({ success: false, message: 'Error al obtener leads para rankings', error: e.message });
  }
});

// ── CUSTOMERS ─────────────────────────────────────────────────
app.get('/api/customers', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    if (!db) db = getDb();

    const page      = parseInt(req.query.page, 10) || 1;
    const userRole  = (req.user?.role || '').toLowerCase();
    const isAdmOrBO = ['administrador','backoffice','admin'].some(r => userRole.includes(r));
    const isSup     = userRole.includes('supervisor');
    const maxLimit  = isAdmOrBO ? 10000 : 500;
    const limit     = Math.min(parseInt(req.query.limit, 10) || 200, maxLimit);
    const skip      = (page - 1) * limit;
    const fechaInicio = req.query.fechaInicio ? new Date(req.query.fechaInicio) : null;
    const fechaFin    = req.query.fechaFin    ? new Date(req.query.fechaFin)    : null;

    let baseQuery = {};
    if (fechaInicio && fechaFin) baseQuery.creadoEn = { $gte: fechaInicio, $lte: fechaFin };
    else if (fechaInicio)        baseQuery.creadoEn = { $gte: fechaInicio };
    else if (fechaFin)           baseQuery.creadoEn = { $lte: fechaFin };

    if (req.query.status) baseQuery.status = normalizeStatus(req.query.status);

    if (!isAdmOrBO) {
      const cur = (req.user?.username || '').trim();
      if (isSup) {
        const agentes = await db.collection('users').find({ supervisor: { $regex: new RegExp(cur,'i') }, role: { $not: /admin/i } }).toArray();
        const names   = agentes.map(a => (a.username||a.name||'').trim()).filter(Boolean);
        if (names.length) baseQuery.$or = [{ agenteNombre: { $in: names } },{ agente: { $in: names } },{ usuario: { $in: names } }];
      } else {
        baseQuery.$or = [{ agenteNombre: cur },{ agente: cur },{ usuario: cur }];
      }
    }

    const total     = await db.collection('costumers_unified').countDocuments(baseQuery);
    const sortF     = req.query.sortBy || 'creadoEn';
    const sortO     = req.query.sortOrder === 'asc' ? 1 : -1;
    const customers = await db.collection('costumers_unified').find(baseQuery).sort({ [sortF]: sortO }).skip(skip).limit(limit).toArray();

    return res.json({ success: true, data: customers, total, page, limit, source: 'costumers_unified' });
  } catch (e) {
    console.error('[/api/customers]', e);
    return res.status(500).json({ success: false, message: 'Error al obtener customers', error: process.env.NODE_ENV === 'development' ? e.message : 'Error interno' });
  }
});

app.get('/api/customers/agents-summary', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    const coll = db.collection('costumers_unified');
    const rows = await coll.aggregate([
      { $group: { _id: { id: '$agenteId', nombre: '$agenteNombre' }, count: { $sum:1 } } },
      { $sort: { count:-1 } }
    ]).toArray();
    const distintos = {
      agente:       await coll.distinct('agente'),
      agenteNombre: await coll.distinct('agenteNombre')
    };
    return res.json({ success: true, summary: rows.map(r => ({ agenteId: r._id.id||null, agenteNombre: r._id.nombre||null, count: r.count })), distincts: distintos });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error', error: e.message });
  }
});

// ── MEDIA / UPLOAD ────────────────────────────────────────────
app.post('/api/upload', protect, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    const code = err?.code || err?.name || 'UPLOAD_ERROR';
    if (code === 'LIMIT_FILE_SIZE')       return res.status(413).json({ success: false, message: 'Archivo excede 10MB', code });
    if (code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ success: false, message: 'Campo de archivo inválido', code });
    return res.status(400).json({ success: false, message: err?.message || 'Error subiendo archivo', code });
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió archivo' });

    let category = (req.body?.category || req.query.category || req.headers['x-media-category'] || 'image').toLowerCase();
    if (req.file.mimetype === 'image/gif')      category = 'gif';
    if (req.file.mimetype.startsWith('video/')) category = 'video';

    let fileUrl = `/uploads/${req.file.filename}`, cloudinaryPublicId = null, source = 'local';
    const requiresCDN = (category === 'marketing' || category === 'employees-of-month') && process.env.NODE_ENV === 'production';

    if (requiresCDN && !CLOUDINARY_HAS_CREDENTIALS) {
      if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ success: false, message: `Cloudinary no configurado para ${category} en producción.` });
    }

    if (CLOUDINARY_HAS_CREDENTIALS) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, { folder: `crm/${category}`, resource_type: 'auto' });
        fileUrl = result.secure_url; cloudinaryPublicId = result.public_id; source = 'cloudinary';
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (e) {
        if (requiresCDN) {
          if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (_) {}
          return res.status(502).json({ success: false, message: `Cloudinary falló para ${category}`, details: { message: e?.message } });
        }
        console.warn('[UPLOAD] Cloudinary falló, usando local:', e?.message);
      }
    }

    const now = new Date();
    const doc = { filename: req.file.filename, originalName: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, path: req.file.path, url: fileUrl, cloudinaryPublicId, source, uploadedBy: req.user.username, category, uploadDate: now, createdAt: now, updatedAt: now };

    // Guardar metadata en BD si está disponible (no bloquea si BD está caída)
    let insertedId = null;
    try {
      if (!db) db = getDb();
      if (db) {
        const inserted = await db.collection('mediafiles').insertOne(doc);
        insertedId = inserted.insertedId;
      }
    } catch (dbErr) {
      console.warn('[UPLOAD] No se pudo guardar metadata en BD:', dbErr?.message);
    }

    return res.json({ success: true, message: 'Archivo subido', file: { id: insertedId, name: doc.originalName, url: doc.url, type: doc.mimetype, size: doc.size, category: doc.category, uploadDate: doc.uploadDate, source: doc.source } });
  } catch (e) {
    console.error('[UPLOAD]', e);
    if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(500).json({ success: false, message: 'Error subiendo archivo', ...(process.env.NODE_ENV !== 'production' ? { error: e?.message } : {}) });
  }
});

app.get('/api/media', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    const { category, limit = 50, offset = 0, orderBy = 'uploadDate', sort = 'desc' } = req.query;
    const query     = category && category !== 'all' ? { category } : {};
    const allowed   = { uploadDate:'uploadDate', createdAt:'createdAt', updatedAt:'updatedAt', originalName:'originalName', size:'size' };
    const sortField = allowed[orderBy] || 'uploadDate';
    const sortDir   = sort.toLowerCase() === 'asc' ? 1 : -1;
    const files     = await db.collection('mediafiles').find(query, { sort: { [sortField]: sortDir }, limit: parseInt(limit,10), skip: parseInt(offset,10) }).toArray();

    const valid = files.filter(file => {
      const isCloudinary = file.source === 'cloudinary' || /https?:\/\/res\.cloudinary\.com\//i.test(file.url||'');
      if (isCloudinary) return true;
      const filePath = path.join(uploadsDir, path.basename(file.url||''));
      return file.url && fs.existsSync(filePath);
    });

    return res.json(valid.map(f => ({ id: f._id, name: f.originalName, url: f.url, type: f.mimetype, size: f.size, category: f.category, uploadDate: f.uploadDate, uploadedBy: f.uploadedBy })));
  } catch (e) {
    console.error('[MEDIA]', e);
    return res.status(500).json({ success: false, message: 'Error obteniendo archivos' });
  }
});

app.delete('/api/media/:id', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    const file = await db.collection('mediafiles').findOne({ _id: new ObjectId(req.params.id) });
    if (!file) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
    const isAdminRole = ['admin','Administrador','administrador','Administrativo'].includes(req.user.role);
    if (file.uploadedBy !== req.user.username && !isAdminRole) return res.status(403).json({ success: false, message: 'Sin permisos para eliminar este archivo' });
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    await db.collection('mediafiles').deleteOne({ _id: new ObjectId(req.params.id) });
    return res.json({ success: true, message: 'Archivo eliminado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error eliminando archivo' });
  }
});

app.get('/api/media/stats', protect, async (req, res) => {
  try {
    if (!db) db = getDb();
    const stats      = await db.collection('mediafiles').aggregate([{ $group: { _id:'$category', count:{ $sum:1 }, totalSize:{ $sum:'$size' } } }]).toArray();
    const total      = await db.collection('mediafiles').countDocuments();
    const totalSizeR = await db.collection('mediafiles').aggregate([{ $group: { _id:null, total:{ $sum:'$size' } } }]).toArray();
    return res.json({ success: true, stats: { total, totalSize: totalSizeR[0]?.total||0, byCategory: stats } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Error obteniendo estadísticas' });
  }
});

app.get('/videos/:filename', (req, res) => {
  const videoPath = path.join(FRONTEND_PUBLIC_DIR, 'videos', req.params.filename);
  if (!fs.existsSync(videoPath)) return res.status(404).send('Video no encontrado');
  const stat     = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range    = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end   = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': (end-start)+1, 'Content-Type': 'video/mp4' });
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
    fs.createReadStream(videoPath).pipe(res);
  }
});

// ── VARIOS ────────────────────────────────────────────────────
app.get('/api/protected', protect, (req, res) => res.json({ message: 'Ruta protegida', user: req.user }));

app.get('/favicon.ico', (req, res) => {
  try {
    const p = path.join(__dirname, 'images', 'avatar.png');
    if (fs.existsSync(p)) { res.type('png'); return res.sendFile(p); }
  } catch (_) {}
  res.status(204).end();
});

app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/inicio', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'lead.html')));

app.get('/Costumer.html', protect, (req, res) => {
  if (req.user?.role === 'admin') {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    return res.sendFile(path.join(FRONTEND_DIR, 'Costumer.html'));
  }
  return res.redirect('/inicio?error=Acceso denegado');
});

// ── RUTAS MODULARES ───────────────────────────────────────────
app.use('/api/facturacion',            facturacionRoutes);
app.use('/api/facturacion-lineas',     facturacionLineasRoutes);
app.use('/api/llamadas-ventas-lineas', llamadasVentasLineasRoutes);
app.use('/api/ranking',                rankingRoutes);
app.use('/api/equipos',                equipoRoutes);
app.use('/api/employees-of-month',     employeesOfMonthRoutes);
try { app.use('/api/premios', require('./backend/routes/premios')); console.log('[SERVER] Rutas de premios cargadas'); } catch (e) { console.warn('[SERVER] premios route:', e?.message); }
app.use('/api',                        apiRoutes);

if (mediaProxy)  app.use('/media/proxy',  mediaProxy);
if (debugRoutes) app.use('/api/debug',    debugRoutes);
if (debugNoAuthRoutes && process.env.NODE_ENV !== 'production') {
  app.use('/api/debug-noauth', debugNoAuthRoutes);
  console.log('[SERVER] /api/debug-noauth montada (solo dev)');
}

try { const r = require('./backend/routes/debug-paola');       app.use('/api/debug-paola', r); }          catch (_) {}
try { const r = require('./backend/routes/bulk-status-phone'); app.use('/api/leads', r); console.log('[SERVER] bulk-status-phone cargado'); } catch (e) { console.warn('[SERVER] bulk-status-phone:', e?.message); }
try { const r = require('./backend/routes/migrate');           app.use('/api/migrate', r); console.log('[SERVER] Rutas de migración cargadas'); } catch (e) { console.warn('[SERVER] migrate:', e?.message); }

// ── FORCE LOGOUT ALL USERS ─────────────────────────────────────
(async () => {
  try {
    const db = getDb ? getDb() : null;
    if (db) {
      const setting = await db.collection('system_settings').findOne({ key: 'forceLogoutBefore' });
      if (setting && setting.value) {
        global.forceLogoutBefore = setting.value;
        console.log('[SERVER] forceLogoutBefore cargado:', new Date(setting.value).toISOString());
      }
    }
  } catch (e) { /* db puede no estar lista aún, se carga en el endpoint */ }
})();

app.post('/api/admin/force-logout-all', protect, authorize('Administrador','admin','administrador'), async (req, res) => {
  try {
    const ts = Date.now();
    global.forceLogoutBefore = ts;
    const db = getDb();
    if (db) await db.collection('system_settings').updateOne({ key: 'forceLogoutBefore' }, { $set: { key: 'forceLogoutBefore', value: ts, updatedAt: new Date(), updatedBy: req.user?.username } }, { upsert: true });
    if (global.io) global.io.emit('force-logout', { message: 'Sesión cerrada por el administrador', ts });
    console.log(`[ADMIN] force-logout-all ejecutado por ${req.user?.username} en ${new Date(ts).toISOString()}`);
    res.json({ success: true, message: 'Todas las sesiones han sido cerradas', ts });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: `Endpoint no encontrado: ${req.method} ${req.path}` });
  }
  if (req.path.includes('.')) return res.status(404).send('Archivo no encontrado');
  return res.sendFile(path.join(FRONTEND_DIR, 'lead.html'));
});

app.use((err, req, res, next) => {
  console.error('[ERROR GLOBAL]', err.stack || err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    status: 'error',
    message: process.env.NODE_ENV !== 'production' ? err.message : 'Error interno del servidor. Intente más tarde.'
  });
});

// ── SOCKET.IO Y ARRANQUE ──────────────────────────────────────
function startServer(port) {
  if (global.__rankingCache) { global.__rankingCache.clear(); console.log('[STARTUP] Cache ranking limpiado'); }

  io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) return cb(null, true);
        if (corsWhitelist().includes(origin)) return cb(null, true);
        cb(null, true);
      },
      methods: ['GET','POST'], credentials: true
    }
  });

  const connectedUsers       = new Map();
  const dashboardSubscribers = new Set();

  io.on('connection', (socket) => {
    console.log('[Socket.io] Conexión:', socket.id);

    socket.on('register', (userData) => {
      const { odigo, agenteId, username, role } = userData || {};
      const identifier = odigo || agenteId || username;
      if (identifier) {
        socket.userId = identifier; socket.userData = userData;
        socket.join(`user:${identifier}`);
        if (role) socket.join(`role:${String(role).toLowerCase().trim()}`);
        if (!connectedUsers.has(identifier)) connectedUsers.set(identifier, new Set());
        connectedUsers.get(identifier).add(socket.id);
        console.log(`[SOCKET] Usuario registrado: ${identifier} | rol: ${role||'(sin rol)'} | rooms: user:${identifier}, role:${role||'-'}`);
      }
    });

    socket.on('subscribe', ({ channel, user } = {}) => {
      if (channel === 'dashboard') {
        socket.dashboardUser = user;
        socket.join('dashboard-updates');
        dashboardSubscribers.add(socket.id);
        socket.emit('subscribed', { success: true, channel: 'dashboard' });
      }
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        const s = connectedUsers.get(socket.userId);
        if (s) { s.delete(socket.id); if (!s.size) connectedUsers.delete(socket.userId); }
      }
      dashboardSubscribers.delete(socket.id);
    });
  });

  global.broadcastDashboardUpdate = (updateData) => {
    if (io) io.to('dashboard-updates').emit('message', { type: 'dashboard-update', data: updateData, timestamp: new Date().toISOString() });
  };

  app.set('io', io);
  global.io = io;

  app.post('/api/populate-leads', protect, authorize('Administrador','admin','administrador','backoffice'), async (req, res) => {
    try {
      if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
      if (!db) db = getDb();
      const agents   = ['Irania Serrano','Roberto Velasquez','Marisol Beltran','Bryan Pleitez','Johana','Randal Martinez'];
      const services = ['ATT 18-25 MB','ATT 50-100 MB','ATT 100 FIBRA','ATT 300','DIRECTV Cable + Internet','XFINITY Gigabit','SPECTRUM 500 MB','FRONTIER FIBER','HUGHES NET','VIASAT'];
      const toUpdate = await db.collection('costumers_unified').find({ $or:[{ agenteNombre:{ $exists:false } },{ agenteNombre:null },{ agenteNombre:'' }] }).toArray();
      let updated = 0;
      for (const lead of toUpdate) {
        await db.collection('costumers_unified').updateOne({ _id: lead._id }, { $set: {
          agenteNombre: agents[Math.floor(Math.random() * agents.length)],
          servicios:    (!lead.servicios || lead.servicios === '') ? services[Math.floor(Math.random() * services.length)] : lead.servicios
        }});
        updated++;
      }
      global.initDashboardCache = { data: null, updatedAt: 0 };
      return res.json({ success: true, message: `${updated} leads actualizados`, updated });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Error', error: e.message });
    }
  });

  (async () => {
    try { await refreshInitDashboardCache(getDb()); console.log('[INIT-DASHBOARD] Pre-warm OK'); }
    catch (e) { console.warn('[INIT-DASHBOARD] Pre-warm falló:', e?.message); }

    setInterval(() => {
      refreshInitDashboardCache(getDb()).catch(e => console.warn('[INIT-DASHBOARD] background refresh error', e?.message));
    }, Math.max(10000, INIT_DASHBOARD_TTL));

    httpServer.listen(port, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[SERVER] Puerto: ${port}`);
        console.log(`[SERVER] Entorno: ${process.env.NODE_ENV || 'development'}`);
        console.log(`[SERVER] URL: http://localhost:${port}`);
        console.log('[Socket.io] WebSocket activo');
      }
    });
  })();

  httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.error(`[SERVER] Puerto ${port} en uso`); process.exit(1); }
    else console.error('[SERVER] Error:', e);
  });

  activeServer = httpServer;
  return httpServer;
}

(async () => {
  let retries = 0;
  while (!isConnected() && retries < 30) { await new Promise(r => setTimeout(r, 1000)); retries++; }
  if (isConnected()) console.log('[SERVER] BD lista, iniciando...');
  else               console.warn('[SERVER] BD no conectada, arrancando en modo degradado');
  startServer(PORT);
})();

async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] ${signal}...`);
  try {
    if (activeServer) await new Promise(r => activeServer.close(r));
    await closeConnection();
  } catch (e) { console.error('[SHUTDOWN] Error:', e); }
  process.exit(0);
}
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = { app, getIo: () => io };      