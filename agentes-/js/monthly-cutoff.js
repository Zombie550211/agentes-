/**
 * Sistema de corte mensual
 * Gestiona el cierre de mes y estadísticas mensuales
 */

(function() {
  console.log('[MONTHLY CUTOFF] Inicializando...');

  // Obtener el primer y último día del mes actual
  function getCurrentMonthRange() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    return {
      start: firstDay,
      end: lastDay,
      month: now.getMonth() + 1,
      year: now.getFullYear()
    };
  }

  // Verificar si una fecha está en el mes actual
  function isCurrentMonth(date) {
    if (!date) return false;
    
    const d = new Date(date);
    const now = new Date();
    
    return d.getMonth() === now.getMonth() && 
           d.getFullYear() === now.getFullYear();
  }

  // Verificar si una fecha es hoy
  function isToday(date) {
    if (!date) return false;
    
    const d = new Date(date);
    const today = new Date();
    
    return d.getDate() === today.getDate() &&
           d.getMonth() === today.getMonth() &&
           d.getFullYear() === today.getFullYear();
  }

  // Formatear fecha
  function formatDate(date) {
    if (!date) return '';
    
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    return `${day}/${month}/${year}`;
  }

  // Obtener nombre del mes
  function getMonthName(monthNumber) {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    
    return months[monthNumber - 1] || '';
  }

  // Calcular días restantes del mes
  function getDaysRemainingInMonth() {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    return lastDay.getDate() - now.getDate();
  }

  // Exponer funciones globalmente
  window.MonthlyCutoff = {
    getCurrentMonthRange,
    isCurrentMonth,
    isToday,
    formatDate,
    getMonthName,
    getDaysRemainingInMonth
  };

  console.log('[MONTHLY CUTOFF] Inicializado correctamente');
  console.log('[MONTHLY CUTOFF] Mes actual:', getMonthName(new Date().getMonth() + 1));
  console.log('[MONTHLY CUTOFF] Días restantes:', getDaysRemainingInMonth());
})();
