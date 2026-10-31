/**
 * Fetch Interceptor - Intercepta todas las peticiones fetch para agregar el token automáticamente
 */

(function() {
  'use strict';
  // Portal de facturación (js/portal/portal.js): sin la sesión del CRM, este script no aplica.
  if (window.PORTAL) return;

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
        try { localStorage.setItem('crm_show_update_for_all', '1'); } catch (_) {}
        console.warn('Sesión inválida. Redirigiendo al login...');
        window.location.href = '/login.html';
      }
    } catch (_) {}
  }

  // Varias piezas de cada página (menú, barra, avisos, asistente...) piden lo mismo al
  // cargar: verify-server llegaba a pedirse 7 veces por página. Los GET de estas rutas
  // comparten una sola petición; cada quien recibe su copia (clone) de la respuesta.
  const COMPARTIDAS = ['/api/auth/verify-server', '/api/notificaciones/status', '/api/monitoreo/alertas'];
  const VIGENCIA_MS = 3000;
  const enCurso = new Map();

  function claveCompartida(url, config) {
    if (typeof url !== 'string') return null;
    const metodo = (config.method || 'GET').toUpperCase();
    if (metodo !== 'GET') return null;
    const ruta = url.replace(location.origin, '');
    return COMPARTIDAS.indexOf(ruta) !== -1 ? ruta : null;
  }

  window.fetch = function(...args) {
    let [url, config] = args;
    if (!config) config = {};
    if (!config.credentials) config.credentials = 'include';

    const clave = claveCompartida(url, config);
    if (clave) {
      let p = enCurso.get(clave);
      if (!p) {
        p = originalFetch(url, config).then(response => {
          if (response.status === 401) handleUnauthorized();
          setTimeout(() => enCurso.delete(clave), VIGENCIA_MS);
          return response;
        }, error => { enCurso.delete(clave); throw error; });
        enCurso.set(clave, p);
      }
      return p.then(r => r.clone());
    }

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
