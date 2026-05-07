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
    
    // Verificar autenticación usando cookies (método actual del sistema)
    try {
      const response = await fetch('/api/auth/verify-server', {
        method: 'GET',
        credentials: 'include'
      });
      
      if (!response.ok) {
        console.warn('No autenticado. Redirigiendo al login...');
        window.location.href = 'index.html';
        return false;
      }
      
      const data = await response.json();
      if (!data.authenticated) {
        console.warn('No autenticado. Redirigiendo al login...');
        window.location.href = 'index.html';
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error verificando autenticación:', error);
      // No redirigir en caso de error de red, permitir que la página cargue
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
