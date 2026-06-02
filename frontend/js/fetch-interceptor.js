/**
 * Fetch Interceptor - Intercepta todas las peticiones fetch para agregar el token automáticamente
 */

(function() {
  'use strict';

  // Guardar la función fetch original
  const originalFetch = window.fetch;

  // Sobrescribir fetch
  window.fetch = function(...args) {
    let [url, config] = args;

    if (!config) {
      config = {};
    }

    // Asegurar que las cookies de sesión (httpOnly) se envíen siempre
    if (!config.credentials) {
      config.credentials = 'include';
    }

    return originalFetch(url, config)
      .then(response => {
        if (response.status === 401) {
          console.warn('Sesión expirada. Redirigiendo al login...');
          window.location.href = '/login.html';
        }
        return response;
      })
      .catch(error => {
        console.error('Error en fetch:', error);
        throw error;
      });
  };

})();
