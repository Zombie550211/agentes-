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

    let loadedOk = false;
    try {
      // Obtener información del usuario
      const user = await getUserInfo();
      
      // Obtener página activa desde data-active
      const activePage = sidebarElement.getAttribute('data-active') || 'inicio';
      
      // Generar HTML del sidebar
      const sidebarHTML = generateSidebarHTML(user, activePage);
      
      // Insertar HTML
      sidebarElement.innerHTML = sidebarHTML;

      // Fallback post-render: si el primer <ul.menu> no tiene items, inyectar menú de agente
      try {
        const firstMenu = sidebarElement.querySelector('ul.menu');
        if (firstMenu && firstMenu.querySelectorAll('li').length === 0) {
          console.warn('⚠️ Sidebar sin items tras render. Inyectando menú de agente por fallback.');
          const items = [
            { icon:'fa-home', text:'Inicio', href:'\/inicio.html' },
            { icon:'fa-user-plus', text:'Nuevo Lead', href:'\/lead.html' },
            { icon:'fa-users', text:'Lista de Clientes', href:'\/Costumer.html' },
            { icon:'fa-trophy', text:'Ranking y Promociones', href:'\/Ranking y Promociones.html' },
            { icon:'fa-chart-bar', text:'Estadísticas', href:'\/Estadisticas.html' }
          ];
            firstMenu.innerHTML = items.map(it => `
              <li>
                <a href="${it.href}" class="btn btn-sidebar" title="${it.text}">
                  <i class="fas ${it.icon}"></i><span class="menu-label">${it.text}</span>
                </a>
              </li>
            `).join('');
          const roleSpan = sidebarElement.querySelector('#user-role');
          if (roleSpan) roleSpan.textContent = 'Agente';
        }
      } catch (e) {
        console.warn('Sidebar fallback post-render error:', e?.message);
      }
      
      // Emitir evento de sidebar cargado
      document.dispatchEvent(new Event('sidebar:loaded'));
      loadedOk = true;
      console.log('✅ Sidebar cargado correctamente para rol:', user.role);

      // Inicializar el interruptor de tema
      setupThemeSwitcher();
    } catch (error) {
      console.error('❌ Error cargando sidebar:', error);
      // Mostrar sidebar básico en caso de error
      sidebarElement.innerHTML = generateFallbackSidebar();
      // Emitir evento incluso en error para que otros listeners continúen
      try { document.dispatchEvent(new Event('sidebar:loaded')); } catch {}
    }

    // Configurar auto-ocultamiento del sidebar SIEMPRE (éxito o error)
    try {
      setupGlobalAutoHideSidebar();
      // Forzar estado inicial oculto
      document.body.classList.remove('show-sidebar');
    } catch (e) { console.warn('Auto-hide sidebar setup error:', e); }
  };

  // Obtener información del usuario desde localStorage o API
  async function getUserInfo() {
    try {
      // Primero intentar obtener usuario desde almacenamiento local (más rápido y evita llamadas cuando se abre como file://)
      try {
        const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.username || parsed.name || parsed.email)) {
            // normalizar propiedad username
            const userFromStorage = Object.assign({}, parsed);
            if (!userFromStorage.username) userFromStorage.username = userFromStorage.name || userFromStorage.email || 'Usuario';
            console.log('👤 Usuario cargado desde localStorage/sessionStorage para sidebar:', userFromStorage);
            return userFromStorage;
          }
        }
      } catch (e) {
        // ignore parse errors and continue to server probe
      }

      // Intentar obtener del servidor usando cookies (método actual del sistema)
      const response = await fetch('/api/auth/verify-server', {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        // Registrar en nivel warn para no llenar la consola en casos normales donde no hay sesión
        console.warn('Advertencia: respuesta no OK de /api/auth/verify-server:', response.status);
        throw new Error('No se pudo verificar sesión en servidor');
      }

      const data = await response.json();
      if (!data || !data.authenticated || !data.user) {
        console.warn('Usuario no autenticado en /api/auth/verify-server, usando fallback');
        throw new Error('Usuario no autenticado');
      }

      const user = data.user;
      console.log('👤 Usuario cargado en sidebar (servidor):', user);
      return user;
    } catch (error) {
      // No usar console.error para errores esperados (p. ej. sesión ausente). Mostrar warning y devolver fallback.
      console.warn('Error obteniendo usuario (se usará fallback):', (error && error.message) ? error.message : error);
      const fallbackUser = {
        username: 'Usuario',
        role: 'agente',
        team: 'Sin equipo'
      };
      return fallbackUser;
    }
  }

  // Generar HTML del sidebar
  function generateSidebarHTML(user, activePage) {
  const initials = getInitials(user.username || 'U');
  const normalizedRole = normalizeRole(user.role);
  const roleName = getRoleName(normalizedRole);
  // Detectar si el usuario pertenece a Team Líneas. Seguimos la misma lógica que el servidor (__isTeamLineas):
  // - team contiene 'lineas'
  // - role contiene 'teamlineas' o contiene 'lineas'
  // - username comienza con 'lineas-'
  const uname = String(user.username || '').toLowerCase();
  const urole = String(user.role || '').toLowerCase();
  const uteam = String(user.team || '').toLowerCase();
  const isLineas = /lineas/.test(uteam) || /teamlineas/.test(urole) || /lineas/.test(urole) || uname.startsWith('lineas-');
    
    // Determinar menú según rol
    const menuItems = getMenuItems(normalizedRole, activePage, { isLineas });

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
          <button type="button" class="btn btn-sidebar btn-logout" data-logout-button title="Cerrar Sesión">
            <i class="fas fa-sign-out-alt"></i><span class="menu-label">Cerrar Sesión</span>
          </button>
        </li>
      </ul>

      <!-- Frase motivacional -->
      <!-- Interruptor de Tema -->
      <div class="theme-switcher-container">
        <button type="button" class="btn btn-sidebar theme-switcher" id="theme-switcher-btn" title="Cambiar tema">
          <i class="fas fa-sun"></i>
          <span class="menu-label">Cambiar Tema</span>
        </button>
      </div>

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
  function getMenuItems(role, activePage, ctx = {}) {
    const normalizedRole = normalizeRole(role);
    console.log('🔍 Generando menú para rol bruto/normalizado:', role, '->', normalizedRole);
    
    const allMenuItems = {
      // Use absolute path for Inicio to avoid resolving under subfolders like TEAM LINEAS/
      inicio: { icon: 'fa-home', text: 'Inicio', href: '/inicio.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      lead: { icon: 'fa-user-plus', text: 'Nuevo Lead', href: 'lead.html', roles: ['admin', 'supervisor', 'agente'] },
      costumer: { icon: 'fa-users', text: 'Lista de Clientes', href: 'Costumer.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      ranking: { icon: 'fa-trophy', text: 'Ranking y Promociones', href: 'Ranking y Promociones.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      estadisticas: { icon: 'fa-chart-bar', text: 'Estadísticas', href: 'Estadisticas.html', roles: ['admin', 'supervisor', 'agente'] },
      facturacion: { icon: 'fa-file-invoice-dollar', text: 'Facturación', href: 'facturacion.html', roles: ['admin', 'backoffice'] },
      empleado: { icon: 'fa-award', text: 'Empleado del Mes', href: 'empleado-del-mes.html', roles: ['admin'] },
      multimedia: { icon: 'fa-photo-video', text: 'Multimedia', href: 'multimedia.html', roles: ['admin'] },
      reglas: { icon: 'fa-book', text: 'Reglas y Puntajes', href: 'Reglas.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      crearcuenta: { icon: 'fa-user-plus', text: 'Crear Cuenta', href: 'crear-cuenta.html', roles: ['admin'] }
    };

    // Redirigir a páginas específicas de Team Líneas si corresponde
    if (ctx && ctx.isLineas) {
      // Mantener Inicio general
      allMenuItems.lead.href = '/TEAM LINEAS/LEAD-LINEAS.html';
      allMenuItems.costumer.href = '/TEAM LINEAS/COSTUMER-LINEAS.html';
      allMenuItems.ranking.href = '/TEAM LINEAS/RANKING-LINEAS.html';
      allMenuItems.estadisticas.href = '../Estadisticas.html';
    }

    let menuHTML = '';
    const visibleItems = [];
    
    for (const [key, item] of Object.entries(allMenuItems)) {
      // Verificar si el rol tiene acceso a este item (usar rol normalizado)
      if (item.roles.includes(normalizedRole)) {
        visibleItems.push(item.text);
        const isActive = key === activePage ? 'is-active' : '';
        menuHTML += `
          <li>
            <a href="${item.href}" class="btn btn-sidebar ${isActive}" title="${item.text}">
              <i class="fas ${item.icon}"></i><span class="menu-label">${item.text}</span>
            </a>
          </li>
        `;
      }
    }

    // Fallback de seguridad: si no hay items visibles, tratar como 'agente'
    if (visibleItems.length === 0) {
      console.warn('⚠️ Ningún item visible para rol:', normalizedRole, '— aplicando fallback AGENTE');
      const agentKeys = ['inicio','lead','costumer','ranking','estadisticas'];
      for (const key of agentKeys) {
        const item = allMenuItems[key];
        const isActive = key === activePage ? 'is-active' : '';
        menuHTML += `
          <li>
            <a href="${item.href}" class="btn btn-sidebar ${isActive}">
              <i class="fas ${item.icon}"></i><span class="menu-label">${item.text}</span>
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
    const r = (role == null ? '' : String(role)).trim().toLowerCase();
    if (!r) return 'agente';
    // equivalentes de agente
    if (['agente','agent','agents','agentes','usuario','user','seller','vendedor','sales'].includes(r)) return 'agente';
    // equivalentes de supervisor
    if (['supervisor','supervisora','supervisores'].includes(r)) return 'supervisor';
    // equivalentes de admin
    if (['admin','administrator','administrador','administradora'].includes(r)) return 'admin';
    // equivalentes de backoffice
    if (['backoffice','back office','back_office','bo'].includes(r)) return 'backoffice';
    return r;
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
        <li><a href="/inicio.html" class="btn btn-sidebar"><i class="fas fa-home"></i><span class="menu-label">Inicio</span></a></li>
        <li><a href="#" class="btn btn-sidebar btn-logout" data-logout-button><i class="fas fa-sign-out-alt"></i><span class="menu-label">Cerrar Sesión</span></a></li>
      </ul>
    `;
  }

  // ===== Auto-hide Sidebar (GLOBAL) =====
  function setupGlobalAutoHideSidebar() {
    const DOC = document;
    const BODY = DOC.body;
    const sidebar = DOC.querySelector('.sidebar');
    if (!sidebar || !BODY) return;

    // Inyectar CSS una sola vez
    const STYLE_ID = 'global-auto-hide-sidebar-styles';
    if (!DOC.getElementById(STYLE_ID)) {
      const css = `
          :root { --sidebar-width: 260px; --sidebar-collapsed: 72px; --sidebar-peek: 12px; }
          /* Base sidebar positioning */
          .sidebar { position: fixed !important; left: 0 !important; top: 0 !important; width: var(--sidebar-width) !important; height: 100vh !important; backface-visibility: hidden; transform: translate3d(0,0,0) !important; will-change: width, transform; z-index: 140 !important; transition: width .14s ease; overflow: hidden; }

          /* ICON-ONLY collapsed mode: reduce width and hide labels */
          body.auto-hide-sidebar .sidebar { width: var(--sidebar-collapsed) !important; }
          body.auto-hide-sidebar .sidebar .menu-label,
          body.auto-hide-sidebar .sidebar .user-name,
          body.auto-hide-sidebar .sidebar .user-role,
          body.auto-hide-sidebar .sidebar .stat-label,
          body.auto-hide-sidebar .sidebar .stat-content { display: none !important; }

          /* Center icons when collapsed */
          body.auto-hide-sidebar .sidebar a { justify-content: center !important; padding-left: 0 !important; padding-right: 0 !important; }
          body.auto-hide-sidebar .sidebar a i { margin-right: 0 !important; font-size: 1.15rem; }
          body.auto-hide-sidebar .sidebar .avatar { width: 44px; height: 44px; margin: 12px auto; }
          /* Prevent hover padding shift when collapsed */
          body.auto-hide-sidebar .sidebar a:hover { padding-left: 0 !important; padding-right: 0 !important; border-left-color: transparent !important; }

          /* When showing (hover), expand to full width and reveal labels */
          body.auto-hide-sidebar.show-sidebar .sidebar { width: var(--sidebar-width) !important; }
          /* Reveal all user/header/menu sections when expanded */
          body.auto-hide-sidebar.show-sidebar .sidebar .menu-label,
          body.auto-hide-sidebar.show-sidebar .sidebar .user-name,
          body.auto-hide-sidebar.show-sidebar .sidebar .user-role,
          body.auto-hide-sidebar.show-sidebar .sidebar .stat-label,
          body.auto-hide-sidebar.show-sidebar .sidebar .stat-content,
          body.auto-hide-sidebar.show-sidebar .sidebar .user-details,
          body.auto-hide-sidebar.show-sidebar .sidebar .user-info,
          body.auto-hide-sidebar.show-sidebar .sidebar .avatar,
          body.auto-hide-sidebar.show-sidebar .sidebar .user-stats,
          body.auto-hide-sidebar.show-sidebar .sidebar h3,
          body.auto-hide-sidebar.show-sidebar .sidebar .sidebar-footer-quote { display: block !important; }

          /* Adjust main content margin to the collapsed width to avoid layout jump */
          .main-content { margin-left: calc(var(--sidebar-collapsed) + 16px) !important; transition: margin-left .14s ease; }

          /* Hover zone to trigger expansion */
          .sidebar-hover-zone { position: fixed !important; left: 0 !important; top: 0 !important; width: calc(var(--sidebar-collapsed) + var(--sidebar-peek)) !important; height: 100vh !important; z-index: 150 !important; pointer-events: auto; }

          @media (max-width: 900px) { body.auto-hide-sidebar .sidebar { width: var(--sidebar-width) !important; } .sidebar-hover-zone { display: none !important; } }
          @media (prefers-reduced-motion: reduce) { body.auto-hide-sidebar .sidebar, .main-content { transition: none !important; } }
        `;
      const styleEl = DOC.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = css;
      DOC.head.appendChild(styleEl);
    }

    // Crear zona de hover si no existe
    let zone = DOC.querySelector('.sidebar-hover-zone');
    if (!zone) {
      zone = DOC.createElement('div');
      zone.className = 'sidebar-hover-zone';
      DOC.body.appendChild(zone);
    }

    // Activar modo auto-hide globalmente
    BODY.classList.add('auto-hide-sidebar');

    // Mostrar/Ocultar con un pequeño debounce para fluidez
    let hideTO = null;
    const show = () => { cancelAnimationFrame(hideTO); BODY.classList.add('show-sidebar'); };
    const scheduleHide = () => { hideTO = requestAnimationFrame(() => BODY.classList.remove('show-sidebar')); };

    zone.addEventListener('mouseenter', show, { passive: true });
    zone.addEventListener('mouseleave', scheduleHide, { passive: true });
    sidebar.addEventListener('mouseenter', show, { passive: true });
    sidebar.addEventListener('mouseleave', scheduleHide, { passive: true });
    
      /* Strong overrides to disable translateX slide-off variants used in some pages
         and force icon-only width. This complements the rules above and ensures
         consistency even when page-specific CSS uses translateX or !important. */
      let css = `
        /* Force icon-only and cancel translate-based hiding */
        html body.auto-hide-sidebar .sidebar,
        html body.auto-hide-sidebar .sidebar.sidebar-inicio {
          transform: none !important;
          -webkit-transform: none !important;
          left: 0 !important;
          width: var(--sidebar-collapsed) !important;
          min-width: var(--sidebar-collapsed) !important;
          overflow: hidden !important;
          visibility: visible !important;
        }

        /* Ensure show-sidebar expands to full width */
        html body.auto-hide-sidebar.show-sidebar .sidebar,
        html body.auto-hide-sidebar.show-sidebar .sidebar.sidebar-inicio {
          transform: none !important;
          width: var(--sidebar-width) !important;
          min-width: var(--sidebar-width) !important;
        }

        /* Keep main content margin in sync */
        html body.auto-hide-sidebar .main-content { margin-left: calc(var(--sidebar-collapsed) + 12px) !important; }

        /* Make hover zone reliable */
        .sidebar-hover-zone { width: calc(var(--sidebar-collapsed) + 6px) !important; }

        /* Strong layout enforcement for menu links when expanded - highest specificity */
        html body.auto-hide-sidebar.show-sidebar .sidebar .btn-sidebar {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          gap: 12px !important;
          flex-wrap: nowrap !important;
          justify-content: flex-start !important;
          padding-left: 20px !important;
          padding-right: 20px !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        html body.auto-hide-sidebar.show-sidebar .sidebar .btn-sidebar i {
          flex: 0 0 20px !important;
          width: 20px !important;
          margin-right: 12px !important;
          text-align: center !important;
          font-size: 1.05rem !important;
        }
        html body.auto-hide-sidebar.show-sidebar .sidebar .btn-sidebar .menu-label {
          white-space: nowrap !important;
          display: inline-block !important;
        }

        /* When collapsed: keep icons centered */
        html body.auto-hide-sidebar .sidebar .btn-sidebar {
          justify-content: center !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }

        /* Hide active pill when collapsed (no blue blob) */
        html body.auto-hide-sidebar:not(.show-sidebar) .sidebar .btn-sidebar.is-active,
        html body.auto-hide-sidebar .sidebar:not(.show-sidebar) .btn-sidebar.is-active {
          background: transparent !important;
          color: inherit !important;
          border-radius: 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          box-shadow: none !important;
        }
      `;
      // If the primary style element exists, append overrides there; otherwise create a dedicated overrides style.
      try {
        const primary = DOC.getElementById(STYLE_ID);
        if (primary) {
          primary.textContent = (primary.textContent || '') + css;
        } else {
          const extra = DOC.createElement('style');
          extra.id = STYLE_ID + '-overrides';
          extra.textContent = css;
          DOC.head.appendChild(extra);
        }
      } catch (e) {
        // best-effort: create a new style tag if anything goes wrong
        try { const extra2 = DOC.createElement('style'); extra2.id = STYLE_ID + '-overrides-fallback'; extra2.textContent = css; DOC.head.appendChild(extra2); } catch(_){}
      }
  }

  // Función para configurar el interruptor de tema
  function setupThemeSwitcher() {
    const themeSwitcherBtn = document.getElementById('theme-switcher-btn');
    if (!themeSwitcherBtn) return;

    const body = document.body;
    const icon = themeSwitcherBtn.querySelector('i');

    // Función para aplicar el tema
    const applyTheme = (theme) => {
      if (theme === 'dark') {
        body.classList.add('dark-theme');
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
      } else {
        body.classList.remove('dark-theme');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      }
    };

    // Cargar el tema guardado al iniciar
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

    // Evento de clic para cambiar el tema
    themeSwitcherBtn.addEventListener('click', () => {
      const isDark = body.classList.contains('dark-theme');
      const newTheme = isDark ? 'light' : 'dark';
      localStorage.setItem('theme', newTheme);
      applyTheme(newTheme);
    });
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
