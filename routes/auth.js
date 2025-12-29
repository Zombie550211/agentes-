const express = require('express');
const router = express.Router();

/**
 * @route POST /api/auth/register
 * @desc Registrar nuevo usuario
 * @access Public (solo para pruebas, proteger en producción)
 */
router.post('/register', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });
    const { name, username, email, password, role, team } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios (usuario, contraseña, rol)' });
    }
    // Verificar si ya existe el usuario
    const exists = await db.collection('users').findOne({ username });
    if (exists) {
      return res.status(409).json({ success: false, message: 'El usuario ya existe' });
    }
    // Hashear contraseña
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);
    const now = new Date();
    const userDoc = {
      username,
      password: hashed,
      role,
      team: team || '',
      name: name || '',
      email: email || '',
      createdAt: now,
      updatedAt: now
    };
    const result = await db.collection('users').insertOne(userDoc);
    return res.json({ success: true, message: 'Usuario creado', userId: result.insertedId });
  } catch (e) {
    console.error('[REGISTER] Error:', e);
    return res.status(500).json({ success: false, message: 'Error al crear usuario' });
  }
});
// ...existing code...
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// Configuración JWT
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
const JWT_EXPIRES_IN = '7d';

// ===== Password reset helpers =====
function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (host && port) {
    return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  }
  // Fallback a Gmail u otros proveedores por 'service'
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function saveResetCode(db, email, code, ip) {
  const coll = db.collection('password_resets');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  const doc = { email, code, expiresAt, used: false, createdAt: new Date(), ip };
  await coll.insertOne(doc);
  return doc;
}

async function validateResetCode(db, email, code) {
  const coll = db.collection('password_resets');
  const now = new Date();
  const rec = await coll.findOne({ email, code, used: false, expiresAt: { $gt: now } });
  return !!rec;
}

async function markCodeUsed(db, email, code) {
  const coll = db.collection('password_resets');
  await coll.updateOne({ email, code, used: false }, { $set: { used: true, usedAt: new Date() } });
}

// ===== Endpoints: Password Reset via Email =====
/**
 * POST /api/auth/forgot-password
 * body: { email }
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });
    const emailRaw = req.body?.email;
    const email = normalizeEmail(emailRaw);
    if (!email) return res.status(400).json({ success: false, message: 'Email requerido' });

    const user = await db.collection('users').findOne({ email });
    if (!user) {
      // Responder éxito genérico para no filtrar existencia de emails
      return res.json({ success: true, message: 'Si el correo existe, enviaremos un código' });
    }

    const code = genCode();
    await saveResetCode(db, email, code, req.ip);

    // Enviar email
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const transporter = buildTransporter();
    const info = await transporter.sendMail({
      from,
      to: email,
      subject: 'Código de verificación - Restablecer contraseña',
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
          <h2>Restablecer contraseña</h2>
          <p>Tu código de verificación es:</p>
          <p style="font-size:28px;font-weight:800;letter-spacing:4px">${code}</p>
          <p>El código expira en 10 minutos.</p>
        </div>
      `
    });
    console.log('[FORGOT-PASSWORD] Email enviado:', info?.messageId || 'ok');

    return res.json({ success: true, message: 'Código enviado si el correo existe' });
  } catch (e) {
    console.error('[FORGOT-PASSWORD] Error:', e);
    return res.status(500).json({ success: false, message: 'Error enviando el código' });
  }
});

/**
 * POST /api/auth/verify-reset-code
 * body: { email, code }
 */
router.post('/verify-reset-code', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    if (!email || !code) return res.status(400).json({ success: false, message: 'Email y código requeridos' });
    const ok = await validateResetCode(db, email, code);
    if (!ok) return res.status(400).json({ success: false, message: 'Código inválido o expirado' });
    return res.json({ success: true, message: 'Código válido' });
  } catch (e) {
    console.error('[VERIFY-RESET-CODE] Error:', e);
    return res.status(500).json({ success: false, message: 'Error verificando código' });
  }
});

/**
 * POST /api/auth/reset-password-by-email
 * body: { email, code, newPassword }
 */
router.post('/reset-password-by-email', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!email || !code || !newPassword) return res.status(400).json({ success: false, message: 'Campos requeridos: email, code, newPassword' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });

    const valid = await validateResetCode(db, email, code);
    if (!valid) return res.status(400).json({ success: false, message: 'Código inválido o expirado' });

    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);
    await db.collection('users').updateOne({ _id: user._id }, { $set: { password: hashed, updatedAt: new Date() } });
    await markCodeUsed(db, email, code);
    return res.json({ success: true, message: 'Contraseña actualizada' });
  } catch (e) {
    console.error('[RESET-PASSWORD-BY-EMAIL] Error:', e);
    return res.status(500).json({ success: false, message: 'Error al restablecer contraseña' });
  }
});

