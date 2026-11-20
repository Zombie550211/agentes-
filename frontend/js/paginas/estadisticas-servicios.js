/* estadisticas-servicios.js — «Desglose por servicio» de Estadísticas (residencial/estadisticas.html).
 *
 * Un mes (el actual por defecto) día por día: cuántas ventas tuvo cada servicio cada día,
 * de un mercado a la vez (botones ICON / BAMO), con el total de cada día al final. ‹ › cambia de mes. La tabla se desplaza a lo
 * ancho por dentro; el servicio y el total del mes quedan fijos a los lados.
 * Se refresca solo cuando cambian ventas (CRMRealtime 'residencial').
 * API: CRM_PYTHON/routers/estadisticas.py → GET /api/estadisticas/servicios?mes=YYYY-MM.
 */
(function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
               'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var INI = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  var MERCADOS = [['icon', 'ICON'], ['bamo', 'BAMO']];
  var merc = 'icon';     // mercado elegido con los botones
  var $ = function (id) { return document.getElementById(id); };
  var mes = '';          // '' = mes actual
  var datos = null;
  var pidiendo = 0;
  var scrollX = null;    // conserva el desplazamiento al refrescar
  var ultimaTabla = '';  // HTML de la tabla, para el modal «Expandir»

  function esc(s) { return window.ESTeam ? window.ESTeam.esc(s) : String(s); }
  function num(n) { return n ? String(n) : ''; }

  function cargar() {
    var yo = ++pidiendo;
    return fetch('/api/estadisticas/servicios' + (mes ? '?mes=' + mes : ''), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { if (yo === pidiendo) { datos = d; pintar(); } })
      .catch(function () {
        if (yo === pidiendo) $('es-svc-cuerpo').innerHTML = '<div class="es-estado">No se pudo cargar el desglose. Recarga la página.</div>';
      });
  }

  function pintar() {
    var d = datos, y = +d.mes.slice(0, 4), m = +d.mes.slice(5, 7), n = d.dias;
    var hoyMes = d.hoy.slice(0, 7), hoyDia = +d.hoy.slice(8, 10);
    var esActual = d.mes === hoyMes;
    $('es-svc-mes').textContent = MESES[m - 1] + ' ' + y;
    $('es-svc-next').disabled = d.mes >= hoyMes;

    function claseDia(i) {
      var c = [], dow = new Date(y, m - 1, i).getDay();
      if (dow === 0 || dow === 6) c.push('es-finde');
      if (esActual && i === hoyDia) c.push('es-hoy-col');
      if (esActual && i > hoyDia) c.push('es-futuro');
      return c.length ? ' class="' + c.join(' ') + '"' : '';
    }
    function celdas(porDia, negrita) {
      var h = '', t = 0;
      for (var i = 1; i <= n; i++) { var v = porDia[i] || 0; t += v; h += '<td' + claseDia(i) + '>' + num(v) + '</td>'; }
      return h + '<td class="es-col-total">' + (negrita ? t : num(t) || '<span class="es-cero">–</span>') + '</td>';
    }

    var h = '<table class="es-tabla es-svcmes"><thead><tr><th scope="col" class="es-col-team">Servicio</th>';
    for (var i = 1; i <= n; i++) {
      h += '<th scope="col"' + claseDia(i) + (esActual && i === hoyDia ? ' aria-current="date"' : '') + '><span class="es-dia">' +
        INI[new Date(y, m - 1, i).getDay()] + '</span>' + i + '</th>';
    }
    h += '<th scope="col" class="es-col-total">Mes</th></tr></thead>';

    // Solo el mercado elegido con los botones ICON / BAMO.
    var mk = MERCADOS.filter(function (x) { return x[0] === merc; })[0];
    var total = {};
    var filas = d.servicios.map(function (s) {
      var porDia = {}, tot = 0;
      Object.keys(s.dias).forEach(function (dia) { var v = s.dias[dia][merc] || 0; if (v) { porDia[dia] = v; tot += v; } });
      return { servicio: s.servicio, porDia: porDia, tot: tot };
    }).filter(function (f) { return f.tot > 0; })
      .sort(function (a, b) { return (b.tot - a.tot) || a.servicio.localeCompare(b.servicio); });
    var hay = filas.length > 0;
    h += '<tbody>';
    filas.forEach(function (f) {
      Object.keys(f.porDia).forEach(function (dia) { total[dia] = (total[dia] || 0) + f.porDia[dia]; });
      h += '<tr><th scope="row" class="es-col-team" title="' + esc(f.servicio) + '"><span class="es-nom">' + esc(f.servicio) + '</span></th>' + celdas(f.porDia) + '</tr>';
    });
    h += '</tbody><tfoot><tr><th scope="row" class="es-col-team">Total ' + mk[1] + '</th>' + celdas(total, true) + '</tr></tfoot></table>';

    var wrap = $('es-svc-cuerpo');
    if (!hay) {
      wrap.innerHTML = '<div class="es-vacio">No hay ventas de ' + mk[1] + ' en ' + MESES[m - 1].toLowerCase() + ' todavía.</div>';
      ultimaTabla = wrap.innerHTML;
      $('es-svc-estado').textContent = '';
      return;
    }
    var prev = wrap.querySelector('.es-svcmes') ? wrap.scrollLeft : null;
    wrap.innerHTML = h;
    ultimaTabla = h;
    var dlg = $('es-svc-dlg');
    if (dlg && dlg.open) llenarModal();
    // Mes actual: que se vea el día de hoy. Al refrescar: donde estaba.
    if (prev != null && scrollX === d.mes) wrap.scrollLeft = prev;
    else {
      var hoyTh = wrap.querySelector('thead .es-hoy-col');
      if (hoyTh) wrap.scrollLeft = Math.max(0, hoyTh.offsetLeft - wrap.clientWidth + 120);
    }
    scrollX = d.mes;
    var nSv = filas.length;
    $('es-svc-estado').textContent = nSv + (nSv === 1 ? ' servicio' : ' servicios') + ' · actualizado ' +
      new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }

  // Modal «Expandir»: la misma tabla a casi toda la pantalla (sigue con encabezado y total fijos).
  function llenarModal() {
    var c = $('es-svc-dlg-cuerpo'), y = c.scrollTop, x = c.scrollLeft;
    c.innerHTML = ultimaTabla || '<div class="es-estado">Cargando…</div>';
    c.scrollTop = y; c.scrollLeft = x;
    $('es-svc-dlg-sub').textContent = (merc === 'icon' ? 'ICON' : 'BAMO') + ' · ' + $('es-svc-mes').textContent + ' · ' + $('es-svc-estado').textContent;
  }
  function abrirModal() {
    var dlg = $('es-svc-dlg');
    if (!dlg || !dlg.showModal) return;
    llenarModal();
    dlg.showModal();
    $('es-svc-dlg-cuerpo').scrollTop = 0;
  }

  function mover(nm) {
    var y = +datos.mes.slice(0, 4), m = +datos.mes.slice(5, 7) + nm;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    mes = y + '-' + String(m).padStart(2, '0');
    if (mes >= datos.hoy.slice(0, 7)) mes = '';
    cargar();
  }

  var espera = null;
  function refrescar() { clearTimeout(espera); espera = setTimeout(function () { if (!document.hidden) cargar(); }, 800); }

  function iniciar() {
    $('es-svc-prev').addEventListener('click', function () { mover(-1); });
    $('es-svc-next').addEventListener('click', function () { mover(1); });
    $('es-svc-expandir').addEventListener('click', abrirModal);
    var botones = document.querySelectorAll('#es-svc-merc .es-tab');
    function elegirMerc(k, foco) {
      merc = k;
      botones.forEach(function (b) {
        var on = b.dataset.merc === k;
        b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
        if (on && foco) b.focus();
      });
      scrollX = null;
      if (datos) pintar();
    }
    botones.forEach(function (b) { b.addEventListener('click', function () { elegirMerc(b.dataset.merc); }); });
    $('es-svc-merc').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') elegirMerc(merc === 'icon' ? 'bamo' : 'icon', true);
    });
    $('es-svc-dlg-cerrar').addEventListener('click', function () { $('es-svc-dlg').close(); });
    $('es-svc-dlg').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('es-svc-dlg').addEventListener('close', function () { $('es-svc-expandir').focus(); });
    if (window.CRMRealtime) window.CRMRealtime.connect('residencial', refrescar);
    setInterval(function () { if (!document.hidden) cargar(); }, 120000);
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
