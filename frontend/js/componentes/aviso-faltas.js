/* aviso-faltas.js — avisos de «faltas en sus llamadas» (Monitoreo) en todas las páginas.
 *
 * Lo cargan js/layout/topbar-acciones.js (páginas con menú superior) y js/layout/sidebar.js
 * (páginas con menú lateral). Datos: routers/monitoreo.py.
 *
 * - Agente: con 3 faltas o más en la semana, ventana «Tienes N Faltas». Al pulsar
 *   «Entendido» queda vista (POST /api/monitoreo/mis-faltas/visto); una falta nueva la
 *   vuelve a mostrar.
 * - Administración: tarjeta por cada agente que llega a 3 faltas, para sacarlo de inbound.
 *   Se queda hasta cerrarla; cerrada, no vuelve salvo que el agente sume otra falta
 *   (lo cerrado se recuerda en este navegador).
 * - Llega al instante por el centro de notificaciones (js/core/notificaciones.js): el
 *   servidor publica un evento «faltas» al agente y a administración, y aquí se vuelve a
 *   pedir el dato. Solo si no hay conexión en vivo se consulta cada 20 s.
 * - Lo que se resuelve en una pestaña (Entendido, cerrar una tarjeta) se refleja en las
 *   demás del mismo navegador.
 */
