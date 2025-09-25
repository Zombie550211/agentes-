'use strict';
(function(){
  // Decodificador base64url -> JSON string
  function base64UrlDecode(seg){
    try {
      if (!seg) return '';
      // Reemplazar caracteres url-safe y agregar padding
      seg = seg.replace(/-/g, '+').replace(/_/g, '/');
      const pad = seg.length % 4;
      if (pad) seg += '='.repeat(4 - pad);
      return atob(seg);
    } catch { return ''; }
  }

  function decodeTokenRole() {
    // Intenta obtener el rol desde el JWT; si no existe, cae a user en storage
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (token && token.split('.').length === 3) {
        const payloadStr = base64UrlDecode(token.split('.')[1]);
        const payload = JSON.parse(payloadStr || '{}');
        const roleFromToken = (payload.role || payload.rol || payload.userRole || '').toString().toLowerCase();
        if (roleFromToken) return roleFromToken;
      }
    } catch { /* ignorar y continuar al fallback */ }
    try {
      const user = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
      return (user.role || user?.usuario?.role || '').toString().toLowerCase();
    } catch { return ''; }
  }

  // Normaliza distintos alias a un rol canónico
  function normalizeRole(raw){
    try {
      const r = (raw || '').toString().trim();
      // Mapeo de roles antiguos a nuevos roles unificados
      const map = { 
        'admin': 'Administrador',
        'administrador': 'Administrador',
        'Administrativo': 'Administrador',
        'backoffice': 'Backoffice',
        'b:o': 'Backoffice',
        'b.o': 'Backoffice',
        'b-o': 'Backoffice',
        'bo': 'Backoffice',
        'supervisor': 'Supervisor',
        'agent': 'Agentes',
        'agente': 'Agentes',
        'teamlineas': 'Supervisor Team Lineas',
        'Team Líneas': 'Supervisor Team Lineas',
        'lineas': 'Lineas-Agentes'
      };
      return map[r] || r;
    } catch { return ''; }
  }

  function setActive(nav, preferKey) {
    try {
      const role = normalizeRole(decodeTokenRole());
      const isTeamLineas = role === 'teamlineas' || (() => {
        try {
          const user = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
          const username = (user.username || '').toLowerCase();
          return username.startsWith('lineas-');
        } catch { return false; }
      })();
      
      // Para Team Líneas NO retornamos: necesitamos construir el mapa y marcar activos

      // Mapa de claves soportadas
      const map = [
        { key: 'inicio', href: 'inicio.html' },
        { key: 'ranking', href: 'Ranking y Promociones.html' },
        { key: 'lead', href: isTeamLineas ? 'lead-lineas.html' : 'lead.html' },
        { key: 'costumer', href: 'Costumer.html' },
        { key: 'register', href: 'register.html' },
        { key: 'facturacion', href: 'facturacion.html' },
        { key: 'estadisticas', href: 'Estadisticas.html' },
        { key: 'multimedia', href: 'multimedia.html' }
      ];

      // 1) Prioridad: atributo data-active si viene de la página
      let target = null;
      const keyAttr = (preferKey || nav.getAttribute('data-active') || '').toLowerCase();
      if (keyAttr) target = map.find(m => m.key === keyAttr);

      // 2) Fallback por URL
      if (!target) {
        const path = decodeURIComponent(location.pathname || '').toLowerCase();
        const urlTarget = [
          { key: 'inicio', match: 'inicio.html' },
          { key: 'ranking', match: 'ranking y promociones.html' },
          { key: 'lead', match: isTeamLineas ? 'lead-lineas.html' : 'lead.html' },
          { key: 'lead', match: 'lead.html' }, // Para compatibilidad con enlaces existentes
          { key: 'costumer', match: 'costumer.html' },
          { key: 'register', match: 'register.html' },
          { key: 'facturacion', match: 'facturacion.html' },
          { key: 'estadisticas', match: 'estadisticas.html' },
          { key: 'multimedia', match: 'multimedia.html' }
        ].find(m => path.endsWith(m.match));
        
        if (urlTarget) {
          target = map.find(m => m.key === urlTarget.key);
        }
      }

      // Actualizar el enlace de Lead en el sidebar
      const leadLinks = nav.querySelectorAll('a[href$="lead.html"]');
      leadLinks.forEach(link => {
        if (isTeamLineas) {
          link.href = 'lead-lineas.html';
        }
      });

      // Actualizar clases activas
      const links = nav.querySelectorAll('a.btn.btn-sidebar');
      links.forEach(a => a.classList.remove('is-active'));
      
      if (!target) return;
      
      for (const a of links) {
        const ahref = (a.getAttribute('href') || '').toLowerCase();
        if (ahref.endsWith(target.href.toLowerCase())) { 
          a.classList.add('is-active'); 
          break; 
        }
      }
    } catch (e) { console.warn('sidebar active state error', e); }
  }

  function applyAdminVisibility(nav){
    try {
      const rawRole = decodeTokenRole();
      const role = normalizeRole(rawRole);
      console.log('[SIDEBAR] Rol detectado - Raw:', rawRole, 'Normalizado:', role);
      // 1) Mostrar/ocultar items exclusivamente de admin por ID conocido
      const ids = ['#menu-create-account'];
      ids.forEach(sel => {
        const li = nav.querySelector(sel);
        if (li) {
          // Verificar múltiples variantes de admin
          const isAdmin = ['admin', 'Administrador', 'administrador', 'Administrativo'].includes(role);
          li.style.display = isAdmin ? 'block' : 'none';
          console.log('[SIDEBAR] Menu crear cuenta:', isAdmin ? 'VISIBLE' : 'OCULTO', 'para rol:', role);
        }
      });
      // 2) Ocultar el enlace de Facturación si no es admin (sin modificar el componente)
      const factLink = nav.querySelector('a[href$="facturacion.html"]');
      const factLi = factLink ? (factLink.closest('li') || factLink.parentElement) : null;
      if (factLi) {
        const isAdmin = ['admin', 'Administrador', 'administrador', 'Administrativo'].includes(role);
        factLi.style.display = isAdmin ? '' : 'none';
      }
      // 3) Ocultar Estadísticas para quienes NO sean admin o BO (variantes)
      const allowedStats = ['admin', 'Administrador', 'administrador', 'Administrativo', 'backoffice', 'Backoffice', 'b:o', 'b.o', 'b-o', 'bo'];
      const statsLink = nav.querySelector('a[href$="Estadisticas.html"], a[href$="estadisticas.html"]');
      const statsLi = statsLink ? (statsLink.closest('li') || statsLink.parentElement) : null;
      if (statsLi) {
        statsLi.style.display = allowedStats.includes(role) ? '' : 'none';
      }

      // 3.1) Ocultar Multimedia para todos excepto Administrador
      const multimediaLink = nav.querySelector('a[href$="multimedia.html"]');
      const multimediaLi = multimediaLink ? (multimediaLink.closest('li') || multimediaLink.parentElement) : null;
      if (multimediaLi) {
        const isAdmin = ['admin', 'Administrador', 'administrador', 'Administrativo'].includes(role);
        multimediaLi.style.display = isAdmin ? '' : 'none';
      }

      // 4) Habilitar SIEMPRE Costumer para todos los roles (incluyendo Team Líneas)
      const costumerLink = nav.querySelector('a[href$="Costumer.html"], a[href$="costumer.html"]');
      const costumerLi = costumerLink ? (costumerLink.closest('li') || costumerLink.parentElement) : null;
      if (costumerLi) {
        costumerLi.style.display = '';
      }
    } catch(e){ console.warn('sidebar admin visibility error', e); }
  }

  function wireLogout(nav){
    const btn = nav.querySelector('[data-logout-button]');
    if (!btn) return;
    btn.addEventListener('click', function(e){
      e.preventDefault();
      try {
        if (typeof window.logout === 'function') {
          return window.logout();
        }
      } catch {}
      try { localStorage.removeItem('token'); } catch{}
      try { sessionStorage.removeItem('token'); } catch{}
      try { localStorage.removeItem('user'); } catch{}
      try { sessionStorage.removeItem('user'); } catch{}
      location.href = 'login.html';
    });
  }

  async function loadSidebar(){
    const nav = document.querySelector('nav.sidebar');
    if (!nav) return;
    try {
      // Ocultar temporalmente para evitar flicker hasta aplicar activo
      const prevVisibility = nav.style.visibility;
      nav.style.visibility = 'hidden';
      const desiredKey = nav.getAttribute('data-active');
      // Intentar múltiples rutas para mayor robustez según basePath
      async function fetchFirstOk(urls){
        let lastErr = null;
        for (const u of urls) {
          try {
            const r = await fetch(u, { cache: 'no-store' });
            if (r && r.ok) return r;
          } catch (e) { lastErr = e; }
        }
        if (lastErr) throw lastErr;
        throw new Error('Ninguna ruta de sidebar.html respondió OK');
      }
      // Usar rutas relativas a la raíz del sitio
      const basePath = window.location.pathname.split('/').slice(0, -1).join('/') || '/';
      // Agregar timestamp para evitar cache
      const timestamp = Date.now();
      const candidates = [
        `/components/sidebar.html?v=${timestamp}`,
        `components/sidebar.html?v=${timestamp}`,
        `./components/sidebar.html?v=${timestamp}`,
        `../components/sidebar.html?v=${timestamp}`,
        basePath + `/components/sidebar.html?v=${timestamp}`,
        window.location.origin + `/components/sidebar.html?v=${timestamp}`,
        `/dashboard/components/sidebar.html?v=${timestamp}`,  // Ruta específica para el servidor local
        window.location.origin + `/dashboard/components/sidebar.html?v=${timestamp}`  // Ruta completa para el servidor local
      ].filter(Boolean);
      console.log('Buscando sidebar en rutas:', candidates);
      const resp = await fetchFirstOk(candidates);
      const html = await resp.text();
      nav.innerHTML = html;
      // post-setup
      setActive(nav, desiredKey);
      applyAdminVisibility(nav);
      wireLogout(nav);
      // Hardening: asegurar que el enlace de Costumer funcione para todos los roles
      try {
        const links = Array.from(nav.querySelectorAll('a'));
        const costumerLink = links.find(a => {
          const href = (a.getAttribute('href') || '').toLowerCase();
          const txt = (a.textContent || '').toLowerCase().trim();
          return href.endsWith('costumer.html') || txt.includes('costumer');
        });
        if (costumerLink) {
          console.debug('[sidebar] Normalizando enlace Costumer:', costumerLink.outerHTML);
          costumerLink.setAttribute('href', 'Costumer.html');
          costumerLink.removeAttribute('onclick');
          costumerLink.removeAttribute('target');
          costumerLink.style.pointerEvents = '';
          // Asegurar navegación directa al hacer click
          costumerLink.addEventListener('click', function(ev){
            try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch(_) {}
            const abs = window.location.origin + '/Costumer.html';
            window.location.assign(abs);
          });
        } else {
          console.warn('[sidebar] No se encontró enlace Costumer en el sidebar');
        }
      } catch(err){ console.warn('[sidebar] Error normalizando Costumer:', err); }
      // Delegated handler de respaldo: forzar navegación a Costumer.html
      try {
        nav.addEventListener('click', function(ev){
          const a = ev.target && ev.target.closest ? ev.target.closest('a.btn.btn-sidebar') : null;
          if (!a) return;
          const txt = (a.textContent || '').toLowerCase().trim();
          if (txt.includes('costumer')) {
            try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch(_) {}
            const abs = window.location.origin + '/Costumer.html';
            window.location.replace(abs);
          }
        });
      } catch(_){ /* noop */ }
      // Rellenar la info de usuario si el script está disponible
      try { if (typeof window.cargarInfoUsuario === 'function') window.cargarInfoUsuario(); } catch {}
      // let other scripts (user-info.js) populate name/role after injection
      document.dispatchEvent(new CustomEvent('sidebar:loaded'));
      // Mostrar el nav ya configurado
      nav.style.visibility = prevVisibility || '';
    } catch (e) {
      console.error('Error cargando el sidebar compartido:', e);
      try {
        console.warn('Diagnóstico: intentando acceder a rutas absolutas/relativas de sidebar.html falló');
      } catch {}
      // Asegurar que no quede oculto en caso de error
      try { nav.style.visibility = ''; } catch {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
  } else {
    loadSidebar();
  }
})();
