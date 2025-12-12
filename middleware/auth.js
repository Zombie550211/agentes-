const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');

// Configuración JWT
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';

/**
 * Middleware de protección: verifica autenticación JWT
 */
const protect = async (req, res, next) => {
  try {
    // Allow local public diagnostic endpoint without token (temporary)
    try {
      if (req && req.originalUrl && req.originalUrl.includes('/collection-counts-public')) return next();
    } catch (e) { /* no-op */ }
    let token;

    // Verificar token en header Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('[AUTH] Token desde Authorization header:', token ? token.substring(0, 30) + '...' : 'vacío');
    }
    // Verificar token en cookies
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
      console.log('[AUTH] Token desde cookies:', token ? token.substring(0, 30) + '...' : 'vacío');
    }

    if (!token) {
      console.log('[AUTH] No se encontró token en la petición');
      return res.status(401).json({
        success: false,
        message: 'Acceso denegado. Token no proporcionado.'
      });
    }

    // Validar formato del token antes de verificar
    if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
      console.error('[AUTH] Token malformado:', token ? `Longitud: ${token.length}, Partes: ${token.split('.').length}` : 'vacío');
      return res.status(401).json({
        success: false,
        message: 'Token inválido'
      });
    }

    try {
      // Verificar token
      const decoded = jwt.verify(token, JWT_SECRET);

      // Obtener información del usuario desde la base de datos
      const db = getDb();
      if (!db) {
        return res.status(500).json({
          success: false,
          message: 'Error de conexión a la base de datos'
        });
      }

      const user = await db.collection('users').findOne({ username: decoded.username });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no encontrado'
        });
      }

      // Agregar usuario a la request
      req.user = {
        id: user._id,
        username: user.username,
        role: user.role,
        team: user.team,
        supervisor: user.supervisor,
        name: user.name,
        avatarUrl: user.avatarUrl,
        avatarFileId: user.avatarFileId,
        avatarUpdatedAt: user.avatarUpdatedAt
      };

      next();
    } catch (error) {
      console.error('[AUTH] Error verificando token:', error);
      return res.status(401).json({
        success: false,
        message: 'Token inválido'
      });
    }
  } catch (error) {
    console.error('[AUTH] Error en middleware protect:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Middleware de autorización: verifica roles específicos
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      const userRole = req.user.role;

      // Verificar si el rol del usuario está en la lista de roles permitidos
      if (!roles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Acceso denegado. Se requiere uno de los siguientes roles: ${roles.join(', ')}`
        });
      }

      next();
    } catch (error) {
      console.error('[AUTH] Error en middleware authorize:', error);
      return res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  };
};

/**
 * Middleware para verificar permisos específicos
 */
const checkPermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      // Verificar permisos específicos según el rol
      const rolePermissions = {
        'Administrador': ['read', 'write', 'delete', 'manage_users', 'manage_teams'],
        'admin': ['read', 'write', 'delete', 'manage_users', 'manage_teams'],
        'administrador': ['read', 'write', 'delete', 'manage_users', 'manage_teams'],
        'Administrativo': ['read', 'write', 'manage_teams'],
        'Backoffice': ['read', 'write', 'manage_users'],
        'Supervisor': ['read', 'write'],
        'Agente': ['read']
      };

      const userPermissions = rolePermissions[req.user.role] || [];

      if (!userPermissions.includes(permission)) {
        return res.status(403).json({
          success: false,
          message: `Acceso denegado. Permiso requerido: ${permission}`
        });
      }

      next();
    } catch (error) {
      console.error('[AUTH] Error en middleware checkPermission:', error);
      return res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  };
};

module.exports = {
  protect,
  authorize,
  checkPermission
};
