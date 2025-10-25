/**
 * Logout Handler - Maneja el cierre de sesión
 */

(function() {
  'use strict';

  // Función para manejar el logout
  function handleLogout(event) {
    event.preventDefault();
    
    // Confirmar logout
    if (confirm('¿Estás seguro de que deseas cerrar sesión?')) {
      // Limpiar localStorage
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('username');
      localStorage.removeItem('role');
      
      // Redirigir al login
      window.location.href = 'index.html';
    }
  }

  // Agregar event listener cuando el DOM esté listo
  function initLogoutHandler() {
    // Buscar todos los botones de logout
    const logoutButtons = document.querySelectorAll('[data-logout-button], .btn-logout');
    
    logoutButtons.forEach(button => {
      button.addEventListener('click', handleLogout);
    });
    
    console.log('✅ Logout handler inicializado');
  }

  // Inicializar cuando el sidebar se cargue
  document.addEventListener('sidebar:loaded', initLogoutHandler);
  
  // También intentar inicializar después de un delay por si el sidebar ya está cargado
  setTimeout(initLogoutHandler, 1000);

})();
