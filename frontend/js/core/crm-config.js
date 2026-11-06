/**
 * CRM Config - Configuración global del sistema
 */

// Silenciar toda la consola en producción (no localhost)
(function () {
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isLocal) {
    var noop = function () {};
    ['log', 'info', 'debug', 'warn', 'error', 'group', 'groupEnd', 'groupCollapsed', 'time', 'timeEnd', 'table', 'dir'].forEach(function (m) {
      try { console[m] = noop; } catch (_) {}
    });
  }
})();

window.CRM_CONFIG = {
  // Cierre de sesión tras 1 hora sin acción (ver js/core/inactivity-manager.js).
  INACTIVITY_TIMEOUT: 60 * 60 * 1000,
  ENABLE_INACTIVITY: true,
  
  // API endpoints
  API_BASE_URL: '',
  
  // Configuración de autenticación
  AUTH: {
    TOKEN_KEY: 'token',
    USER_KEY: 'user'
  }
};