/**
 * POST /api/auth/reset-password
 * body: { username, newPassword }
 * access: Protected (admin)
 */
router.post('/reset-password', protect, authorize('admin', 'Administrador', 'administrador'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const username = String(req.body?.username || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!username || !newPassword) return res.status(400).json({ success: false, message: 'Campos requeridos: username, newPassword' });
    if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });

    // Buscar usuario permitiendo variantes comunes (misma lógica que en login)
    const esc = (s) => String(s||'').replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    const uname = username;
    const variants = Array.from(new Set([
      uname,
      uname.replace(/[\s]+/g, '.'),
      uname.replace(/[.]+/g, ' '),
      uname.replace(/[.\s]+/g, ' '),
      uname.replace(/[.\s]+/g, '.')
    ].filter(Boolean)));
    const ors = variants.flatMap(v => {
      const rx = new RegExp(`^${esc(v)}$`, 'i');
      return [ { username: rx }, { name: rx } ];
    });

    const user = await db.collection('users').findOne({ $or: ors });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);
    await db.collection('users').updateOne({ _id: user._id }, { $set: { password: hashed, updatedAt: new Date() } });

    return res.json({ success: true, message: 'Contraseña restablecida' });
  } catch (e) {
    console.error('[RESET-PASSWORD] Error:', e);
    return res.status(500).json({ success: false, message: 'Error al restablecer contraseña' });
  }
});

/**
 * @route POST /api/auth/login
 * @desc Iniciar sesión
 * @access Public
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validaciones básicas
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Usuario y contraseña son requeridos'
      });
    }

    // Conectar a la base de datos
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    // Buscar usuario en la base de datos con lógica robusta de variantes
    // Normalización: quitar acentos y diacríticos
    const normalize = (s) => String(s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const uname = String(username || '').trim();
    const unameSimple = normalize(uname); // Sin acentos

    // Detectar CamelCase y separar (ej: EmanuelVelásquez -> Emanuel Velásquez)
    // Solo si no contiene ya espacios ni puntos para evitar romper "Juan.Perez"
    const isCamelCandidate = !/[\s.]/.test(uname) && /[a-z][A-Z]/.test(uname);
    const camelSpaced = isCamelCandidate ? uname.replace(/([a-z])([A-Z])/g, '$1 $2') : uname;
    const camelDot = isCamelCandidate ? uname.replace(/([a-z])([A-Z])/g, '$1.$2') : uname;

    const rawVariants = [
      uname,                            // 1. Literal: "EmanuelVelásquez"
      unameSimple,                      // 2. Sin acentos: "EmanuelVelasquez"
      
      // Variantes de espacio <-> punto (Original)
      uname.replace(/[\s]+/g, '.'),
      uname.replace(/[.]+/g, ' '),
      
      // Variantes de espacio <-> punto (Sin acentos)
      unameSimple.replace(/[\s]+/g, '.'),
      unameSimple.replace(/[.]+/g, ' '),
      
      // Variantes CamelCase (si aplica)
      camelSpaced,                      // "Emanuel Velásquez"
      camelDot,                         // "Emanuel.Velásquez"
      normalize(camelSpaced),           // "Emanuel Velasquez"
      normalize(camelDot)               // "Emanuel.Velasquez"
    ];

    // Eliminar duplicados y vacíos
    const variants = Array.from(new Set(rawVariants.filter(Boolean)));
    
    // Función de escape para Regex
    const esc = (s) => String(s||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const ors = variants.flatMap(v => {
      const rx = new RegExp(`^${esc(v)}$`, 'i');
      return [ { username: rx }, { name: rx } ];
    });

    console.log(`[AUTH LOGIN] Buscando usuario: "${uname}" con ${variants.length} variantes`, variants);

    const user = await db.collection('users').findOne({ $or: ors });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Crear token JWT
    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
        role: user.role,
        team: user.team,
        supervisor: user.supervisor
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Configurar opciones de cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
      path: '/'
    };

    // Responder con información del usuario y token
    res.cookie('token', token, cookieOptions).json({
      success: true,
      message: 'Inicio de sesión exitoso',
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        team: user.team,
        supervisor: user.supervisor,
        name: user.name
      },
      token: token
    });

  } catch (error) {
    console.error('[AUTH LOGIN] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route POST /api/auth/logout
 * @desc Cerrar sesión
 * @access Private
 */
