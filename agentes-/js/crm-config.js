/**
 * Configuración global del CRM
 */

window.CRM_CONFIG = {
  // Tiempo de inactividad antes de cerrar sesión (en milisegundos)
  // 30 minutos = 30 * 60 * 1000
  INACTIVITY_TIMEOUT: 30 * 60 * 1000,
  
  // Tiempo de advertencia antes de cerrar sesión (en milisegundos)
  // 5 minutos = 5 * 60 * 1000
  WARNING_TIME: 5 * 60 * 1000,
  
  // API Base URL
  API_BASE_URL: window.location.origin,
  
  // Páginas públicas (no requieren autenticación)
  PUBLIC_PAGES: ['/login.html', '/register.html', '/reset-password.html'],
  
  // Configuración de cookies
  COOKIE_CONFIG: {
    sameSite: 'lax',
    secure: window.location.protocol === 'https:'
  }
};

console.log('[CRM CONFIG] Configuración cargada:', window.CRM_CONFIG);
