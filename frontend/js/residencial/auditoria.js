/**
 * Auditoría de llamadas (residencial/auditoria.html): muestra el auditor dentro del CRM.
 *  - En vivo → el revisor de la PC del auditor (http://localhost:8777/#vivo; en un marco oculta su cabecera).
 *  - Trasladar audio → el panel de /auditor/ con #subir: la grabación se transcribe en el servidor
 *    y queda guardada para todo Monitoreo.
 *  - Llamadas auditadas → el mismo panel (login propio).
 * Se recuerda la última pestaña.
 */
(function () {
  'use strict';
  var REVISOR = 'http://localhost:8777/';
  var AREAS = { vivo: REVISOR + '#vivo', tras: '/auditor/#subir', panel: '/auditor/' };
  var frame = document.getElementById('au-frame');
  var panel = document.getElementById('au-area');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.au-tab'));
  // En línea el panel va detrás del nginx de connecting.lat (/auditor/). En el CRM local se usa
  // el panel de prueba (Reintento/auditor/panel/prueba_local.sh, puerto 8010).
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (LOCAL) { AREAS.panel = 'http://localhost:8010/'; AREAS.tras = AREAS.panel + '#subir'; }

  function ir(tab, foco) {
    var area = tab.getAttribute('data-area');
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tab.id);
    frame.src = AREAS[area];
    if (foco) tab.focus();
    try { localStorage.setItem('crm-auditoria-area', area); } catch (e) {}
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { ir(t); });
    t.addEventListener('keydown', function (e) {
      var k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      ir(tabs[(i + k + tabs.length) % tabs.length], true);
    });
  });
  var guardada = null;
  try { guardada = localStorage.getItem('crm-auditoria-area'); } catch (e) {}
  ir(tabs.filter(function (t) { return t.getAttribute('data-area') === guardada; })[0] || tabs[1]);
})();
