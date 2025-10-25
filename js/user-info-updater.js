/**
 * User Info Updater - Actualiza información del usuario periódicamente
 */

(function() {
  'use strict';

  // Intervalo de actualización (5 minutos)
  const UPDATE_INTERVAL = 5 * 60 * 1000;
  let updateTimer = null;

  // Función para actualizar información del usuario
  async function updateUserInfo() {
    try {
      // Si existe la función loadUserStats, llamarla
      if (typeof window.loadUserStats === 'function') {
        await window.loadUserStats();
      }
    } catch (error) {
      console.error('Error actualizando información del usuario:', error);
    }
  }

  // Iniciar actualizaciones periódicas
  function startPeriodicUpdates() {
    // Actualizar inmediatamente
    updateUserInfo();
    
    // Configurar actualizaciones periódicas
    updateTimer = setInterval(updateUserInfo, UPDATE_INTERVAL);
    
    console.log('✅ Actualizaciones periódicas de usuario iniciadas');
  }

  // Detener actualizaciones
  function stopPeriodicUpdates() {
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
  }

  // Inicializar cuando el sidebar se cargue
  document.addEventListener('sidebar:loaded', () => {
    setTimeout(startPeriodicUpdates, 1000);
  });

  // Limpiar al salir de la página
  window.addEventListener('beforeunload', stopPeriodicUpdates);

})();
