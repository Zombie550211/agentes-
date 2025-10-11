/**
 * Core del Dashboard
 * Funcionalidades principales para el dashboard
 */

(function() {
  console.log('[DASHBOARD CORE] Inicializando...');

  /**
   * Cargar estadísticas del dashboard
   */
  async function loadDashboardStats() {
    try {
      console.log('[DASHBOARD] Cargando estadísticas...');
      
      // Aquí puedes hacer llamadas a la API para obtener estadísticas reales
      // Por ahora, retornamos datos de ejemplo
      
      return {
        ventasHoy: 0,
        ventasMes: 0,
        pendientes: 0,
        cancelados: 0
      };
    } catch (error) {
      console.error('[DASHBOARD] Error cargando estadísticas:', error);
      return null;
    }
  }

  /**
   * Actualizar tarjetas de resumen
   */
  function updateSummaryCards(stats) {
    if (!stats) return;
    
    const elements = {
      ventasHoy: document.getElementById('costumer-ventas-hoy'),
      ventasMes: document.getElementById('costumer-ventas-mes'),
      pendientes: document.getElementById('costumer-pendientes'),
      cancelados: document.getElementById('costumer-cancelados')
    };
    
    if (elements.ventasHoy) elements.ventasHoy.textContent = stats.ventasHoy || 0;
    if (elements.ventasMes) elements.ventasMes.textContent = stats.ventasMes || 0;
    if (elements.pendientes) elements.pendientes.textContent = stats.pendientes || 0;
    if (elements.cancelados) elements.cancelados.textContent = stats.cancelados || 0;
    
    console.log('[DASHBOARD] Tarjetas actualizadas');
  }

  /**
   * Calcular estadísticas desde leads
   */
  function calculateStats(leads) {
    if (!Array.isArray(leads)) return null;
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const stats = {
      ventasHoy: 0,
      ventasMes: 0,
      pendientes: 0,
      cancelados: 0
    };
    
    leads.forEach(lead => {
      const fechaVenta = lead.dia_venta || lead.fecha_contratacion || lead.fecha || lead.createdAt;
      
      // Ventas de hoy
      if (fechaVenta && fechaVenta.startsWith(today)) {
        stats.ventasHoy++;
      }
      
      // Ventas del mes
      if (fechaVenta) {
        const fecha = new Date(fechaVenta);
        if (fecha.getMonth() === currentMonth && fecha.getFullYear() === currentYear) {
          stats.ventasMes++;
        }
      }
      
      // Pendientes
      const status = (lead.status || '').toLowerCase();
      if (status === 'pendiente' || status === 'pending') {
        stats.pendientes++;
      }
      
      // Cancelados
      if (status === 'cancelado' || status === 'cancelled' || status === 'canceled') {
        stats.cancelados++;
      }
    });
    
    return stats;
  }

  /**
   * Inicializar dashboard
   */
  async function initDashboard() {
    console.log('[DASHBOARD] Inicializando dashboard...');
    
    const stats = await loadDashboardStats();
    if (stats) {
      updateSummaryCards(stats);
    }
  }

  // Exponer API globalmente
  window.Dashboard = {
    loadDashboardStats,
    updateSummaryCards,
    calculateStats,
    initDashboard
  };

  console.log('[DASHBOARD CORE] Inicializado correctamente');
})();
