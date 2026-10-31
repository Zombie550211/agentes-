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
  // Sin cierre por inactividad: la sesión dura hasta que la persona la cierra
  // (ver js/core/inactivity-manager.js).
  ENABLE_INACTIVITY: false,
  
  // API endpoints
  API_BASE_URL: '',
  
  // Configuración de autenticación
  AUTH: {
    TOKEN_KEY: 'token',
    USER_KEY: 'user'
  }
};

