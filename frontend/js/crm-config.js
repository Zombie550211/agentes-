/**
 * CRM Config - Configuración global del sistema
 */

window.CRM_CONFIG = {
  // Tiempo de inactividad en milisegundos (30 minutos)
  INACTIVITY_TIMEOUT: 30 * 60 * 1000,
  
  // Tiempo de advertencia antes del logout (5 minutos antes)
  WARNING_TIMEOUT: 25 * 60 * 1000,
  
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

console.log('✅ CRM Config cargado');
