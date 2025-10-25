/**
 * Logout Handler - Maneja el cierre de sesión
 */

(function() {
  'use strict';

  // Función para manejar el logout
  function handleLogout(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Confirmar logout
    if (confirm('¿Estás seguro de que deseas cerrar sesión?')) {
      // Limpiar localStorage y sessionStorage
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('username');
      localStorage.removeItem('role');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      
      // Limpiar cookies llamando al endpoint de logout
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      }).finally(() => {
        // Redirigir al login
        window.location.href = 'index.html';
      });
    }
    
    return false;
  }

  // Agregar event listener cuando el DOM esté listo
  function initLogoutHandler() {
    // Buscar todos los botones de logout
    const logoutButtons = document.querySelectorAll('[data-logout-button], .btn-logout');
    
    if (logoutButtons.length === 0) {
      console.warn('⚠️ No se encontraron botones de logout');
      return;
    }
    
    logoutButtons.forEach(button => {
      // Remover listeners previos para evitar duplicados
      button.removeEventListener('click', handleLogout);
      // Agregar nuevo listener
      button.addEventListener('click', handleLogout, true);
    });
    
    console.log('✅ Logout handler inicializado -', logoutButtons.length, 'botón(es) encontrado(s)');
  }

  // Inicializar cuando el sidebar se cargue
  document.addEventListener('sidebar:loaded', initLogoutHandler);
  
  // También intentar inicializar después de un delay por si el sidebar ya está cargado
  setTimeout(initLogoutHandler, 1000);
  
  // Inicializar cuando el DOM esté completamente cargado
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogoutHandler);
  } else {
    initLogoutHandler();
  }

})();
