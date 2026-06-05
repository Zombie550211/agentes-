/**
 * Fetch Interceptor - Intercepta todas las peticiones fetch para agregar el token automáticamente
 */

(function() {
  'use strict';

  const originalFetch = window.fetch;

  // Páginas que no requieren auth
  const publicPaths = ['/login.html', '/index.html', '/register.html', '/reset-password.html'];
  const isPublicPage = publicPaths.some(p => window.location.pathname.endsWith(p))
                    || window.location.pathname === '/';

  // No redirigir si ya estamos en el login
  if (isPublicPage) return;

  // Evitar múltiples redirects simultáneos
  let _redirecting = false;

  // Verificar sesión antes de redirigir — evita falsos positivos en el primer cargue
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
    } catch (_) {
      // Error de red — no redirigir
    }
  }

  window.fetch = function(...args) {
    let [url, config] = args;

    if (!config) config = {};

    // Siempre enviar cookies de sesión
    if (!config.credentials) config.credentials = 'include';

    return originalFetch(url, config)
      .then(response => {
        if (response.status === 401) {
          // No redirigir inmediatamente: verificar primero si la sesión es realmente inválida
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
