/**
 * Interceptor global para peticiones API
 * Verifica permisos antes de realizar peticiones
 */
(function() {
  'use strict';

  // Función para verificar si el usuario es de Team Líneas
  function isTeamLineasUser() {
    try {
      const userData = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
      const username = (userData.username || '').toLowerCase();
      const role = (userData.role || '').toLowerCase();
      return role === 'teamlineas' || username.startsWith('lineas-');
    } catch (e) {
      console.error('Error al verificar usuario de Team Líneas:', e);
      return false;
    }
  }

  // Guardar la función fetch original
  const originalFetch = window.fetch;

  // Sobrescribir la función fetch global
  window.fetch = async function(resource, options = {}) {
    // Si es una petición a la API de leads y el usuario es de Team Líneas
    if (resource.includes('/api/leads') && isTeamLineasUser()) {
      console.warn('Acceso denegado a la API de leads para usuarios de Team Líneas');
      return Promise.reject({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          success: false,
          message: 'Acceso denegado: Los usuarios de Team Líneas no pueden acceder a esta funcionalidad',
          code: 'ACCESS_DENIED',
          requiredRole: 'teamlineas',
          currentRole: 'teamlineas'
        })
      });
    }

    // Para otras peticiones, usar fetch normal
    return originalFetch(resource, options);
  };

  console.log('API Interceptor cargado correctamente');
})();