(function () {
  'use strict';
  if (window.__avisoFaltas || window.PORTAL) return;
  window.__avisoFaltas = true;

  var INTERVALO_MS = 20000;
  var CLAVE_VISTAS = 'monitoreo-alertas-vistas';
  var modo = null;            // 'agente' | 'admin'
  var tSondeo = null;
  var parado = false;
  var dialogo = null;         // fondo de la ventana del agente, si está abierta

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  // Mismos roles que ADMIN_ROLES del backend (deps.py).
  function esAdmin(role) { var r = norm(role); return r === 'admin' || r === 'administrador' || r === 'administrativo' || r === 'administrator' || r === 'administrador general'; }

  function cargarCss() {
    if (document.querySelector('link[data-aviso-faltas]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/componentes/aviso-faltas.css?v=20261026b';
    l.setAttribute('data-aviso-faltas', '');
    document.head.appendChild(l);
  }

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function pedir(url, opts) {
    return fetch(url, Object.assign({ credentials: 'include' }, opts || {})).then(function (r) {
      if (r.status === 401 || r.status === 403) { parado = true; clearTimeout(tSondeo); return null; }
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }

  // ── Agente: ventana «Tienes N Faltas» ──────────────────────────────
  function revisarAgente() {
    pedir('/api/monitoreo/mis-faltas').then(function (d) {
      if (!d) return;
      if (d.aviso && !dialogo) mostrarDialogo(d.faltas);
      else if (!d.aviso && dialogo) cerrarDialogo();   // lo cerró en otra pestaña
    });
  }

  function cerrarDialogo() {
    var previo = dialogo && dialogo._previo;
    if (dialogo) dialogo.remove();
    dialogo = null;
    if (previo && previo.focus) previo.focus();
  }

  function mostrarDialogo(n) {
    var fondo = el('div', 'af-fondo');
    fondo._previo = document.activeElement;
    dialogo = fondo;
    var caja = el('div', 'af-dialogo');
    caja.setAttribute('role', 'alertdialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', 'af-titulo');
    caja.setAttribute('aria-describedby', 'af-texto');
    var ico = el('div', 'af-ico'); ico.setAttribute('aria-hidden', 'true'); ico.textContent = '!';
    var h = el('h2', 'af-titulo', 'Tienes ' + n + ' Faltas'); h.id = 'af-titulo';
    var p = el('p', 'af-texto', 'Esta semana se marcaron ' + n + ' faltas en tus llamadas. Habla con tu supervisor.');
    p.id = 'af-texto';
    var btn = el('button', 'af-boton', 'Entendido'); btn.type = 'button';
    btn.addEventListener('click', function () {
      pedir('/api/monitoreo/mis-faltas/visto', { method: 'POST' });
      cerrarDialogo();
    });
    // La ventana exige respuesta: el foco no sale del botón.
    caja.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); btn.focus(); } });
    caja.append(ico, h, p, btn);
    fondo.appendChild(caja);
    document.body.appendChild(fondo);
    btn.focus();
  }

  // ── Administración: tarjetas «Sacar de inbound» ────────────────────
  function vistas() {
    try { return JSON.parse(localStorage.getItem(CLAVE_VISTAS) || '[]') || []; } catch (_) { return []; }
  }
  function marcarVista(clave) {
    try {
      var v = vistas().filter(function (k) { return k !== clave; });
      v.push(clave);
      localStorage.setItem(CLAVE_VISTAS, JSON.stringify(v.slice(-200)));
    } catch (_) { /* sin almacenamiento: la tarjeta vuelve a salir al recargar */ }
  }

  function pila() {
    var p = document.querySelector('.af-pila');
    if (!p) {
      p = el('div', 'af-pila');
      p.setAttribute('role', 'region');
      p.setAttribute('aria-label', 'Alertas de faltas');
      p.setAttribute('aria-live', 'assertive');
      document.body.appendChild(p);
    }
    return p;
  }

  function revisarAdmin() {
    pedir('/api/monitoreo/alertas').then(function (d) {
      if (!d || !d.agentes) return;
      var ya = vistas();
      // Le quitaron faltas y ya no llega a 3: su tarjeta sobra.
      var siguen = d.agentes.map(function (a) { return String(a.id); });
      document.querySelectorAll('.af-alerta').forEach(function (t) {
        if (siguen.indexOf(t.getAttribute('data-agente')) < 0) t.remove();
      });
      d.agentes.forEach(function (a) {
        var clave = d.semana + ':' + a.id + ':' + a.faltas;
        if (ya.indexOf(clave) >= 0) return;
        var previa = document.querySelector('.af-alerta[data-agente="' + a.id + '"]');
        if (previa) {
          if (previa.getAttribute('data-clave') === clave) return;
          previa.remove();            // subió el número de faltas: se repinta
        }
        mostrarAlerta(a, clave);
      });
    });
  }

  function mostrarAlerta(a, clave) {
    var t = el('div', 'af-alerta');
    t.setAttribute('data-agente', a.id);
    t.setAttribute('data-clave', clave);
    var cab = el('div', 'af-alerta-cab', 'Sacar de inbound');
    var nom = el('div', 'af-alerta-nom');
    nom.append(el('b', null, a.username), document.createTextNode(' tiene ' + a.faltas + ' faltas'));
    // "TEAM IRANIA SERRANO" → "Team Irania Serrano"
    var team = el('div', 'af-alerta-team', 'Team ' + String(a.team || '').replace(/^\s*team\s+/i, '')
      .toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }));
    var ver = el('a', 'af-alerta-ver', 'Ver en Monitoreo');
    ver.href = '/residencial/monitoreo.html';
    var cerrar = el('button', 'af-alerta-x', '×');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar alerta de ' + a.username);
    cerrar.addEventListener('click', function () { marcarVista(clave); t.remove(); });
    ver.addEventListener('click', function () { marcarVista(clave); });
    t.append(cab, nom, team, ver, cerrar);
    pila().appendChild(t);
  }

  // Tarjeta cerrada en otra pestaña de este navegador: se quita aquí también.
  window.addEventListener('storage', function (e) {
    if (e.key !== CLAVE_VISTAS) return;
    var ya = vistas();
    document.querySelectorAll('.af-alerta').forEach(function (t) {
      if (ya.indexOf(t.getAttribute('data-clave')) >= 0) t.remove();
    });
  });

  // ── Cuándo revisar ─────────────────────────────────────────────────
  function revisar() {
    if (parado) return;
    if (modo === 'agente') revisarAgente();
    else if (modo === 'admin') revisarAdmin();
  }
  // Varias faltas seguidas (p. ej. tres en un minuto) → una sola consulta.
  var tPronto = null;
  function revisarPronto() { clearTimeout(tPronto); tPronto = setTimeout(revisar, 300); }
  function enVivo() { return !!(window.CRMNotificaciones && window.CRMNotificaciones.enVivo()); }
  // Respaldo sin conexión en vivo: cada 20 s, y solo con la pestaña a la vista.
  function programar() {
    clearTimeout(tSondeo);
    if (parado || enVivo()) return;
    tSondeo = setTimeout(function () { if (!document.hidden) revisar(); programar(); }, INTERVALO_MS);
  }

  function iniciar(sesion) {
    var u = sesion && sesion.user;
    if (!u) return;
    if (norm(u.role) === 'agente') modo = 'agente';
    else if (esAdmin(u.role)) modo = 'admin';
    else return;
    cargarCss();
    revisar();
    programar();
    var centro = window.CRMNotificaciones;
    if (centro) {
      // El evento llega a todas las pestañas, también a las de fondo: así la tarjeta ya
      // está ahí cuando el admin vuelve.
      centro.on('faltas', revisarPronto);
      // Al (re)conectar se revisa por si algo cambió mientras no había conexión.
      centro.onEstado(function (vivo) { if (vivo) revisar(); programar(); });
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !enVivo()) revisar(); });
  }

  function arrancar() {
    var sesion = window.__sesion || fetch('/api/auth/verify-server', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    Promise.resolve(sesion).then(iniciar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
