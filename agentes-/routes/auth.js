const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

// Configuración JWT
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';
const JWT_EXPIRES_IN = '24h';

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

    // Buscar usuario en la base de datos
    const user = await db.collection('users').findOne({ username: username });

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
router.get('/verify-server', (req, res) => {
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
        permissions: decoded.permissions || []
      }
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
