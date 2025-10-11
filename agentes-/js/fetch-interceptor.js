/**
 * Interceptor para fetch - automáticamente incluye cookies en todas las solicitudes
 */

(function() {
  // Guardar el fetch original
  const originalFetch = window.fetch;

  // Sobrescribir fetch para incluir credentials automáticamente solo en same-origin
  window.fetch = function(url, options = {}) {
    const absUrl = new URL(url, window.location.origin);
    const isSameOrigin = absUrl.origin === window.location.origin;

    // Asegurar headers estructura
    options.headers = options.headers || {};
    if (!(options.headers instanceof Headers)) {
      const headers = options.headers;
      options.headers = new Headers();
      for (const key in headers) {
        options.headers.append(key, headers[key]);
      }
    }

    // Solo forzar credentials en same-origin; en cross-origin usar 'omit'
    if (options.credentials == null) {
      options.credentials = isSameOrigin ? 'include' : 'omit';
    }

    // Agregar Accept JSON solo para same-origin o cuando esperamos JSON (no HEAD)
    const method = (options.method || 'GET').toUpperCase();
    const isHead = method === 'HEAD';
    if (!isHead && isSameOrigin && !options.headers.has('Accept')) {
      options.headers.append('Accept', 'application/json');
    }

    // Log para debug (opcional)
    console.log(`[FETCH] ${options.method || 'GET'} ${url}`);
    
    // Llamar al fetch original con las opciones modificadas
    return originalFetch(url, options)
      .then(response => {
        // Log de respuesta (opcional)
        console.log(`[FETCH] Response ${response.status} ${url}`);
        
        // Si recibimos 401 (no autorizado), redirigir al login
        if (response.status === 401) {
          console.warn('[FETCH] 401 No autorizado, redirigiendo a login');
          
          // Limpiar datos de sesión
          localStorage.removeItem('user');
          sessionStorage.removeItem('user');
          
          // Redirigir al login
          const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace(`/login.html?redirect=${currentUrl}`);
        }
        
        return response;
      })
      .catch(error => {
        console.error(`[FETCH] Error en ${url}:`, error);
        throw error;
      });
  };

  console.log('[FETCH INTERCEPTOR] Inicializado correctamente');
})();
