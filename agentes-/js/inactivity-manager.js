/**
 * Gestor de inactividad del usuario
 * Cierra la sesión automáticamente después de un período de inactividad
 */

(function() {
  let inactivityTimer = null;
  let warningTimer = null;
  
  // Verificar si estamos en una página pública
  const currentPath = window.location.pathname;
  const isPublicPage = window.CRM_CONFIG?.PUBLIC_PAGES?.some(page => currentPath.endsWith(page));
  
  if (isPublicPage) {
    console.log('[INACTIVITY] Página pública, no se monitorea inactividad');
    return;
  }
  
  /**
   * Reinicia los timers de inactividad
   */
  function resetInactivityTimer() {
    // Limpiar timers existentes
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    if (warningTimer) {
      clearTimeout(warningTimer);
    }
    
    const config = window.CRM_CONFIG || {};
    const timeout = config.INACTIVITY_TIMEOUT || 30 * 60 * 1000; // 30 minutos por defecto
    const warningTime = config.WARNING_TIME || 5 * 60 * 1000; // 5 minutos por defecto
    
    // Timer de advertencia
    warningTimer = setTimeout(() => {
      console.warn('[INACTIVITY] Advertencia: sesión expirará pronto');
      // Aquí podrías mostrar un modal de advertencia
    }, timeout - warningTime);
    
    // Timer de cierre de sesión
    inactivityTimer = setTimeout(() => {
      console.log('[INACTIVITY] Tiempo de inactividad excedido, cerrando sesión');
      if (typeof window.logout === 'function') {
        window.logout();
      } else {
        // Fallback manual
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('/login.html?message=Sesión cerrada por inactividad');
      }
    }, timeout);
  }
  
  /**
   * Eventos que reinician el timer
   */
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  
  events.forEach(event => {
    document.addEventListener(event, resetInactivityTimer, true);
  });
  
  // Iniciar el timer al cargar
  resetInactivityTimer();
  
  console.log('[INACTIVITY MANAGER] Inicializado correctamente');
})();
