/**
 * Sidebar Loader - Carga dinámica del sidebar en todas las páginas
 */

(function() {
  'use strict';

  // Función principal para cargar el sidebar
  window.loadSidebar = async function(forceReload = false) {
    const sidebarElement = document.querySelector('.sidebar');
    if (!sidebarElement) {
      console.warn('No se encontró elemento .sidebar en la página');
      return;
    }

    try {
      // Obtener información del usuario
      const user = await getUserInfo();
      
      // Obtener página activa desde data-active
      const activePage = sidebarElement.getAttribute('data-active') || 'inicio';
      
      // Generar HTML del sidebar
      const sidebarHTML = generateSidebarHTML(user, activePage);
      
      // Insertar HTML
      sidebarElement.innerHTML = sidebarHTML;
      
      // Emitir evento de sidebar cargado
      document.dispatchEvent(new Event('sidebar:loaded'));
      
      console.log('✅ Sidebar cargado correctamente para rol:', user.role);
    } catch (error) {
      console.error('❌ Error cargando sidebar:', error);
      // Mostrar sidebar básico en caso de error
      sidebarElement.innerHTML = generateFallbackSidebar();
    }
  };

  // Obtener información del usuario desde localStorage o API
  async function getUserInfo() {
    try {
      // Intentar obtener del servidor usando cookies (método actual del sistema)
      const response = await fetch('/api/auth/verify-server', {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Error obteniendo información del usuario');
      }

      const data = await response.json();
      
      if (!data.authenticated || !data.user) {
        throw new Error('Usuario no autenticado');
      }
      
      const user = data.user;
      console.log('👤 Usuario cargado en sidebar:', user);
      return user;
    } catch (error) {
      console.error('Error obteniendo usuario:', error);
      // Retornar usuario por defecto
      const fallbackUser = {
        username: 'Usuario',
        role: 'agente',
        team: 'Sin equipo'
      };
      console.warn('⚠️ Usando usuario por defecto:', fallbackUser);
      return fallbackUser;
    }
  }

  // Generar HTML del sidebar
  function generateSidebarHTML(user, activePage) {
    const initials = getInitials(user.username || 'U');
    const roleName = getRoleName(user.role);
    
    // Determinar menú según rol
    const menuItems = getMenuItems(user.role, activePage);

    return `
      <!-- Usuario -->
      <div class="user-info">
        <div class="user-details">
          <div class="avatar">
            <span class="user-avatar">${initials}</span>
          </div>
          <span class="user-name" id="user-name">${user.username || 'Usuario'}</span>
          <span class="user-role" id="user-role">${roleName}</span>
        </div>
      </div>

      <!-- Estadísticas del usuario -->
      <div class="user-stats">
        <div class="stat-item">
          <i class="fas fa-shopping-cart"></i>
          <div class="stat-content">
            <span class="stat-value" id="sidebar-user-sales">0</span>
            <span class="stat-label">Ventas del mes</span>
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
            <span class="stat-value" id="sidebar-user-team">${user.team || 'Sin equipo'}</span>
            <span class="stat-label">Equipo</span>
          </div>
        </div>
      </div>

      <!-- Menú de navegación -->
      <h3>Navegación</h3>
      <ul class="menu">
        ${menuItems}
      </ul>

      <!-- Logout -->
      <ul class="menu">
        <li>
          <button type="button" class="btn btn-sidebar btn-logout" data-logout-button>
            <i class="fas fa-sign-out-alt"></i> Cerrar Sesión
          </button>
        </li>
      </ul>

      <!-- Frase motivacional -->
      <div class="sidebar-footer-quote">
        "El éxito es la suma de pequeños esfuerzos repetidos día tras día"
      </div>
    `;
  }

  // Obtener iniciales del nombre
  function getInitials(name) {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  // Obtener nombre del rol
  function getRoleName(role) {
    const roles = {
      'admin': 'Administrador',
      'supervisor': 'Supervisor',
      'agente': 'Agente',
      'agent': 'Agente',  // Soporte para inglés
      'backoffice': 'Back Office'
    };
    return roles[role] || 'Usuario';
  }

  // Obtener items del menú según rol
  function getMenuItems(role, activePage) {
    console.log('🔍 Generando menú para rol:', role);
    
    // Normalizar el rol (agent -> agente, etc.)
    const normalizedRole = normalizeRole(role);
    
    const allMenuItems = {
      inicio: { icon: 'fa-home', text: 'Inicio', href: 'inicio.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      lead: { icon: 'fa-user-plus', text: 'Nuevo Lead', href: 'lead.html', roles: ['admin', 'supervisor', 'agente'] },
      costumer: { icon: 'fa-users', text: 'Lista de Clientes', href: 'Costumer.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      ranking: { icon: 'fa-trophy', text: 'Ranking y Promociones', href: 'Ranking y Promociones.html', roles: ['admin', 'supervisor', 'agente'] },
      estadisticas: { icon: 'fa-chart-bar', text: 'Estadísticas', href: 'Estadisticas.html', roles: ['admin', 'supervisor'] },
      facturacion: { icon: 'fa-file-invoice-dollar', text: 'Facturación', href: 'facturacion.html', roles: ['admin', 'backoffice'] },
      empleado: { icon: 'fa-award', text: 'Empleado del Mes', href: 'empleado-del-mes.html', roles: ['admin'] },
      multimedia: { icon: 'fa-photo-video', text: 'Multimedia', href: 'multimedia.html', roles: ['admin'] },
      reglas: { icon: 'fa-book', text: 'Reglas y Puntajes', href: 'Reglas.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] }
    };

    let menuHTML = '';
    const visibleItems = [];
    
    for (const [key, item] of Object.entries(allMenuItems)) {
      // Verificar si el rol tiene acceso a este item (usar rol normalizado)
      if (item.roles.includes(normalizedRole)) {
        visibleItems.push(item.text);
        const isActive = key === activePage ? 'is-active' : '';
        menuHTML += `
          <li>
            <a href="${item.href}" class="btn btn-sidebar ${isActive}">
              <i class="fas ${item.icon}"></i> ${item.text}
            </a>
          </li>
        `;
      }
    }

    console.log('✅ Items visibles para este rol:', visibleItems);
    return menuHTML;
  }
  
  // Normalizar roles (inglés -> español)
  function normalizeRole(role) {
    const roleMap = {
      'agent': 'agente',
      'admin': 'admin',
      'supervisor': 'supervisor',
      'backoffice': 'backoffice'
    };
    return roleMap[role] || role;
  }

  // Generar sidebar de respaldo en caso de error
  function generateFallbackSidebar() {
    return `
      <div class="user-info">
        <div class="user-details">
          <div class="avatar">
            <span class="user-avatar">U</span>
          </div>
          <span class="user-name">Usuario</span>
          <span class="user-role">Cargando...</span>
        </div>
      </div>
      <h3>Navegación</h3>
      <ul class="menu">
        <li><a href="inicio.html" class="btn btn-sidebar"><i class="fas fa-home"></i> Inicio</a></li>
        <li><a href="#" class="btn btn-sidebar btn-logout" data-logout-button><i class="fas fa-sign-out-alt"></i> Cerrar Sesión</a></li>
      </ul>
    `;
  }

  // Cargar sidebar inmediatamente
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.loadSidebar);
  } else {
    window.loadSidebar();
  }

  // Recargar sidebar cuando el usuario se autentique (para actualizar el rol)
  document.addEventListener('user:authenticated', function(event) {
    console.log('🔄 Evento user:authenticated recibido, recargando sidebar...');
    setTimeout(() => {
      window.loadSidebar(true);
    }, 100);
  });

})();
