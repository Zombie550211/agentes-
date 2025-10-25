/**
 * User Info - Actualiza la información del usuario en el sidebar
 */

(function() {
  'use strict';

  // Función para cargar estadísticas del usuario
  async function loadUserStats() {
    try {
      // Obtener información del usuario usando cookies (mismo método que sidebar)
      const userResponse = await fetch('/api/auth/verify-server', {
        method: 'GET',
        credentials: 'include'
      });

      if (!userResponse.ok) {
        throw new Error('Error obteniendo información del usuario');
      }

      const userData = await userResponse.json();
      const user = userData.user || userData;

      // Obtener ventas del mes actual
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      
      const leadsResponse = await fetch(`/api/leads?month=${month}&year=${year}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (leadsResponse.ok) {
        const leadsData = await leadsResponse.json();
        // Manejar diferentes estructuras de respuesta
        let leads = [];
        if (Array.isArray(leadsData)) {
          leads = leadsData;
        } else if (Array.isArray(leadsData.leads)) {
          leads = leadsData.leads;
        } else if (Array.isArray(leadsData.data)) {
          leads = leadsData.data;
        }

        // Filtrar ventas del usuario actual
        const userLeads = leads.filter(lead => 
          lead.agenteNombre === user.username || lead.agente === user.username
        );

        // Calcular puntos totales
        const totalPoints = userLeads.reduce((sum, lead) => {
          const points = parseFloat(lead.puntaje || lead.puntos || 0);
          return sum + points;
        }, 0);

        // Actualizar elementos del DOM
        const salesElement = document.getElementById('sidebar-user-sales');
        const pointsElement = document.getElementById('sidebar-user-points');

        if (salesElement) {
          salesElement.textContent = userLeads.length;
        }

        if (pointsElement) {
          pointsElement.textContent = totalPoints.toFixed(1);
        }

        console.log(`✅ Estadísticas actualizadas: ${userLeads.length} ventas, ${totalPoints.toFixed(1)} puntos`);
      }
    } catch (error) {
      console.error('Error cargando estadísticas del usuario:', error);
    }
  }

  // Inicializar cuando el sidebar se cargue
  document.addEventListener('sidebar:loaded', () => {
    setTimeout(loadUserStats, 500);
  });

  // Exportar función para uso externo
  window.loadUserStats = loadUserStats;

})();
