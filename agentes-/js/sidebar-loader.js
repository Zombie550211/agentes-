/**
 * Cargador de sidebar dinámico
 */

(function() {
  console.log('[SIDEBAR LOADER] Inicializando...');

  function loadSidebar() {
    const sidebarElement = document.querySelector('.sidebar');
    
    if (!sidebarElement) {
      console.warn('[SIDEBAR LOADER] No se encontró elemento .sidebar');
      return;
    }

    // Obtener información del usuario
    const user = window.getCurrentUser ? window.getCurrentUser() : null;
    const username = user?.username || user?.name || 'Usuario';
    const role = user?.role || 'Usuario';
    const team = user?.team || 'Sin equipo';
    
    // Obtener iniciales para el avatar
    const initials = username.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    
    // Obtener página activa
    const activePage = sidebarElement.getAttribute('data-active') || 'inicio';
    
    // Generar HTML del sidebar
    const sidebarHTML = `
      <!-- Información del Usuario -->
      <div class="user-info">
        <div class="avatar">
          <span class="user-avatar">${initials}</span>
        </div>
        <span class="user-name" id="user-name">${username}</span>
        <span class="user-role" id="user-role">${role}</span>
      </div>

      <!-- Estadísticas del Usuario -->
      <div class="user-stats">
        <div class="stat-item">
          <i class="fas fa-chart-line"></i>
          <div class="stat-content">
            <span class="stat-value" id="sidebar-user-sales">0</span>
            <span class="stat-label">Ventas</span>
          </div>
        </div>
        <div class="stat-item">
          <i class="fas fa-star"></i>
          <div class="stat-content">
            <span class="stat-value" id="sidebar-user-points">0</span>
            <span class="stat-label">Puntos</span>
          </div>
        </div>
        <div class="stat-item">
          <i class="fas fa-users"></i>
          <div class="stat-content">
            <span class="stat-value" id="sidebar-user-team">${team}</span>
            <span class="stat-label">Equipo</span>
          </div>
        </div>
      </div>

      <!-- Menú de Navegación -->
      <h3>Menú</h3>
      <ul>
        <li><a href="inicio.html" class="${activePage === 'inicio' ? 'active' : ''}"><i class="fas fa-home"></i> Inicio</a></li>
        <li><a href="lead.html" class="${activePage === 'lead' ? 'active' : ''}"><i class="fas fa-user-plus"></i> Nuevo Lead</a></li>
        <li><a href="Costumer.html" class="${activePage === 'costumer' ? 'active' : ''}"><i class="fas fa-users"></i> Clientes</a></li>
        <li><a href="Estadisticas.html" class="${activePage === 'estadisticas' ? 'active' : ''}"><i class="fas fa-chart-bar"></i> Estadísticas</a></li>
        <li><a href="Ranking y Promociones.html" class="${activePage === 'ranking' ? 'active' : ''}"><i class="fas fa-trophy"></i> Rankings</a></li>
        <li><a href="empleado-del-mes.html" class="${activePage === 'empleado' ? 'active' : ''}"><i class="fas fa-award"></i> Empleado del Mes</a></li>
        <li><a href="equipos.html" class="${activePage === 'equipos' ? 'active' : ''}"><i class="fas fa-users-cog"></i> Equipos</a></li>
        <li><a href="facturacion.html" class="${activePage === 'facturacion' ? 'active' : ''}"><i class="fas fa-file-invoice-dollar"></i> Facturación</a></li>
        <li id="menu-create-account" style="display: ${role.toLowerCase() === 'admin' || role.toLowerCase() === 'administrador' ? 'block' : 'none'};">
          <a href="register.html"><i class="fas fa-user-plus"></i> Crear Cuenta</a>
        </li>
        <li><a href="#" onclick="window.logout(); return false;" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Cerrar Sesión</a></li>
      </ul>
    `;
    
    sidebarElement.innerHTML = sidebarHTML;
    
    console.log('[SIDEBAR LOADER] Sidebar cargado correctamente');
    
    // Disparar evento personalizado
    document.dispatchEvent(new Event('sidebar:loaded'));
  }

  // Cargar sidebar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
  } else {
    loadSidebar();
  }

  // Exponer función globalmente
  window.loadSidebar = loadSidebar;

  console.log('[SIDEBAR LOADER] Inicializado correctamente');
})();
