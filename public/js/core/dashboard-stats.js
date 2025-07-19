/**
 * Módulo para manejar las estadísticas del dashboard
 * Incluye funciones para actualizar los contadores de clientes pendientes y ventas del día
 */

document.addEventListener('DOMContentLoaded', function() {
    // Cargar estadísticas cuando la página esté lista
    loadDashboardStats();
    
    // Actualizar estadísticas cada 5 minutos (300000 ms)
    setInterval(loadDashboardStats, 300000);
});

/**
 * Función para cargar las estadísticas del dashboard
 */
async function loadDashboardStats() {
    try {
        // Obtener el ID del usuario actual del localStorage
        const userId = localStorage.getItem('userId');
        if (!userId) {
            console.error('No se encontró el ID de usuario en el localStorage');
            return;
        }

        // Obtener la fecha actual en formato YYYY-MM-DD
        const today = new Date().toISOString().split('T')[0];
        
        // Obtener clientes pendientes
        const pendingResponse = await fetch(`/api/leads/count?status=PENDING,PENDIENTE`);
        if (!pendingResponse.ok) throw new Error('Error al cargar clientes pendientes');
        const pendingData = await pendingResponse.json();
        
        // Obtener ventas de hoy
        const salesResponse = await fetch(`/api/leads/count?fecha_venta=${today}`);
        if (!salesResponse.ok) throw new Error('Error al cargar ventas del día');
        const salesData = await salesResponse.json();
        
        // Actualizar la interfaz
        updateStatsUI({
            pending: pendingData.count || 0,
            salesToday: salesData.count || 0
        });
        
    } catch (error) {
        console.error('Error al cargar estadísticas:', error);
        // Mostrar mensaje de error en la interfaz
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.textContent = 'No se pudieron cargar las estadísticas. Intente recargar la página.';
        errorElement.style.color = '#e74c3c';
        errorElement.style.margin = '10px 0';
        document.querySelector('.stats-container').appendChild(errorElement);
    }
}

/**
 * Actualiza la interfaz de usuario con las estadísticas
 * @param {Object} stats - Objeto con las estadísticas a mostrar
 * @param {number} stats.pending - Número de clientes pendientes
 * @param {number} stats.salesToday - Número de ventas de hoy
 */
function updateStatsUI(stats) {
    const pendingElement = document.getElementById('pending-customers-count');
    const salesElement = document.getElementById('today-sales-count');
    
    if (pendingElement) {
        pendingElement.textContent = stats.pending;
        // Animación de conteo
        animateCount(pendingElement, parseInt(pendingElement.textContent), stats.pending);
    }
    
    if (salesElement) {
        salesElement.textContent = stats.salesToday;
        // Animación de conteo
        animateCount(salesElement, parseInt(salesElement.textContent), stats.salesToday);
    }
}

/**
 * Anima el conteo de un número a otro
 * @param {HTMLElement} element - Elemento que muestra el número
 * @param {number} start - Valor inicial
 * @param {number} end - Valor final
 * @param {number} duration - Duración de la animación en ms (opcional)
 */
function animateCount(element, start, end, duration = 1000) {
    const range = end - start;
    const minFrameTime = 50; // 50ms por frame para una animación suave
    const frames = Math.ceil(duration / minFrameTime);
    const increment = range / frames;
    let current = start;
    let frameCount = 0;
    
    const timer = setInterval(() => {
        frameCount++;
        current = frameCount === frames ? end : start + (increment * frameCount);
        element.textContent = Math.round(current);
        
        if (frameCount >= frames) {
            clearInterval(timer);
        }
    }, minFrameTime);
}

// Exportar funciones para uso en otros archivos
window.dashboardStats = {
    loadDashboardStats,
    updateStatsUI
};
