/**
 * Fetch Interceptor - Intercepta todas las peticiones fetch para agregar el token automáticamente
 */

(function() {
  'use strict';

  const originalFetch = window.fetch;

  // No redirigir si ya estamos en el login u otras páginas públicas
  const publicPaths = ['/login.html', '/index.html', '/register.html', '/reset-password.html'];
  if (publicPaths.some(p => window.location.pathname.endsWith(p)) || window.location.pathname === '/') return;

  let _redirecting = false;

  async function handleUnauthorized() {
    if (_redirecting) return;
    try {
      const r = await originalFetch('/api/auth/verify-server', { credentials: 'include' });
      const d = r.ok ? await r.json() : { authenticated: false };
      if (!d.authenticated) {
        _redirecting = true;
        console.warn('Sesión inválida. Redirigiendo al login...');
        window.location.href = '/login.html';
      }
    } catch (_) {}
  }

  window.fetch = function(...args) {
    let [url, config] = args;
    if (!config) config = {};
    if (!config.credentials) config.credentials = 'include';

    return originalFetch(url, config)
      .then(response => {
        if (response.status === 401) {
          handleUnauthorized();
        }
        return response;
      })
      .catch(error => {
        console.error('Error en fetch:', error);
        throw error;
      });
  };

})();
