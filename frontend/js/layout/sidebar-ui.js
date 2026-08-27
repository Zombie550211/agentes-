/**
 * Sidebar — comportamiento. El marcado lo genera sidebar.js, que debe cargarse antes.
 *
 * (Este archivo se llamaba sidebar-static.js, por la época en que el menú estaba
 * escrito a mano en cada página. Ya no lo está, así que el nombre engañaba.)
 */
(function () {
  'use strict';

  // ── Visibilidad de las secciones de admin ────────────────────────
  function normalizeRole(roleRaw) {
    const r = (roleRaw == null ? '' : String(roleRaw)).trim().toLowerCase();
    if (['admin', 'administrator', 'administrador', 'administradora'].includes(r)) return 'admin';
    if (['backoffice', 'back office', 'back_office', 'bo', 'rol_icon', 'rol_bamo'].includes(r)) return 'backoffice';
    return r;
  }

  function applyAdminVisibility(role) {
    const normalized = normalizeRole(role);
    const isAdmin = normalized === 'admin' || normalized === 'backoffice';
    document.body.classList.toggle('sb-is-admin', isAdmin);
  }

  async function getRole() {
    try {
      const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.role) return parsed.role;
      }
    } catch (_) {}

    try {
      if (window.__homeDataPromise) {
        const hd = await window.__homeDataPromise;
        if (hd && hd.user && hd.user.role) return hd.user.role;
      }
      if (window.__homeData && window.__homeData.user && window.__homeData.user.role) {
        return window.__homeData.user.role;
      }
    } catch (_) {}

    try {
      const response = await fetch('/api/auth/verify-server', { method: 'GET', credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data && data.authenticated && data.user) return data.user.role;
      }
    } catch (_) {}

    return null;
  }

  getRole().then(applyAdminVisibility);

  // ── Botón de menú + overlay ──────────────────────────────────────
  // Se usa en pantallas angostas y también en cualquier dispositivo sin ratón:
  // en escritorio el sidebar arranca colapsado y se despliega con :hover, cosa
  // que en una tablet no ocurre nunca. Antes el botón sólo aparecía por debajo
  // de 768px, así que un iPad en horizontal (1024px) se quedaba con el menú en
  // modo icono y sin ninguna forma de expandirlo. Quién lo ve lo decide el CSS
  // (ver sidebar-static.css); aquí sólo se inyecta y se le da comportamiento.
  function setupMobileToggle() {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar || document.querySelector('.sb-mobile-toggle')) return;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sb-mobile-toggle';
    toggle.setAttribute('aria-controls', 'app-sidebar');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menú');
    toggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

    const overlay = document.createElement('div');
    overlay.className = 'sb-mobile-overlay';

    function setState(abierto) {
      sidebar.classList.toggle('sb-open', abierto);
      overlay.classList.toggle('sb-open', abierto);
      toggle.setAttribute('aria-expanded', String(abierto));
      // La etiqueta describe la ACCIÓN del botón, así que se invierte al abrir.
      // Antes decía "Abrir menú" también con el menú abierto.
      toggle.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
    }
    function close(devolverFoco) {
      setState(false);
      if (devolverFoco) toggle.focus();
    }
    function open() {
      setState(true);
      const primero = sidebar.querySelector('.sb-item');
      if (primero) primero.focus();
    }

    toggle.addEventListener('click', function () {
      sidebar.classList.contains('sb-open') ? close(false) : open();
    });
    overlay.addEventListener('click', function () { close(false); });
    sidebar.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.sb-item')) close(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('sb-open')) close(true);
    });

    document.body.appendChild(toggle);
    document.body.appendChild(overlay);
  }
  setupMobileToggle();

  // ── Temporada: Mes de la Independencia ───────────────────────────
  // Se aplica al CRM entero desde aquí porque este módulo y sidebar-static.css
  // son lo ÚNICO que cargan las 37 páginas: una sola línea tematiza todo sin
  // tocar 37 archivos ni añadirles un <link>.
  //
  // La hoja se inyecta sólo dentro de la ventana de fechas, así que fuera de
  // temporada ni se descarga. Las dos capas son decorativas y van fuera del
  // flujo (fixed), de modo que no desplazan ni un píxel en ninguna página —
  // que es lo que permite ponerlas en las 37 sin revisarlas una por una.
  function temporadaIndependencia() {
    if (!(window.Temporada && window.Temporada.independencia())) return;

    document.body.classList.add('temporada-independencia');

    if (!document.querySelector('link[href^="/css/base/temporada.css"]')) {
      var hoja = document.createElement('link');
      hoja.rel = 'stylesheet';
      hoja.href = '/css/base/temporada.css?v=20260826a';
      document.head.appendChild(hoja);
    }

    ['temporada-fondo', 'temporada-franja'].forEach(function (clase) {
      if (document.querySelector('.' + clase)) return;
      var capa = document.createElement('div');
      capa.className = clase;
      capa.setAttribute('aria-hidden', 'true');   // decorativas: fuera del lector
      document.body.appendChild(capa);
    });
  }
  temporadaIndependencia();

  // ── Widgets que cuelgan del sidebar ──────────────────────────────
  // Se inyectan aquí para no tener que declararlos en el HTML de cada página.
  function cargarUnaVez(src) {
    if (document.querySelector('script[src^="' + src + '"]')) return;
    const script = document.createElement('script');
    script.src = src;
    document.body.appendChild(script);
  }

  // La ?v= fuerza al navegador a bajar la versión nueva cuando el archivo cambia.
  // Subir el número al editarlos.
  cargarUnaVez('/js/componentes/ai-assistant.js?v=20260801a');

  // Alerta de instalaciones del día. La cargaba sidebar-loader.js, que desapareció
  // al reescribir el sidebar (commit cf7cab1); desde entonces el script existía y su
  // endpoint respondía, pero nadie lo pedía. No hace falta filtrar por página: el
  // propio script sólo se activa en inicio, index y costumer, y descarta backoffice.
  cargarUnaVez('/js/componentes/instalaciones-hoy.js?v=20260817a');
})();
