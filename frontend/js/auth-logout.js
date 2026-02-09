/**
 * Auth Logout - Alias de logout-handler.js
 *
 * Este archivo existe para páginas que incluyen js/auth-logout.js en lugar de
 * js/logout-handler.js directamente. Aquí cargamos dinámicamente el script
 * real de logout para que el botón de "Cerrar Sesión" funcione igual en todas
 * las pantallas (incluyendo inicio.html).
 */

(function() {
  try {
    // Evitar cargarlo dos veces si ya existe
    if (window.__logoutHandlerLoaded) {
      console.log('✅ Auth logout: logout-handler ya estaba cargado');
      return;
    }

    var script = document.createElement('script');
    script.src = 'js/logout-handler.js';
    script.async = false; // mantener orden razonable
    script.onload = function() {
      window.__logoutHandlerLoaded = true;
      console.log('✅ Auth logout: logout-handler cargado correctamente');
    };
    script.onerror = function(e) {
      console.warn('⚠️ Auth logout: no se pudo cargar js/logout-handler.js', e);
    };

    document.head.appendChild(script);
  } catch (e) {
    console.warn('⚠️ Auth logout: error inicializando alias:', e.message);
  }
})();