router.post('/logout', (req, res) => {
  try {
    // Limpiar cookie del token
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/'
    });

    res.json({
      success: true,
      message: 'Sesión cerrada exitosamente'
    });
  } catch (error) {
    console.error('[AUTH LOGOUT] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route GET /api/auth/me
 * @desc Obtener información del usuario actual
 * @access Private
 */
router.get('/me', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Error de conexión a la base de datos'
      });
    }

    const user = await db.collection('users').findOne(
      { username: req.user.username },
      { projection: { password: 0 } } // Excluir contraseña
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        team: user.team,
        supervisor: user.supervisor,
        name: user.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('[AUTH ME] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

/**
 * @route GET /api/auth/verify-server
 * @desc Verificar autenticación desde el servidor (sin protección)
 * @access Public
 */
router.get('/verify-server', async (req, res) => {
  console.log('[VERIFY-SERVER] Verificando autenticación...');
  console.log('[VERIFY-SERVER] Cookies:', req.cookies);
  console.log('[VERIFY-SERVER] Authorization header:', req.headers.authorization);

  // Verificar si hay token en cookies o en el header Authorization
  let token = req.cookies?.token;

  // Si no hay token en cookies, verificar en el header Authorization
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
    console.log('[VERIFY-SERVER] Token encontrado en Authorization header');
  }

  if (!token) {
    console.log('[VERIFY-SERVER] No se encontró token');
    return res.json({
      success: false,
      message: 'No se encontró token',
      authenticated: false,
      role: null,
      username: null
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[VERIFY-SERVER] Token válido para usuario:', decoded.username);

    // Construir respuesta con datos del JWT
    const userData = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      team: decoded.team,
      supervisor: decoded.supervisor,
      permissions: decoded.permissions || []
    };

    // Intentar obtener información adicional del usuario desde BD (avatar, etc.)
    try {
      const db = getDb();
      if (!db) {
        console.log('[VERIFY-SERVER] BD no disponible para obtener avatar');
      } else {
        const usersCollection = db.collection('users');
        const userDoc = await usersCollection.findOne(
          { username: decoded.username },
          { projection: { avatarUrl: 1, avatarFileId: 1 } }
        );

        if (userDoc) {
          if (userDoc.avatarUrl) userData.avatarUrl = userDoc.avatarUrl;
          if (userDoc.avatarFileId) userData.avatarFileId = userDoc.avatarFileId;
          console.log('[VERIFY-SERVER] Avatar cargado del servidor para usuario:', decoded.username);
        }
      }
    } catch (dbErr) {
      console.warn('[VERIFY-SERVER] Error obteniendo avatar de BD:', dbErr.message);
    }

    res.json({
      success: true,
      message: 'Token válido',
      authenticated: true,
      user: userData
    });
  } catch (error) {
    console.error('[VERIFY-SERVER] Error verificando token:', error.message);
    res.json({
      success: false,
      message: 'Token inválido',
      authenticated: false,
      role: null,
      username: null,
      error: error.message
    });
  }
});

/**
 * @route GET /api/auth/verify
 * @desc Verificar autenticación (endpoint compatible con páginas existentes)
 * @access Public
 */
router.get('/verify', (req, res) => {
  console.log('[VERIFY] Verificando autenticación...');
  console.log('[VERIFY] Cookies:', req.cookies);
  console.log('[VERIFY] Authorization header:', req.headers.authorization);
  
  // Verificar si hay token en cookies o en el header Authorization
  let token = req.cookies?.token;
  
  // Si no hay token en cookies, verificar en el header Authorization
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
    console.log('[VERIFY] Token encontrado en Authorization header');
  }

  if (!token) {
    console.log('[VERIFY] No se encontró token');
    return res.status(401).json({
      success: false,
      message: 'No se encontró token',
      authenticated: false
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[VERIFY] Token válido para usuario:', decoded.username);

    res.json({
      success: true,
      message: 'Token válido',
      authenticated: true,
      user: {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
        team: decoded.team,
        supervisor: decoded.supervisor,
        name: decoded.name,
        permissions: decoded.permissions || []
      }
    });
  } catch (error) {
    console.error('[VERIFY] Error verificando token:', error.message);
    res.status(401).json({
      success: false,
      message: 'Token inválido',
      authenticated: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/auth/debug-storage
 * @desc Endpoint de debug para verificar storage
 * @access Public
 */
router.get('/debug-storage', (req, res) => {
  res.json({
    success: true,
    message: 'Este endpoint es solo para debugging',
    note: 'Para verificar si hay token, usa /api/auth/verify-server',
    cookies: req.cookies,
    headers: {
      cookie: req.headers.cookie,
      authorization: req.headers.authorization
    }
  });
});

module.exports = router;
