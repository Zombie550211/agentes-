/**
 * Manejador de autenticación y logout
 * Compatibilidad con logout-handler.js
 */

(function() {
  console.log('[AUTH LOGOUT] Inicializando...');

  // Verificar si ya existe window.logout
  if (typeof window.logout === 'function') {
    console.log('[AUTH LOGOUT] Función logout ya existe, usando la existente');
    return;
  }

  /**
   * Función de logout
   */
  async function logout() {
    try {
      console.log('[AUTH LOGOUT] Cerrando sesión...');
      
      // Llamar al endpoint de logout
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[AUTH LOGOUT] Sesión cerrada correctamente en el servidor');
      } else {
        console.warn('[AUTH LOGOUT] Error al cerrar sesión en el servidor:', data.message);
      }
    } catch (error) {
      console.error('[AUTH LOGOUT] Error:', error);
    } finally {
      // Limpiar datos locales independientemente del resultado
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('token');
      
      console.log('[AUTH LOGOUT] Datos locales limpiados, redirigiendo a login');
      
      // Redirigir al login
      window.location.replace('/login.html?message=Sesión cerrada correctamente');
    }
  }

  // Exponer función globalmente
  window.logout = logout;

  // Configurar botones de logout
  document.addEventListener('DOMContentLoaded', function() {
    const logoutButtons = document.querySelectorAll('[data-action="logout"], .logout-btn, #logoutBtn');
    
    logoutButtons.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        logout();
      });
    });
    
    if (logoutButtons.length > 0) {
      console.log('[AUTH LOGOUT] Configurados', logoutButtons.length, 'botones de logout');
    }
  });

  console.log('[AUTH LOGOUT] Inicializado correctamente');
})();
