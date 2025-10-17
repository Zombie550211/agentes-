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

    // Obtener información del usuario (con fallback a storage)
    function getUserFromStorage(){
      try{
        const s = sessionStorage.getItem('user') || localStorage.getItem('user') || '{}';
        return JSON.parse(s);
      }catch(e){ return null; }
    }
    const user = (typeof window.getCurrentUser === 'function' && window.getCurrentUser()) || getUserFromStorage() || null;
    const username = user?.username || user?.name || 'Usuario';
    const role = user?.role || 'Usuario';
    // Detectar Team Líneas (rol o prefijo de username)
    const toLower = (s)=>String(s||'').toLowerCase();
    const isTeamLineas = toLower(role)==='teamlineas' || toLower(username).startsWith('lineas-');
    const isAdmin = (toLower(role) === 'admin' || toLower(role) === 'administrador');
    const team = user?.team || 'Sin equipo';
    
    // Obtener iniciales para el avatar
    const initials = username.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    
    // Obtener página activa
    const activePage = sidebarElement.getAttribute('data-active') || 'inicio';
    
    // Precompute HREFs según el rol (Team Líneas vs normal)
    // Política: solo Lead cambia para Team Líneas; el resto usa páginas base
    const homeHref = '/inicio.html';
    const leadHref = isTeamLineas ? '/TEAM LINEAS/LEAD-LINEAS.html' : '/lead.html';
    const costumerHref = '/Costumer.html';
    const statsHref = '/Estadisticas.html';
    const rankingHref = '/Ranking y Promociones.html';
    const empleadoHref = '/empleado-del-mes.html';
    const reglasHref = '/Reglas.html';

    // Generar HTML del sidebar (stats deshabilitados globalmente)
    const showStats = false;
    const sidebarHTML = `
      <!-- Información del Usuario -->
      <div class="user-info">
        <div class="avatar">
          <span class="user-avatar">${initials}</span>
        </div>
        <span class="user-name" id="user-name">${username}</span>
        <span class="user-role" id="user-role">${role}</span>
      </div>

      ${showStats ? `
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
      </div>` : ''}

      <!-- Menú de Navegación -->
      <h3>Menú</h3>
      <ul class="menu">
        <li><a href="${homeHref}" class="btn btn-sidebar ${activePage === 'inicio' ? 'is-active' : ''}"><i class="fas fa-home"></i> Inicio</a></li>
        <li><a href="${leadHref}" class="btn btn-sidebar ${activePage === 'lead' ? 'is-active' : ''}"><i class="fas fa-user-plus"></i> Nuevo Lead</a></li>
        <li><a href="${costumerHref}" class="btn btn-sidebar ${activePage === 'costumer' ? 'is-active' : ''}"><i class="fas fa-users"></i> Clientes</a></li>
        <li><a href="${statsHref}" class="btn btn-sidebar ${activePage === 'estadisticas' ? 'is-active' : ''}"><i class="fas fa-chart-bar"></i> Estadísticas</a></li>
        <li><a href="${rankingHref}" class="btn btn-sidebar ${activePage === 'ranking' ? 'is-active' : ''}"><i class="fas fa-trophy"></i> Rankings</a></li>
        <li><a href="${empleadoHref}" class="btn btn-sidebar ${activePage === 'empleado' ? 'is-active' : ''}"><i class="fas fa-award"></i> Empleado del Mes</a></li>
        <li><a href="${reglasHref}" class="btn btn-sidebar ${activePage === 'reglas' ? 'is-active' : ''}"><i class="fas fa-clipboard-list"></i> Reglas</a></li>
        <li style="display: ${isAdmin ? 'block' : 'none'};"><a href="/facturacion.html" class="btn btn-sidebar ${activePage === 'facturacion' ? 'is-active' : ''}"><i class="fas fa-file-invoice-dollar"></i> Facturación</a></li>
        <li id="menu-create-account" style="display: ${role.toLowerCase() === 'admin' || role.toLowerCase() === 'administrador' ? 'block' : 'none'};">
          <a href="/register.html" class="btn btn-sidebar ${activePage === 'register' ? 'is-active' : ''}"><i class="fas fa-user-plus"></i> Crear Cuenta</a>
        </li>
        <li><a href="#" onclick="window.logout(); return false;" class="btn btn-sidebar btn-logout"><i class="fas fa-sign-out-alt"></i> Cerrar Sesión</a></li>
      </ul>
    `;
    
    sidebarElement.innerHTML = sidebarHTML;

    // Asegurar que el menú sea visible
    const menuEl = sidebarElement.querySelector('ul.menu');
    if (menuEl) {
      menuEl.style.display = 'block';
      menuEl.style.visibility = 'visible';
      menuEl.style.overflow = 'visible';
      menuEl.style.maxWidth = '100%';
      menuEl.style.width = '100%';
      const links = menuEl.querySelectorAll('a');
      links.forEach(a => { a.style.width = '100%'; a.style.boxSizing = 'border-box'; });
      console.log('[SIDEBAR LOADER] Items de menú:', menuEl.querySelectorAll('li').length);
    }

    // Mostrar el sidebar en desktop, ocultar en móvil
    function applySidebarResponsive(){
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        sidebarElement.classList.remove('active');
      } else {
        sidebarElement.classList.add('active');
      }
      // Forzar visibilidad/estilos mínimos para evitar que quede oculto por transform/opacity
      sidebarElement.style.display = 'flex';
      sidebarElement.style.visibility = 'visible';
      sidebarElement.style.opacity = '1';
      sidebarElement.style.transform = sidebarElement.classList.contains('active') ? 'translateX(0)' : '';

      // Ajustar margen del contenido principal
      const main = document.querySelector('.main-content');
      if (main) {
        main.style.marginLeft = sidebarElement.classList.contains('active') ? '260px' : '0px';
        main.style.overflowX = 'hidden';
      }
    }
    applySidebarResponsive();
    window.addEventListener('resize', applySidebarResponsive);

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
