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
  // Tiempo de inactividad en milisegundos (5 minutos sin acción en el CRM)
  INACTIVITY_TIMEOUT: 5 * 60 * 1000,
  
  // Aviso antes del logout (1 minuto antes)
  WARNING_TIMEOUT: 4 * 60 * 1000,
  
  // Habilitar sistema de inactividad
  ENABLE_INACTIVITY: true,
  
  // API endpoints
  API_BASE_URL: '',
  
  // Configuración de autenticación
  AUTH: {
    TOKEN_KEY: 'token',
    USER_KEY: 'user'
  }
};

