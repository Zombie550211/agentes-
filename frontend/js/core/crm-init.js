/**
 * CRM Init - Inicialización global del sistema CRM
 */

(function() {
  'use strict';

  // Verificar autenticación
  async function checkAuth() {
    const currentPage = window.location.pathname.split('/').pop();
    
    // Páginas públicas que no requieren autenticación
    const publicPages = ['index.html', 'register.html', 'reset-password.html', ''];
    
    if (publicPages.includes(currentPage)) {
      return true;
    }
    
    // Si inicio.html ya inició el prefetch, reusar esa Promise sin llamada extra
    if (window.__homeDataPromise) {
      try {
        const hd = await window.__homeDataPromise;
        if (hd && hd.user) return true;
      } catch (_) {}
    }
    if (window.__homeData && window.__homeData.user) return true;

    // Fallback para páginas sin prefetch
    try {
      const response = await fetch('/api/auth/verify-server', {
        method: 'GET',
        credentials: 'include'
      });
      if (!response.ok) { window.location.href = '/login.html'; return false; }
      const data = await response.json();
      if (!data.authenticated) { window.location.href = '/login.html'; return false; }
      return true;
    } catch (error) {
      return true;
    }
  }

  // Inicializar sistema
  async function init() {
    // Verificar autenticación
    const isAuth = await checkAuth();
    if (!isAuth) {
      return;
    }

  }

  // Ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
