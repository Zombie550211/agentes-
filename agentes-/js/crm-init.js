/**
 * Inicializador del CRM
 * Se ejecuta cuando el DOM está completamente cargado
 */

(function() {
  console.log('[CRM INIT] Iniciando aplicación CRM...');
  
  // Verificar si estamos en una página pública
  const currentPath = window.location.pathname;
  const publicPages = window.CRM_CONFIG?.PUBLIC_PAGES || ['/login.html', '/register.html', '/reset-password.html'];
  const isPublicPage = publicPages.some(page => currentPath.endsWith(page));
  
  if (isPublicPage) {
    console.log('[CRM INIT] Página pública, omitiendo inicialización completa');
    return;
  }
  
  /**
   * Inicializa la aplicación
   */
  function initializeApp() {
    console.log('[CRM INIT] Inicializando componentes...');
    
    // Verificar que el usuario esté autenticado
    if (!window.isAuthenticated || !window.isAuthenticated()) {
      console.warn('[CRM INIT] Usuario no autenticado');
      return;
    }
    
    // Actualizar información de usuario en el DOM
    if (window.updateUserInfoInDOM) {
      window.updateUserInfoInDOM();
    }
    
    // Cargar sidebar si es necesario
    if (window.loadSidebar) {
      window.loadSidebar();
    }
    
    // Configurar botones de logout
    const logoutButtons = document.querySelectorAll('[data-action="logout"], .logout-btn, #logoutBtn');
    logoutButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.logout) {
          window.logout();
        }
      });
    });
    
    console.log('[CRM INIT] Aplicación inicializada correctamente');
  }
  
  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
  
})();
