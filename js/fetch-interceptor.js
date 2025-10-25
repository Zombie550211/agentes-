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

    // Inicializar config si no existe
    if (!config) {
      config = {};
    }

    // Inicializar headers si no existen
    if (!config.headers) {
      config.headers = {};
    }

    // Agregar token si existe y no está ya presente
    const token = localStorage.getItem('token');
    if (token && !config.headers['Authorization']) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    // Llamar al fetch original con los argumentos modificados
    return originalFetch(url, config)
      .then(response => {
        // Si la respuesta es 401 (No autorizado), redirigir al login
        if (response.status === 401) {
          console.warn('Token inválido o expirado. Redirigiendo al login...');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = 'index.html';
        }
        return response;
      })
      .catch(error => {
        console.error('Error en fetch:', error);
        throw error;
      });
  };

  console.log('✅ Fetch interceptor inicializado');

})();
