/**
 * Sidebar Loader - Carga dinámica del sidebar en todas las páginas
 */

(function() {
  'use strict';

  const ACTIVE_ALIASES = {
    '': 'inicio',
    'inicio': 'inicio',
    'home': 'inicio',
    'dashboard': 'inicio',
    'lead': 'lead',
    'leads': 'lead',
    'nuevo-lead': 'lead',
    'costumer': 'costumer',
    'clientes': 'costumer',
    'ranking': 'ranking',
    'promociones': 'ranking',
    'estadisticas': 'estadisticas',
    'estadísticas': 'estadisticas',
    'stats': 'estadisticas',
    'facturacion': 'facturacion',
    'facturación': 'facturacion',
    'empleado': 'empleado',
    'multimedia': 'multimedia',
    'reglas': 'reglas',
    'tabla': 'tabla-puntaje',
    'tabla-puntaje': 'tabla-puntaje',
    'tabla_de_puntaje': 'tabla-puntaje',
    'tabla-de-puntaje': 'tabla-puntaje',
    'puntaje': 'tabla-puntaje',
    'tabla puntaje': 'tabla-puntaje',
    'crearcuenta': 'crearcuenta',
    'crear-cuenta': 'crearcuenta',
    'register': 'crearcuenta',
    'registro': 'crearcuenta'
  };

  const AVATAR_FIELD_CANDIDATES = [
    'avatarUrl','avatar','photoUrl','photo','profilePhoto','profileImage','picture','imageUrl','image','foto','imagen','avatarURL'
  ];
  const LOCAL_AVATAR_STORE_KEY = 'sidebarUserPhotos';
  const MAX_AVATAR_BYTES = 4 * 1024 * 1024; // 4 MB
  const AVATAR_UPLOAD_ENDPOINT = '/api/users/me/avatar';
  const AVATAR_DELETE_ENDPOINT = '/api/users/me/avatar';
  const SERVER_AVATAR_FETCH_PREFIX = '/api/user-avatars/';
  let __avatarFileInput = null;
  let __avatarCurrentTarget = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  // Construye un href seguro: normaliza a ruta absoluta y codifica cada segmento una sola vez.
  function safeHref(hrefRaw) {
    try {
      if (!hrefRaw) return '';
      let s = String(hrefRaw || '');
      // eliminar prefijo relativo accidental
      if (s.startsWith('http://') || s.startsWith('https://')) return s;
      if (s.startsWith('/')) s = s.slice(1);
      // dividir por '/' y encodar cada segmento evitando doble-encode
      const parts = s.split('/').map(p => encodeURIComponent(decodeURIComponent(String(p))));
      return '/' + parts.join('/');
    } catch (e) {
      try { return '/' + encodeURIComponent(String(hrefRaw)); } catch (_) { return String(hrefRaw); }
    }
  }

  function sanitizeAvatarUrl(rawUrl) {
    const url = (rawUrl == null ? '' : String(rawUrl)).trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/\//.test(url)) {
      try { return `${window.location.protocol}${url}`; } catch (_) { return `https:${url}`; }
    }
    if (/^\/?uploads\//i.test(url)) return url.startsWith('/') ? url : `/${url}`;
    if (/^data:image\//i.test(url)) return url;
    if (/^(\.\.\/|\.\/)/.test(url)) return url;
    if (url.startsWith('/')) return url;
    return '';
  }

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch(_) { return fallback; }
  }

  function getUsernameKey(user) {
    const uname = (user && user.username) ? String(user.username).trim() : '';
    if (uname) return uname.toLowerCase();
    const email = (user && user.email) ? String(user.email).trim() : '';
    if (email) return email.toLowerCase();
    return null;
  }

  function readAvatarStore() {
    try {
      const raw = localStorage.getItem(LOCAL_AVATAR_STORE_KEY);
      const parsed = safeJsonParse(raw, {});
      if (parsed && typeof parsed === 'object') return parsed;
    } catch(_){}
    return {};
  }

  function writeAvatarStore(map) {
    try { localStorage.setItem(LOCAL_AVATAR_STORE_KEY, JSON.stringify(map)); } catch(_){}
  }

  function getStoredAvatar(user) {
    const key = getUsernameKey(user);
    if (!key) return '';
    const store = readAvatarStore();
    const entry = store[key];
    if (typeof entry === 'string' && entry.startsWith('data:image/')) return entry;
    return '';
  }

  function setStoredAvatar(user, dataUrl) {
    const key = getUsernameKey(user);
    if (!key) return;
    const store = readAvatarStore();
    store[key] = dataUrl;
    writeAvatarStore(store);
  }

  function clearStoredAvatar(user) {
    const key = getUsernameKey(user);
    if (!key) return;
    const store = readAvatarStore();
    if (key in store) {
      delete store[key];
      writeAvatarStore(store);
    }
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(file);
    });
  }

  function normalizeActiveKey(rawKey) {
    const raw = (rawKey == null ? '' : String(rawKey)).trim().toLowerCase();
    if (ACTIVE_ALIASES[raw] !== undefined) return ACTIVE_ALIASES[raw];
    return raw || 'inicio';
  }

  function guessActivePage() {
    try {
      const byBody = document.body?.getAttribute('data-active') || document.body?.dataset?.active;
      if (byBody) return normalizeActiveKey(byBody);

      if (window.__sidebarActive) return normalizeActiveKey(window.__sidebarActive);
      if (window.__SIDEBAR_ACTIVE) return normalizeActiveKey(window.__SIDEBAR_ACTIVE);

      const path = decodeURIComponent(window.location?.pathname || '').toLowerCase();
      if (/estadistic/.test(path)) return 'estadisticas';
      if (/factur/.test(path)) return 'facturacion';
      if (/rank/.test(path)) return 'ranking';
      if (/tabla/.test(path) && /puntaje/.test(path)) return 'tabla-puntaje';
      if (/empleado/.test(path)) return 'empleado';
      if (/multimedia/.test(path)) return 'multimedia';
      if (/regla/.test(path)) return 'reglas';
      if (/costumer/.test(path) || /cliente/.test(path)) return 'costumer';
      if (/lead/.test(path)) return 'lead';
      if (/crear/.test(path) && /cuenta/.test(path)) return 'crearcuenta';
      if (/register/.test(path)) return 'crearcuenta';
      if (/reset-password/.test(path)) return 'inicio';
      if (/inicio/.test(path) || /index\.html?$/.test(path)) return 'inicio';
    } catch (e) {
      console.warn('No se pudo inferir data-active automáticamente', e);
    }
    return 'inicio';
  }

  function ensureSidebarElement() {
    let sidebarElement = document.querySelector('.sidebar');
    if (sidebarElement) return sidebarElement;

    const inferredActive = guessActivePage();
    sidebarElement = document.createElement('nav');
    sidebarElement.className = 'sidebar sidebar-inicio';
    sidebarElement.setAttribute('data-active', inferredActive);

    const layout = document.querySelector('.layout');
    if (layout) {
      layout.insertBefore(sidebarElement, layout.firstElementChild || null);
    } else {
      document.body.insertBefore(sidebarElement, document.body.firstChild || null);
    }
    console.warn('Se creó dinámicamente el contenedor .sidebar; considera agregarlo al HTML para mayor control.');
    return sidebarElement;
  }

  // Función principal para cargar el sidebar
  window.loadSidebar = async function(forceReload = false) {
    const sidebarElement = ensureSidebarElement();

    let loadedOk = false;
    try {
      // Obtener información del usuario
      const user = await getUserInfo();
      
      // Obtener página activa desde data-active
      const rawActive = sidebarElement.getAttribute('data-active');
      const activePage = normalizeActiveKey(rawActive || guessActivePage());
      sidebarElement.setAttribute('data-active', activePage);
      
      // Generar HTML del sidebar
      const sidebarHTML = generateSidebarHTML(user, activePage);
      
      // Insertar HTML
      sidebarElement.innerHTML = sidebarHTML;
      initializeSidebarAvatars(sidebarElement);

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
                <a href="${safeHref(it.href)}" class="btn btn-sidebar" title="${it.text}">
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
      initializeSidebarAvatars(sidebarElement);
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
  const displayName = getDisplayName(user);
  const initials = getInitials(displayName || 'U');
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

    const avatarInfo = resolveAvatar(user);
    const avatarUrl = avatarInfo.url;
    const avatarSource = avatarInfo.source;
    const profileAvatar = avatarInfo.profile || '';
    const serverAvatar = avatarInfo.server || '';
    const avatarFileId = avatarInfo.fileId || '';
    const photoState = avatarUrl ? 'loading' : 'fallback';
    const avatarClasses = ['avatar'];
    if (avatarUrl) avatarClasses.push('has-photo');
    const usernameKey = escapeAttribute(getUsernameKey(user) || '');
    const avatarHtml = `
      <div class="${avatarClasses.join(' ')}" data-photo-state="${photoState}" data-avatar-source="${escapeAttribute(avatarSource || '')}" data-avatar-username="${usernameKey}" data-profile-avatar="${escapeAttribute(profileAvatar)}" data-server-avatar="${escapeAttribute(serverAvatar)}" data-avatar-file-id="${escapeAttribute(avatarFileId)}">
        ${avatarUrl ? `<img src="${escapeAttribute(avatarUrl)}" alt="Foto de ${escapeAttribute(displayName)}" class="user-avatar-img" loading="lazy" decoding="async" data-avatar-img>` : ''}
        <span class="user-avatar">${escapeHtml(initials)}</span>
      </div>
    `;
    const avatarWrapper = `
      <div class="avatar-wrapper" data-avatar-wrapper data-has-local="${avatarSource === 'local' ? 'true' : 'false'}" data-has-profile="${profileAvatar ? 'true' : 'false'}" data-has-server="${serverAvatar ? 'true' : 'false'}">
        ${avatarHtml}
        <button type="button" class="avatar-edit-btn" data-avatar-trigger title="Actualizar foto">
          <i class="fas fa-camera"></i><span class="sr-only">Actualizar foto</span>
        </button>
        <button type="button" class="avatar-remove-btn" data-avatar-clear title="Eliminar foto guardada">
          <i class="fas fa-trash"></i><span class="sr-only">Eliminar foto</span>
        </button>
      </div>
    `;
    
    // Determinar menú según rol
    const menuItems = getMenuItems(normalizedRole, normalizeActiveKey(activePage), { isLineas });

    return `
      <!-- Usuario -->
      <div class="user-info">
        <div class="user-details">
          ${avatarWrapper}
          <span class="user-name" id="user-name">${escapeHtml(displayName)}</span>
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
            <span class="stat-value" id="sidebar-user-team">${escapeHtml(user.team || 'Sin equipo')}</span>
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

  function getDisplayName(user) {
    const candidates = [user?.fullName, user?.name, user?.displayName, user?.username, user?.email];
    for (const candidate of candidates) {
      const value = (candidate == null ? '' : String(candidate)).trim();
      if (value) return value;
    }
    return 'Usuario';
  }

  function extractAvatarFromUser(user, options = {}) {
    if (!user || typeof user !== 'object') return '';
    const excludes = Array.isArray(options.excludeKeys) ? options.excludeKeys.map(k => String(k).toLowerCase()) : [];
    for (const field of AVATAR_FIELD_CANDIDATES) {
      if (excludes.includes(String(field).toLowerCase())) continue;
      if (field in user) {
        const sanitized = sanitizeAvatarUrl(user[field]);
        if (sanitized) return sanitized;
      }
    }
    if (user?.profile && typeof user.profile === 'object') {
      const nested = sanitizeAvatarUrl(user.profile.avatar || user.profile.photo || user.profile.image);
      if (nested) return nested;
    }
    return '';
  }

  function resolveAvatar(user) {
    const server = sanitizeAvatarUrl(user?.avatarUrl || (user?.avatarFileId ? `${SERVER_AVATAR_FETCH_PREFIX}${user.avatarFileId}` : ''));
    const profile = extractAvatarFromUser(user, { excludeKeys: ['avatarUrl'] });
    const stored = getStoredAvatar(user);
    if (server) return { url: server, source: 'server', profile, stored, server, fileId: user?.avatarFileId || '' };
    if (stored) return { url: stored, source: 'local', profile, stored, server, fileId: user?.avatarFileId || '' };
    if (profile) return { url: profile, source: 'profile', profile, stored, server, fileId: user?.avatarFileId || '' };
    return { url: '', source: '', profile: profile || '', stored, server, fileId: user?.avatarFileId || '' };
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
    const normalizedActive = normalizeActiveKey(activePage);
    
    const allMenuItems = {
      // Use absolute path for Inicio to avoid resolving under subfolders like TEAM LINEAS/
      inicio: { icon: 'fa-home', text: 'Inicio', href: '/inicio.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      lead: { icon: 'fa-user-plus', text: 'Nuevo Lead', href: 'lead.html', roles: ['admin', 'supervisor', 'agente'] },
      costumer: { icon: 'fa-users', text: 'Lista de Clientes', href: 'Costumer.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      ranking: { icon: 'fa-trophy', text: 'Ranking y Promociones', href: 'Ranking y Promociones.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      estadisticas: { icon: 'fa-chart-bar', text: 'Estadísticas', href: 'Estadisticas.html', roles: ['admin', 'supervisor', 'agente'] },
      facturacion: { icon: 'fa-file-invoice-dollar', text: 'Facturación', href: 'facturacion.html', roles: ['admin', 'backoffice'] },
      'crm-dashboard': { icon: 'fa-chart-pie', text: 'CRM Dashboard', href: 'admin-crm-dashboard.html', roles: ['admin'] },
      empleado: { icon: 'fa-award', text: 'Empleado del Mes', href: 'empleado-del-mes.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
      'tabla-puntaje': { icon: 'fa-list', text: 'Tabla de puntaje', href: 'Tabla de puntaje.html', roles: ['admin', 'supervisor', 'agente', 'backoffice'] },
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
        const isActive = key === normalizedActive ? 'is-active' : '';
        menuHTML += `
          <li>
            <a href="${safeHref(item.href)}" class="btn btn-sidebar ${isActive}" title="${item.text}">
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
        const isActive = key === normalizedActive ? 'is-active' : '';
        menuHTML += `
          <li>
            <a href="${safeHref(item.href)}" class="btn btn-sidebar ${isActive}">
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
    if (['agente','agent','agents','agentes','usuario','user','seller','vendedor','sales','lineas-agentes','lineas-agente','lineas agentes'].includes(r)) return 'agente';
    // equivalentes de supervisor
    if (['supervisor','supervisora','supervisores','supervisor team lineas','supervisor lineas'].includes(r)) return 'supervisor';
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
          <div class="avatar-wrapper" data-avatar-wrapper data-has-local="false" data-has-profile="false" data-has-server="false">
            <div class="avatar" data-photo-state="fallback" data-avatar-source="" data-avatar-username="" data-profile-avatar="" data-server-avatar="" data-avatar-file-id="">
              <span class="user-avatar">U</span>
            </div>
            <button type="button" class="avatar-edit-btn" data-avatar-trigger title="Actualizar foto">
              <i class="fas fa-camera"></i><span class="sr-only">Actualizar foto</span>
            </button>
            <button type="button" class="avatar-remove-btn" data-avatar-clear title="Eliminar foto guardada">
              <i class="fas fa-trash"></i><span class="sr-only">Eliminar foto</span>
            </button>
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
    // BODY.classList.add('auto-hide-sidebar'); // DESHABILITADO - usar estilos del tema
    // BODY.classList.add('auto-hide-sidebar');

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

  function initializeSidebarAvatars(root) {
    try {
      const wrappers = root.querySelectorAll('[data-avatar-wrapper]');
      wrappers.forEach(wrapper => {
        const avatar = wrapper.querySelector('.avatar[data-photo-state]');
        if (!avatar) return;

        const img = avatar.querySelector('[data-avatar-img]');
        const applyLoaded = () => {
          try { avatar.setAttribute('data-photo-state', 'loaded'); } catch(_){ }
        };
        const applyFallback = () => {
          try { avatar.setAttribute('data-photo-state', 'fallback'); } catch(_){ }
          try { const existing = avatar.querySelector('[data-avatar-img]'); if (existing && existing.parentNode) existing.parentNode.removeChild(existing); } catch(_){ }
          if (wrapper && avatar.getAttribute('data-avatar-source') === 'local') {
            wrapper.setAttribute('data-has-local', 'false');
          }
        };

        if (img) {
          if (img.complete) {
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              applyLoaded();
            } else {
              applyFallback();
            }
          } else {
            img.addEventListener('load', applyLoaded, { once: true });
            img.addEventListener('error', applyFallback, { once: true });
          }
        } else {
          applyFallback();
        }

        const trigger = wrapper.querySelector('[data-avatar-trigger]');
        const clearBtn = wrapper.querySelector('[data-avatar-clear]');

        if (trigger && trigger.dataset.bound !== 'true') {
          trigger.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (wrapper && wrapper.getAttribute('data-avatar-uploading') === 'true') return;
            openAvatarPicker(avatar, wrapper);
          });
          trigger.dataset.bound = 'true';
        }

        if (clearBtn && clearBtn.dataset.bound !== 'true') {
          clearBtn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            if (wrapper && wrapper.getAttribute('data-avatar-uploading') === 'true') return;
            if (clearBtn.dataset.busy === 'true') return;
            clearBtn.dataset.busy = 'true';
            clearBtn.disabled = true;
            try {
              await clearAvatarImage(avatar, wrapper);
            } catch (error) {
              console.warn('clearAvatarImage error', error);
            } finally {
              clearBtn.dataset.busy = 'false';
              clearBtn.disabled = false;
            }
          });
          clearBtn.dataset.bound = 'true';
        }
      });
    } catch (err) {
      console.warn('initializeSidebarAvatars error', err);
    }
  }

  function ensureAvatarInput() {
    if (__avatarFileInput) return __avatarFileInput;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', handleAvatarInputChange);
    __avatarFileInput = input;
    return input;
  }

  function openAvatarPicker(avatarEl, wrapper) {
    if (!avatarEl) return;
    const username = avatarEl.getAttribute('data-avatar-username') || '';
    if (!username) {
      alert('No se pudo identificar al usuario para actualizar la foto.');
      return;
    }
    const input = ensureAvatarInput();
    __avatarCurrentTarget = { avatar: avatarEl, wrapper, username };
    input.value = '';
    input.click();
  }

  function setAvatarUploading(wrapper, uploading) {
    if (!wrapper) return;
    if (uploading) {
      wrapper.setAttribute('data-avatar-uploading', 'true');
    } else {
      wrapper.removeAttribute('data-avatar-uploading');
    }
    const trigger = wrapper.querySelector('[data-avatar-trigger]');
    const clearBtn = wrapper.querySelector('[data-avatar-clear]');
    if (trigger) {
      trigger.disabled = !!uploading;
    }
    if (clearBtn) {
      if (uploading) {
        clearBtn.disabled = true;
      } else if (clearBtn.dataset.busy !== 'true') {
        clearBtn.disabled = false;
      }
    }
  }

  function syncUserAvatarCache(url, fileId) {
    const storages = [window.localStorage, window.sessionStorage];
    storages.forEach(storage => {
      if (!storage) return;
      try {
        const raw = storage.getItem('user');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        if (url) parsed.avatarUrl = url; else delete parsed.avatarUrl;
        if (fileId) parsed.avatarFileId = fileId; else delete parsed.avatarFileId;
        if (url) parsed.avatarUpdatedAt = new Date().toISOString(); else delete parsed.avatarUpdatedAt;
        storage.setItem('user', JSON.stringify(parsed));
      } catch (err) {
        console.warn('syncUserAvatarCache error', err);
      }
    });
  }

  async function uploadAvatarFile(file) {
    const formData = new FormData();
    formData.append('avatar', file);

    const response = await fetch(AVATAR_UPLOAD_ENDPOINT, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    let parsed = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try { parsed = await response.json(); } catch (_) { parsed = null; }
    } else {
      const text = await response.text();
      try { parsed = JSON.parse(text); } catch (_) { parsed = { success: response.ok, message: text }; }
    }

    if (!response.ok || !parsed || parsed.success === false) {
      const message = (parsed && parsed.message) ? parsed.message : `Error del servidor (${response.status})`;
      throw new Error(message);
    }

    if (!parsed.data || !parsed.data.url) {
      throw new Error('Respuesta inválida del servidor al subir el avatar');
    }

    return parsed.data;
  }

  async function deleteServerAvatar() {
    const response = await fetch(AVATAR_DELETE_ENDPOINT, {
      method: 'DELETE',
      credentials: 'include'
    });

    let parsed = null;
    try { parsed = await response.json(); } catch (_) { parsed = null; }

    if (!response.ok || !parsed || parsed.success === false) {
      const message = (parsed && parsed.message) ? parsed.message : `Error del servidor (${response.status})`;
      throw new Error(message);
    }

    return parsed.data || { url: null };
  }

  async function handleAvatarInputChange(event) {
    try {
      const context = __avatarCurrentTarget;
      __avatarCurrentTarget = null;
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!context || !context.avatar || !file) return;
      if (file.size > MAX_AVATAR_BYTES) {
        alert(`La imagen es demasiado grande. El tamaño máximo es ${(MAX_AVATAR_BYTES / 1024 / 1024).toFixed(1)} MB.`);
        return;
      }
      setAvatarUploading(context.wrapper, true);
      try {
        const result = await uploadAvatarFile(file);
        clearStoredAvatar({ username: context.username });
        syncUserAvatarCache(result.url || '', result.fileId || '');
        context.avatar.setAttribute('data-server-avatar', result.url || '');
        context.avatar.setAttribute('data-avatar-file-id', result.fileId || '');
        applyAvatarImage(context.avatar, { url: result.url, source: 'server', wrapper: context.wrapper });
      } finally {
        setAvatarUploading(context.wrapper, false);
      }
    } catch (err) {
      console.warn('No se pudo actualizar la foto del usuario', err);
      const message = err && err.message ? err.message : 'Intenta con otro archivo de imagen.';
      alert(`No se pudo actualizar la foto. ${message}`);
    }
  }

  async function clearAvatarImage(avatarEl, wrapper) {
    if (!avatarEl) return;
    const username = avatarEl.getAttribute('data-avatar-username') || '';
    if (!username) return;
    clearStoredAvatar({ username });
    const hadServer = wrapper && wrapper.getAttribute('data-has-server') === 'true';
    if (hadServer) {
      setAvatarUploading(wrapper, true);
      try {
        await deleteServerAvatar();
        syncUserAvatarCache('', '');
      } catch (error) {
        console.warn('No se pudo eliminar el avatar del servidor', error);
        alert(`No se pudo eliminar la foto: ${error?.message || 'Error desconocido'}`);
        return;
      } finally {
        setAvatarUploading(wrapper, false);
      }
    }
    const profile = avatarEl.getAttribute('data-profile-avatar') || '';
    if (profile) {
      applyAvatarImage(avatarEl, { url: profile, source: 'profile', wrapper });
    } else {
      applyAvatarImage(avatarEl, { url: '', source: '', wrapper });
    }
    avatarEl.setAttribute('data-server-avatar', '');
    avatarEl.setAttribute('data-avatar-file-id', '');
  }

  function applyAvatarImage(avatarEl, options = {}) {
    const wrapper = options.wrapper || avatarEl.closest('[data-avatar-wrapper]');
    const url = options.url || '';
    const source = options.source || '';

    if (url) {
      let img = avatarEl.querySelector('[data-avatar-img]');
      if (!img) {
        img = document.createElement('img');
        img.setAttribute('data-avatar-img', '');
        img.className = 'user-avatar-img';
        img.alt = 'Foto de usuario';
        img.loading = 'lazy';
        img.decoding = 'async';
        avatarEl.insertBefore(img, avatarEl.firstChild);
      }
      avatarEl.setAttribute('data-photo-state', 'loading');
      avatarEl.setAttribute('data-avatar-source', source);
      if (source === 'server') {
        avatarEl.setAttribute('data-server-avatar', url);
      }
      img.onload = () => {
        avatarEl.setAttribute('data-photo-state', 'loaded');
        if (wrapper) {
          wrapper.setAttribute('data-has-local', source === 'local' ? 'true' : 'false');
          wrapper.setAttribute('data-has-profile', source === 'profile' ? 'true' : 'false');
          wrapper.setAttribute('data-has-server', source === 'server' ? 'true' : 'false');
        }
      };
      img.onerror = () => {
        avatarEl.setAttribute('data-photo-state', 'fallback');
        try { img.remove(); } catch(_){ }
        if (wrapper) {
          wrapper.setAttribute('data-has-local', 'false');
          if (source === 'profile') wrapper.setAttribute('data-has-profile', 'false');
          if (source === 'server') wrapper.setAttribute('data-has-server', 'false');
        }
      };
      if (img.getAttribute('src') !== url) img.src = url;
    } else {
      const img = avatarEl.querySelector('[data-avatar-img]');
      if (img) {
        try { img.remove(); } catch(_){ }
      }
      avatarEl.setAttribute('data-photo-state', 'fallback');
      avatarEl.setAttribute('data-avatar-source', '');
      if (wrapper) {
        wrapper.setAttribute('data-has-local', 'false');
        wrapper.setAttribute('data-has-profile', 'false');
        wrapper.setAttribute('data-has-server', 'false');
      }
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

  // Quick-fix: ensure clicking Ranking link always navigates (workaround for potential interceptors)
  document.addEventListener('click', function forceRankingNav(ev) {
    try {
      const a = ev.target && ev.target.closest ? ev.target.closest('a.btn-sidebar') : null;
      if (!a) return;
      const href = (a.getAttribute && a.getAttribute('href')) || '';
      const text = (a.textContent || '') || '';
      if (/ranking/i.test(href) || /ranking/i.test(text)) {
        // Allow normal navigation if href is a full absolute URL
        const dest = href || '/Ranking%20y%20Promociones.html';
        // Force navigation to avoid other handlers preventing default
        try { ev.preventDefault(); } catch(_) {}
        // If dest appears percent-encoded already, decode then set to avoid double-encoding
        try {
          const decoded = decodeURIComponent(dest);
          window.location.href = decoded;
        } catch (e) {
          window.location.href = dest;
        }
      }
    } catch (err) {
      // ignore
    }
  }, true);

  // NOTE: debug interceptor removed — sidebar will now allow normal navigation to pages

})();
