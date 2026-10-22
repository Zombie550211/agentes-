/**
 * Portal de facturación (connecting.lat/portal) — sesión y cabecera.
 *
 * Facturación y Recibos de Google Ads son las MISMAS páginas que en el CRM
 * (residencial/facturacion.html y residencial/recibos-google.html), servidas también en
 * /portal/facturacion.html y /portal/recibos-google.html. Este script va el primero en su
 * <head>: si la dirección empieza por /portal/, la página funciona en modo portal:
 *   · window.PORTAL = true; los scripts del CRM que dependen de su sesión (menú, iconos,
 *     chat, semáforo, avisos de sesión…) lo miran y no hacen nada.
 *   · window.__sesion sale de /api/portal/me (no de /api/auth/verify-server).
 *   · Una respuesta 401 lleva al login del portal, no al del CRM.
 *   · Pinta la cabecera del portal en #topnav y #topbar-acciones.
 *   · Usuario de solo lectura: clase .pt-solo-lectura en <html> (portal.css oculta
 *     Guardar / Subir) y ninguna celda queda editable. El backend lo impone igual.
 * Fuera de /portal/ no hace nada. API: CRM_PYTHON/routers/portal.py.
 */
(function () {
  'use strict';

  var ruta = location.pathname;
  window.PORTAL = ruta === '/portal' || ruta.indexOf('/portal/') === 0;
  if (!window.PORTAL) return;
  document.documentElement.classList.add('es-portal');

  var LOGIN = '/portal/';
  var esLogin = /^\/portal\/?(index\.html)?$/.test(ruta);
  var MENU = [
    { label: 'Inicio', corto: 'Inicio', href: '/portal/inicio.html', icon: 'ph-house-line' },
    { label: 'Facturación', corto: 'Facturación', href: '/portal/facturacion.html', icon: 'ph-receipt' },
    { label: 'Recibos Google Ads', corto: 'Recibos', href: '/portal/recibos-google.html', icon: 'ph-chart-bar' },
  ];

  // Sesión caducada o cerrada en otra pestaña: al login del portal.
  var fetchOriginal = window.fetch.bind(window);
  var saliendo = false;
  window.fetch = function (url, config) {
    config = config || {};
    if (!config.credentials) config.credentials = 'include';
    return fetchOriginal(url, config).then(function (r) {
      if (r.status === 401 && !esLogin && !saliendo) {
        saliendo = true;
        location.replace(LOGIN);
      }
      return r;
    });
  };
  if (esLogin) return;

  // Misma forma que la respuesta de /api/auth/verify-server que leen las páginas del CRM.
  window.__sesion = fetchOriginal('/api/portal/me', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) { location.replace(LOGIN); return { authenticated: false }; }
      if (d.usuario.solo_lectura) soloLectura();
      return { authenticated: true, portal: true, soloLectura: !!d.usuario.solo_lectura,
               user: { role: 'portal', username: d.usuario.nombre, name: d.usuario.nombre } };
    })
    .catch(function () { location.replace(LOGIN); return { authenticated: false }; });

  // Las páginas de facturación ponen contentEditable al pintar cada tabla: se deshace al vuelo.
  function soloLectura() {
    document.documentElement.classList.add('pt-solo-lectura');
    function bloquear(raiz) {
      if (raiz.nodeType !== 1) return;
      if (raiz.isContentEditable || raiz.getAttribute('contenteditable') === 'true') raiz.contentEditable = 'false';
      raiz.querySelectorAll('[contenteditable="true"]').forEach(function (n) { n.contentEditable = 'false'; });
    }
    new MutationObserver(function (cambios) {
      cambios.forEach(function (c) {
        if (c.type === 'attributes') bloquear(c.target);
        else c.addedNodes.forEach(bloquear);
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable'] });
    bloquear(document.documentElement);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Cabecera: enlaces del portal (con las clases del menú del CRM) y, a la derecha, el
  // avatar con su menú (mismas clases tb-* que js/layout/topbar-acciones.js).
  function pintarCabecera() {
    var nav = document.getElementById('topnav');
    var acciones = document.getElementById('topbar-acciones');
    var actual = ruta.replace(/\/+$/, '');
    if (nav) {
      nav.setAttribute('aria-label', 'Portal de facturación');
      nav.innerHTML = MENU.map(function (m) {
        var act = m.href === actual;
        return '<div class="tn-grupo' + (act ? ' tn-activo' : '') + '"><a class="tn-btn pt-link" href="' + m.href + '"' +
          (act ? ' aria-current="page"' : '') + '><i class="ph ' + m.icon + '" aria-hidden="true"></i>' +
          '<span class="pt-largo">' + esc(m.label) + '</span><span class="pt-corto">' + esc(m.corto) + '</span></a></div>';
      }).join('');
    }
    if (!acciones) return;
    acciones.innerHTML = '<div class="tb-grupo">' +
      '<button type="button" class="tb-btn" id="pt-avatar" aria-haspopup="true" aria-expanded="false" aria-controls="pt-menu" aria-label="Mi cuenta">' +
      '<span class="tb-avatar" aria-hidden="true" id="pt-inicial">·</span><i class="ph ph-caret-down tb-caret" aria-hidden="true"></i></button>' +
      '<div class="tb-menu" id="pt-menu" hidden><div class="tb-quien"><b id="pt-nombre"></b><span id="pt-tipo">Portal de facturación</span></div>' +
      '<button type="button" class="tb-item tb-peligro" id="pt-salir"><i class="ph ph-sign-out" aria-hidden="true"></i>Cerrar sesión</button></div></div>';
    window.__sesion.then(function (s) {
      if (!s.user) return;
      document.getElementById('pt-nombre').textContent = s.user.name;
      if (s.soloLectura) document.getElementById('pt-tipo').textContent = 'Portal de facturación · Solo lectura';
      document.getElementById('pt-inicial').textContent = (s.user.name.charAt(0) || '·').toUpperCase();
    });
    var btn = document.getElementById('pt-avatar'), menu = document.getElementById('pt-menu');
    function abrir(si) { btn.setAttribute('aria-expanded', String(si)); menu.hidden = !si; }
    btn.addEventListener('click', function () { abrir(menu.hidden); });
    document.addEventListener('click', function (e) { if (!acciones.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') abrir(false); });
    document.getElementById('pt-salir').addEventListener('click', function () {
      saliendo = true;
      fetchOriginal('/api/portal/logout', { method: 'POST', credentials: 'include' })
        .catch(function () {}).then(function () { location.replace(LOGIN); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintarCabecera);
  else pintarCabecera();
})();
