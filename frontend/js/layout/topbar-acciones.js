/**
 * Iconos de la cabecera (ajustes, chat, notificaciones y usuario), cada uno con su menú.
 * Lo usa la página de inicio junto a js/layout/topnav.js.
 *
 * La página aporta:  <div id="topbar-acciones" class="in-iconos"></div>
 * y window.__sesion (promesa de /api/auth/verify-server) si ya la tiene.
 *
 * ── Añadir opciones ──
 * Cada menú es una entrada de ACCIONES; cada opción, una línea en su `items`:
 *   { label: 'Texto', icon: 'ph-clock', href: '/ruta.html' }       → enlace
 *   { label: 'Texto', icon: 'ph-key', accion: 'nombre' }           → función de ACCIONES_JS
 *   roles: 'admin' (sólo administración) | 'gestion' (administración y back office)
 * Una acción sin items y con href es un icono-enlace directo (como el chat).
 * Ocultar una opción por rol es sólo navegación: cada página y su API vuelven a
 * comprobar el permiso.
 */
(function () {
  'use strict';

  var ACCIONES = [
    { id: 'ajustes', icon: 'ph-gear-six', label: 'Ajustes', items: [
      { label: 'Promociones activas', icon: 'ph-megaphone-simple', href: '/residencial/promociones-validas.html' },
      { label: 'Horarios', icon: 'ph-clock', href: '/horarios.html' },
      { label: 'Permisos y cuentas', icon: 'ph-key', href: '/crear-cuenta.html', roles: 'gestion' },
      { label: 'Tiempo laboral', icon: 'ph-clock', href: '/residencial/tiempo-laboral.html', roles: 'gestion' },
    ] },
    { id: 'chat', icon: 'ph-chat-circle-dots', label: 'Chat', href: '/chat.html' },
    { id: 'avisos', icon: 'ph-bell', label: 'Notificaciones', panel: 'notificaciones' },
    { id: 'usuario', avatar: true, label: 'Mi cuenta', items: [
      { label: 'Mi horario', icon: 'ph-clock', href: '/horarios.html' },
      { label: 'Chat', icon: 'ph-chat-circle-dots', href: '/chat.html' },
      { label: 'Cerrar sesión', icon: 'ph-sign-out', accion: 'salir', peligro: true },
    ] },
  ];

  var ACCIONES_JS = {
    salir: function () {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        .catch(function () {})
        .then(function () { location.replace('/login.html'); });
    },
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  // Mismos criterios que js/layout/topnav.js (y ADMIN_ROLES de deps.py).
  function esAdmin(role) { var r = norm(role); return r === 'admin' || r === 'administrador' || r === 'administrativo' || r === 'administrator'; }
  function esBackoffice(role) { var r = norm(role); return r.indexOf('backoffice') >= 0 || r.indexOf('back office') >= 0 || r.indexOf('back_office') >= 0 || r === 'bo'; }
  function visible(it, u) {
    if (!it.roles) return true;
    if (!u) return false;
    if (it.roles === 'admin') return esAdmin(u.role);
    if (it.roles === 'gestion') return esAdmin(u.role) || esBackoffice(u.role);
    return true;
  }

  // ── Pintado ──
  function boton(a, n, u) {
    var nombre = u ? String(u.name || u.username || '').trim() : '';
    var cara = a.avatar
      ? '<span class="tb-avatar" aria-hidden="true">' + esc(nombre.charAt(0).toUpperCase() || '·') + '</span><i class="ph ph-caret-down tb-caret" aria-hidden="true"></i>'
      : '<i class="ph ' + a.icon + '" aria-hidden="true"></i>' + (a.panel === 'notificaciones' ? '<span class="tb-punto" hidden></span>' : '');
    if (a.href && !a.items && !a.panel) {
      return '<a class="tb-btn" href="' + esc(a.href) + '" title="' + esc(a.label) + '" aria-label="' + esc(a.label) + '">' + cara + '</a>';
    }
    var id = 'tb-menu-' + n;
    var cabecera = a.avatar && u
      ? '<div class="tb-quien"><strong>' + esc(nombre || u.username) + '</strong><span>' + esc(u.role || '') + (u.team ? ' · ' + esc(u.team) : '') + '</span></div>'
      : '<div class="tb-titulo">' + esc(a.label) + '</div>';
    var cuerpo = a.panel === 'notificaciones'
      ? '<div class="tb-avisos" data-avisos><div class="tb-vacio">Cargando…</div></div>'
      : (a.items || []).filter(function (it) { return visible(it, u); }).map(function (it) {
        var ico = it.icon ? '<i class="ph ' + it.icon + '" aria-hidden="true"></i>' : '';
        var cls = 'tb-item' + (it.peligro ? ' tb-peligro' : '');
        return it.accion
          ? '<button type="button" class="' + cls + '" data-accion="' + esc(it.accion) + '">' + ico + esc(it.label) + '</button>'
          : '<a class="' + cls + '" href="' + esc(it.href) + '">' + ico + esc(it.label) + '</a>';
      }).join('');
    return '<div class="tb-grupo" data-id="' + esc(a.id) + '">' +
      '<button type="button" class="tb-btn" aria-haspopup="true" aria-expanded="false" aria-controls="' + id + '" title="' + esc(a.label) + '" aria-label="' + esc(a.label) + '">' + cara + '</button>' +
      '<div class="tb-menu' + (a.panel ? ' tb-panel' : '') + '" id="' + id + '" hidden>' + cabecera + cuerpo + '</div></div>';
  }
  function render(cont, u) {
    cont.innerHTML = ACCIONES.map(function (a, i) { return boton(a, i, u); }).join('');
  }

  // ── Notificaciones: cambios de status de tus clientes (GET /api/notificaciones/status,
  //    últimas 48 h). El punto se enciende si hay alguno posterior a la última vez que se
  //    abrió la campana (se recuerda en este navegador).
  var VISTO = 'crm_campana_vista';
  var avisos = [];
  function leerVisto() { try { return localStorage.getItem(VISTO) || ''; } catch (e) { return ''; } }
  function hace(fecha) {
    var t = Date.parse(String(fecha).replace(' ', 'T') + 'Z');
    if (isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'Ahora';
    if (m < 60) return 'Hace ' + m + ' min';
    if (m < 1440) return 'Hace ' + Math.floor(m / 60) + ' h';
    return 'Hace ' + Math.floor(m / 1440) + ' d';
  }
  function pintarAvisos(cont) {
    var punto = cont.querySelector('.tb-punto'), lista = cont.querySelector('[data-avisos]');
    var visto = leerVisto();
    if (punto) punto.hidden = !avisos.some(function (n) { return String(n.fecha) > visto; });
    if (!lista) return;
    lista.innerHTML = avisos.length ? avisos.map(function (n) {
      return '<div class="tb-aviso"><i class="ph ph-check-circle" aria-hidden="true"></i><div>' +
        '<div><strong>' + esc(n.cliente || 'Cliente') + '</strong> pasó a <strong>' + esc(n.new_status || '—') + '</strong>' +
          (n.seccion === 'lineas' ? ' (Líneas)' : '') + '</div>' +
        '<div class="tb-meta">' + (n.actor ? esc(n.actor) + ' · ' : '') + esc(hace(n.fecha)) + '</div></div></div>';
    }).join('') : '<div class="tb-vacio"><i class="ph ph-bell-slash" aria-hidden="true"></i>Sin novedades en las últimas 48 h.</div>';
  }
  function cargarAvisos(cont) {
    return fetch('/api/notificaciones/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { avisos = (d && d.items) || []; pintarAvisos(cont); })
      .catch(function () {
        var l = cont.querySelector('[data-avisos]');
        if (l) l.innerHTML = '<div class="tb-vacio">No se pudieron cargar las notificaciones.</div>';
      });
  }

  // ── Abrir y cerrar ──
  function cerrarTodos(cont, salvo) {
    cont.querySelectorAll('.tb-grupo').forEach(function (g) {
      if (g === salvo) return;
      g.querySelector('.tb-btn').setAttribute('aria-expanded', 'false');
      g.querySelector('.tb-menu').hidden = true;
    });
  }
  function iniciar(cont) {
    var sesion = window.__sesion || fetch('/api/auth/verify-server', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    render(cont, null);
    Promise.resolve(sesion).then(function (s) {
      render(cont, s && s.user);
      cargarAvisos(cont);
    });

    cont.addEventListener('click', function (e) {
      var acc = e.target.closest('[data-accion]');
      if (acc) { var f = ACCIONES_JS[acc.dataset.accion]; if (f) f(); cerrarTodos(cont); return; }
      var btn = e.target.closest('.tb-btn[aria-expanded]');
      if (!btn) return;
      var grupo = btn.parentElement, abrir = btn.getAttribute('aria-expanded') !== 'true';
      cerrarTodos(cont, grupo);
      btn.setAttribute('aria-expanded', String(abrir));
      grupo.querySelector('.tb-menu').hidden = !abrir;
      if (abrir && grupo.dataset.id === 'avisos') {
        cargarAvisos(cont).then(function () {
          if (avisos.length) { try { localStorage.setItem(VISTO, String(avisos[0].fecha)); } catch (err) {} }
          var p = cont.querySelector('.tb-punto'); if (p) p.hidden = true;
        });
      }
      if (abrir && e.detail === 0) { var p = grupo.querySelector('.tb-item'); if (p) p.focus(); }
    });
    document.addEventListener('click', function (e) { if (!cont.contains(e.target)) cerrarTodos(cont); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var abierto = cont.querySelector('.tb-btn[aria-expanded="true"]');
      cerrarTodos(cont);
      if (abierto) abierto.focus();
    });
    // La campana se refresca sola cada 2 minutos.
    setInterval(function () { cargarAvisos(cont); }, 120000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var cont = document.getElementById('topbar-acciones');
    if (cont) iniciar(cont);
  });
})();
