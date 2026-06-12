/**
 * Inactivity Manager - Gestiona el cierre de sesión por inactividad
 */

(function() {
  'use strict';

  let inactivityTimer = null;
  let warningTimer = null;
  let warningShown = false;

  // Eventos que resetean el timer de inactividad
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

  // Función para cerrar sesión
  function logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    alert('Tu sesión ha expirado por inactividad. Por favor, inicia sesión nuevamente.');
    window.location.href = '/login.html';
  }

  // Función para mostrar advertencia
  function showWarning() {
    if (!warningShown) {
      warningShown = true;
      const remainingMinutes = Math.floor((window.CRM_CONFIG.INACTIVITY_TIMEOUT - window.CRM_CONFIG.WARNING_TIMEOUT) / 60000);
      alert(`Tu sesión expirará en ${remainingMinutes} minutos por inactividad. Mueve el mouse o presiona una tecla para mantener la sesión activa.`);
    }
  }

  // Keepalive: mientras haya actividad del usuario, renovar la sesión en el
  // servidor (el token se re-emite con cada petición). Máximo 1 ping cada 5 min.
  let lastKeepalive = 0;
  const KEEPALIVE_INTERVAL = 5 * 60 * 1000;

  function keepalive() {
    const now = Date.now();
    if (now - lastKeepalive < KEEPALIVE_INTERVAL) return;
    lastKeepalive = now;
    try {
      fetch('/api/auth/verify-server', { credentials: 'include' }).catch(function () {});
    } catch (_) {}
  }

  // Función para resetear los timers
  function resetTimers() {
    // Limpiar timers existentes
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (warningTimer) clearTimeout(warningTimer);

    // Resetear flag de advertencia
    warningShown = false;

    // Configurar nuevo timer de advertencia
    if (window.CRM_CONFIG.ENABLE_INACTIVITY) {
      warningTimer = setTimeout(showWarning, window.CRM_CONFIG.WARNING_TIMEOUT);

      // Configurar nuevo timer de logout
      inactivityTimer = setTimeout(logout, window.CRM_CONFIG.INACTIVITY_TIMEOUT);
    }

    // Renovar sesión en el servidor (sliding session)
    keepalive();
  }

  // Inicializar el sistema de inactividad
  function init() {
    if (!window.CRM_CONFIG || !window.CRM_CONFIG.ENABLE_INACTIVITY) {
      return;
    }

    // Agregar event listeners
    events.forEach(event => {
      document.addEventListener(event, resetTimers, true);
    });

    // Iniciar timers
    resetTimers();

  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
