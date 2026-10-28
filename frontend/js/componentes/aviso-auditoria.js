/* aviso-auditoria.js — aviso a los auditores de cada hallazgo nuevo del auditor de llamadas.
 *
 * Lo cargan js/layout/topbar-acciones.js y js/layout/sidebar.js en todas las páginas, pero
 * solo hace algo para los auditores (sesión con user.auditor; ver routers/auditoria.py).
 * Al llegar un evento «auditoria» con falta del centro de notificaciones (js/core/notificaciones.js)
 * pide las faltas de hoy (GET /api/auditoria/hallazgos) y saca una tarjeta por cada una
 * nueva que este navegador aún no ha mostrado, con enlace a su llamada. En la página de auditoría no hace falta: allí la tabla ya se actualiza.
 * Sin conexión en vivo se consulta cada 30 s. Usa las tarjetas de css/componentes/aviso-faltas.css.
 */
(function () {
  'use strict';
  if (window.__avisoAuditoria || window.PORTAL) return;
  window.__avisoAuditoria = true;
  if (location.pathname.indexOf('/residencial/auditoria') === 0) return;

  var CLAVE = 'auditoria-ultimo-aviso';
  var INTERVALO_MS = 30000;

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function ultimo() { try { return Number(localStorage.getItem(CLAVE) || 0); } catch (_) { return 0; } }
  function guardar(id) { try { localStorage.setItem(CLAVE, String(id)); } catch (_) { /* sin almacenamiento */ } }

  function cargarCss() {
    if (document.querySelector('link[data-aviso-faltas]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/componentes/aviso-faltas.css?v=20261026b';
    l.setAttribute('data-aviso-faltas', '');
    document.head.appendChild(l);
  }

  function pila() {
    var p = document.querySelector('.af-pila');
    if (!p) {
      p = el('div', 'af-pila');
      p.setAttribute('role', 'region');
      p.setAttribute('aria-label', 'Alertas');
      p.setAttribute('aria-live', 'assertive');
      document.body.appendChild(p);
    }
    return p;
  }

  function tarjeta(h) {
    var t = el('div', 'af-alerta');
    var cab = el('div', 'af-alerta-cab', 'Auditoría · ' + h.regla + ' ' + h.detalle);
    var nom = el('div', 'af-alerta-nom');
    nom.append(el('b', null, h.agente || 'Agente sin identificar'), document.createTextNode(': «' + h.frase.slice(0, 120) + (h.frase.length > 120 ? '…' : '') + '»'));
    var ver = el('a', 'af-alerta-ver', 'Ver la llamada');
    ver.href = '/residencial/auditoria.html#' + h.llamada;
    var cerrar = el('button', 'af-alerta-x', '×');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar aviso de auditoría de ' + (h.agente || 'agente sin identificar'));
    cerrar.addEventListener('click', function () { t.remove(); });
    t.append(cab, nom, ver, cerrar);
    pila().appendChild(t);
  }

  var primera = true;
  function revisar() {
    fetch('/api/auditoria/hallazgos?dias=1', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.hallazgos) return;
        var visto = ultimo();
        var max = d.hallazgos.reduce(function (m, h) { return Math.max(m, Number(h.id)); }, visto);
        // La primera vez en este navegador no se avisa de lo que ya había.
        if (!(primera && !visto)) {
          d.hallazgos.filter(function (h) { return Number(h.id) > visto && h.estado === 'nuevo'; })
            .slice(0, 5).reverse().forEach(tarjeta);
        }
        primera = false;
        if (max > visto) guardar(max);
      }).catch(function () { /* se reintenta con el siguiente aviso */ });
  }

  Promise.resolve(window.__sesion || fetch('/api/auth/verify-server', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }))
    .then(function (s) {
      if (!(s && s.user && s.user.auditor)) return;
      cargarCss();
      revisar();
      var tPronto = null;
      if (window.CRMNotificaciones) {
        window.CRMNotificaciones.on('auditoria', function (ev) {
          if (!ev.falta) return;      // frases sin falta: solo le interesan a la página de auditoría
          clearTimeout(tPronto); tPronto = setTimeout(revisar, 300);
        });
      }
      setInterval(function () {
        if (!document.hidden && !(window.CRMNotificaciones && window.CRMNotificaciones.enVivo())) revisar();
      }, INTERVALO_MS);
    });
})();
