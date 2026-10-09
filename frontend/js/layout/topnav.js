/**
 * Menú superior del CRM: las opciones del sidebar (js/layout/sidebar.js) agrupadas en
 * 6 botones con desplegable. Por ahora lo usa la página de inicio; está pensado para
 * sustituir al sidebar en el resto de páginas.
 *
 * La página aporta:  <nav id="topnav"></nav>
 * y window.__sesion (promesa con la respuesta de /api/auth/verify-server) si ya la tiene;
 * si no, la pide este módulo.
 *
 * Visibilidad según el perfil y el rol del usuario (no según la página en la que está):
 *  - sección: la del usuario (líneas si su equipo o su rol dicen "línea"; si no,
 *    residencial). Ve las opciones de su sección y las comunes; administración y back
 *    office ven las dos.
 *  - rol: algunas opciones solo para administración ('admin': Facturación, cuya API exige
 *    ADMIN_ROLES) o para administración y back office ('gestion': Permisos, Tiempo laboral).
 * Un grupo sin opciones visibles no se muestra. Es solo navegación: cada página y su API
 * vuelven a comprobar el permiso.
 */
(function () {
  'use strict';

  // seccion: 'res' (residencial), 'lin' (líneas) o 'comun' (todos).
  var GRUPOS = [
    { label: 'Clientes y ventas', items: [
      { label: 'Inicio', href: '/residencial/inicio.html', seccion: 'res' },
      { label: 'Formulario', href: '/residencial/formulario-registro.html', seccion: 'res' },
      { label: 'Lista de Clientes', href: '/residencial/costumer.html', seccion: 'res' },
      { label: 'Tipificación', href: '/residencial/normativas-tipificacion.html', seccion: 'res' },
      { label: 'Promociones activas', href: '/residencial/promociones-validas.html', seccion: 'res' },
      { label: 'Llamadas y Ventas por Team', href: '/residencial/llamadas-ventas.html', seccion: 'res' },
    ] },
    { label: 'Estadísticas y productividad', items: [
      { label: 'Productividad B.O', href: '/residencial/productividad-bo.html', seccion: 'res' },
      { label: 'Estadísticas', href: '/residencial/estadisticas.html', seccion: 'res' },
      { label: 'Productividad', href: '/residencial/productividad.html', seccion: 'res' },
      { label: 'El Semáforo', href: '/residencial/semaforo.html', seccion: 'res' },
    ] },
    { label: 'Rankings y premios', items: [
      { label: 'Ranking de Agentes', href: '/residencial/ranking-agente.html', seccion: 'res' },
      { label: 'Ranking y Promociones', href: '/residencial/ranking.html', seccion: 'res' },
      { label: 'Reglas y Puntajes', href: '/residencial/reglas.html', seccion: 'res' },
      { label: 'Tabla de Puntaje', href: '/residencial/tabla-puntaje.html', seccion: 'res' },
      { label: 'Empleado del Mes', href: '/residencial/empleado-mes.html', seccion: 'res' },
    ] },
    { label: 'Facturación y comisiones', items: [
      { label: 'Facturación', href: '/residencial/facturacion.html', seccion: 'res', roles: 'admin' },
      { label: 'Comisión', href: '/residencial/comisiones.html', seccion: 'res' },
    ] },
    { label: 'Administración y personal', items: [
      { label: 'Permisos', href: '/crear-cuenta.html', seccion: 'res', roles: 'gestion' },
      { label: 'Tiempo laboral', href: '/residencial/tiempo-laboral.html', seccion: 'res', roles: 'gestion' },
      { label: 'Horarios', href: '/horarios.html', seccion: 'comun' },
      { label: 'Chat', href: '/chat.html', seccion: 'res' },
    ] },
    { label: 'Servicios móviles', items: [
      { label: 'Inicio de móviles', href: '/lineas/inicio.html', seccion: 'lin' },
      { label: 'Nuevo Lead', href: '/lineas/lead.html', seccion: 'lin' },
      { label: 'Customer Líneas', href: '/lineas/costumer.html', seccion: 'lin' },
      { label: 'Estadísticas Líneas', href: '/lineas/estadisticas.html', seccion: 'lin' },
      { label: 'Ranking Líneas', href: '/lineas/ranking.html', seccion: 'lin' },
    ] },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function normPath(p) { return String(p || '').replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/'; }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  // Mismos roles que ADMIN_ROLES del backend (deps.py).
  function esAdmin(role) { var r = norm(role); return r === 'admin' || r === 'administrador' || r === 'administrativo' || r === 'administrator'; }
  function esBackoffice(role) { var r = norm(role); return r.indexOf('backoffice') >= 0 || r.indexOf('back office') >= 0 || r.indexOf('back_office') >= 0 || r === 'bo'; }
  function seccionDe(u) { return (norm(u.team).indexOf('linea') >= 0 || norm(u.role).indexOf('linea') >= 0) ? 'lin' : 'res'; }
  function visible(it, u) {
    if (!u) return it.seccion === 'comun';            // aún sin sesión: solo lo común
    var gestion = esAdmin(u.role) || esBackoffice(u.role);
    if (it.roles === 'admin' && !esAdmin(u.role)) return false;
    if (it.roles === 'gestion' && !gestion) return false;
    return gestion || it.seccion === 'comun' || it.seccion === seccionDe(u);
  }

  function render(nav, sesion) {
    var ruta = normPath(location.pathname);
    var u = sesion && sesion.user;                     // /api/auth/verify-server → { user: {...} }
    var n = 0;
    nav.innerHTML = GRUPOS.map(function (g) {
      var items = g.items.filter(function (it) { return visible(it, u); });
      if (!items.length) return '';
      var activo = items.some(function (it) { return normPath(it.href) === ruta; });
      var id = 'tn-menu-' + (n++);
      return '<div class="tn-grupo' + (activo ? ' tn-activo' : '') + '">' +
        '<button type="button" class="tn-btn" aria-expanded="false" aria-controls="' + id + '">' +
          esc(g.label) + '<i class="ph ph-caret-down" aria-hidden="true"></i></button>' +
        '<div class="tn-menu" id="' + id + '" hidden>' + items.map(function (it) {
          var act = normPath(it.href) === ruta;
          return '<a href="' + esc(it.href) + '" class="tn-item' + (act ? ' tn-item-activo' : '') + '"' +
            (act ? ' aria-current="page"' : '') + '>' + esc(it.label) + '</a>';
        }).join('') + '</div></div>';
    }).join('');
  }

  function cerrarTodos(nav, salvo) {
    nav.querySelectorAll('.tn-grupo').forEach(function (g) {
      if (g === salvo) return;
      g.querySelector('.tn-btn').setAttribute('aria-expanded', 'false');
      g.querySelector('.tn-menu').hidden = true;
    });
  }

  function iniciar(nav) {
    var sesion = window.__sesion || fetch('/api/auth/verify-server', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    render(nav, null);   // primero lo común a todos; al saber el rol se completa
    Promise.resolve(sesion).then(function (s) { render(nav, s); });

    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('.tn-btn');
      if (!btn) return;
      var grupo = btn.parentElement, abrir = btn.getAttribute('aria-expanded') !== 'true';
      cerrarTodos(nav, grupo);
      btn.setAttribute('aria-expanded', String(abrir));
      grupo.querySelector('.tn-menu').hidden = !abrir;
      if (abrir) { var p = grupo.querySelector('.tn-item'); if (p && e.detail === 0) p.focus(); }
    });
    document.addEventListener('click', function (e) { if (!nav.contains(e.target)) cerrarTodos(nav); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var abierto = nav.querySelector('.tn-btn[aria-expanded="true"]');
      cerrarTodos(nav);
      if (abierto) abierto.focus();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.getElementById('topnav');
    if (nav) iniciar(nav);
  });
})();
