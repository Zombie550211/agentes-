/* estadisticas-ventas.js — cuadro «Ventas» de Estadísticas (residencial/estadisticas.html).
 *
 * Ventas por team del DÍA (por defecto) o del MES, con pestañas y flechas ‹ › para elegir
 * cualquier día o mes anterior (botón Hoy / Este mes para volver). Residencial: ventas, ICON,
 * BAMO y puntos; Líneas móviles: ventas, ICON, BAMO y líneas. Sin canceladas ni repro.
 * Se refresca solo cuando cambian ventas (CRMRealtime 'residencial' y 'lineas') y cada 2 min.
 * API: CRM_PYTHON/routers/estadisticas.py → GET /api/estadisticas/ventas.
 */
(function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
               'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var $ = function (id) { return document.getElementById(id); };
  var periodo = 'dia';
  var dia = '';        // fecha elegida (YYYY-MM-DD); vacío = hoy
  var hoySrv = '';     // «hoy» según el servidor (hora de El Salvador)
  var pidiendo = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nombreTeam(t) { return String(t).replace(/^TEAM\s+(L[IÍ]NEAS\s+)?/i, ''); }
  function num(n, dec) { return n ? (dec ? Number(n).toFixed(2) : String(n)) : '<span class="es-cero">–</span>'; }
  function fecha(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(f) {
    return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  }
  function hoyISO() { return hoySrv || iso(new Date()); }

  function cargar() {
    var yo = ++pidiendo;
    return fetch('/api/estadisticas/ventas?periodo=' + periodo + (dia ? '&fecha=' + dia : ''), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { if (yo === pidiendo) pintar(d); })
      .catch(function () {
        if (yo !== pidiendo) return;
        $('es-ven-cuerpo').innerHTML = '<div class="es-estado">No se pudieron cargar las ventas. Recarga la página.</div>';
      });
  }

  function pintar(d) {
    var f = fecha(d.fecha);
    if (d.hoy) hoySrv = d.hoy;
    var h0 = fecha(hoyISO());
    var actual = d.periodo === 'dia' ? d.fecha >= hoyISO()
      : (f.getFullYear() > h0.getFullYear() || (f.getFullYear() === h0.getFullYear() && f.getMonth() >= h0.getMonth()));
    $('es-ven-sub').textContent = d.periodo === 'dia'
      ? (d.fecha === d.hoy ? 'Hoy, ' : '') + f.getDate() + ' de ' + MESES[f.getMonth()] + ' ' + f.getFullYear()
      : 'Mes de ' + MESES[f.getMonth()] + ' ' + f.getFullYear();
    $('es-ven-rango').textContent = d.periodo === 'dia'
      ? f.getDate() + ' ' + MESES[f.getMonth()].slice(0, 3) + ' ' + f.getFullYear()
      : MESES[f.getMonth()].charAt(0).toUpperCase() + MESES[f.getMonth()].slice(1) + ' ' + f.getFullYear();
    $('es-ven-next').disabled = actual;
    $('es-ven-hoy').disabled = actual;
    $('es-ven-hoy').textContent = d.periodo === 'dia' ? 'Hoy' : 'Este mes';

    var grupos = { residencial: [], lineas: [] };
    d.teams.forEach(function (t) { (grupos[t.seccion] || grupos.residencial).push(t); });
    var maxV = d.teams.reduce(function (m, t) { return Math.max(m, t.ventas); }, 0);

    window.ESTeam.registrar(d.teams);
    var T = window.ESTeam;
    var h = '<table class="es-tabla es-ventas"><thead><tr>' +
      '<th scope="col" class="es-col-team">Team</th><th scope="col" class="es-col-barra">Ventas</th>' +
      '<th scope="col">ICON</th><th scope="col">BAMO</th><th scope="col">Puntos</th></tr></thead>';
    var tot = { ventas: 0, icon: 0, bamo: 0, puntos: 0, lineas: 0 };

    [['residencial', 'Residencial'], ['lineas', 'Líneas móviles']].forEach(function (g) {
      var filas = grupos[g[0]];
      if (!filas.length) return;
      var esLin = g[0] === 'lineas';
      h += '<tbody><tr class="es-sec"><th scope="colgroup" colspan="5">' + g[1] +
        (esLin ? ' <span>(última columna: líneas)</span>' : '') + '</th></tr>';
      var sub = { ventas: 0, icon: 0, bamo: 0, puntos: 0, lineas: 0 };
      filas.forEach(function (t) {
        ['ventas', 'icon', 'bamo', 'puntos', 'lineas'].forEach(function (k) { tot[k] += t[k]; sub[k] += t[k]; });
        var pct = maxV ? Math.max(t.ventas ? 4 : 0, Math.round(t.ventas * 100 / maxV)) : 0;
        h += '<tr' + (t.ventas ? '' : ' class="es-sin"') + '>' + T.celda(t.team) +
          '<td class="es-col-barra"><span class="es-barra">' +
            '<span class="es-barra-n">' + t.ventas + '</span>' +
            '<span class="es-barra-t" aria-hidden="true"><span style="width:' + pct + '%"></span></span></span></td>' +
          '<td>' + num(t.icon) + '</td><td>' + num(t.bamo) + '</td>' +
          '<td>' + (esLin ? num(t.lineas) : num(t.puntos, true)) + '</td></tr>';
      });
      h += '<tr class="es-subtotal"><th scope="row" class="es-col-team">Total ' + g[1].toLowerCase() + '</th>' +
        '<td class="es-col-barra">' + sub.ventas + '</td><td>' + sub.icon + '</td><td>' + sub.bamo + '</td>' +
        '<td>' + (esLin ? sub.lineas + ' <small>' + (sub.lineas === 1 ? 'línea' : 'líneas') + '</small>' : sub.puntos.toFixed(2)) + '</td></tr></tbody>';
    });
    // Total general: ventas, ICON y BAMO de ambos; puntos (Residencial) y líneas (Líneas) por separado.
    h += '<tfoot><tr><th scope="row" class="es-col-team">Total general</th>' +
      '<td class="es-col-barra">' + tot.ventas + '</td><td>' + tot.icon + '</td><td>' + tot.bamo + '</td>' +
      '<td class="es-doble">' + tot.puntos.toFixed(2) + '<small>' + tot.lineas + (tot.lineas === 1 ? ' línea' : ' líneas') + '</small></td></tr></tfoot></table>';

    $('es-ven-cuerpo').innerHTML = d.teams.length ? h : '<div class="es-vacio">No hay equipos de venta.</div>';
    $('es-ven-estado').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }

  function elegir(p) {
    if (p === periodo) return;
    periodo = p;
    ['dia', 'mes'].forEach(function (x) {
      var b = $('es-ven-' + x), on = x === p;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $('es-ven-cuerpo').setAttribute('aria-labelledby', 'es-ven-' + p);
    var mesTxt = p === 'dia' ? 'Día' : 'Mes';
    $('es-ven-prev').setAttribute('aria-label', mesTxt + ' anterior');
    $('es-ven-next').setAttribute('aria-label', mesTxt + ' siguiente');
    cargar();
  }

  // Día: avanza/retrocede un día. Mes: un mes (queda en el día 1; al llegar al mes actual vuelve a hoy).
  function mover(n) {
    var f = fecha(dia || hoyISO());
    if (periodo === 'dia') f.setDate(f.getDate() + n);
    else { f.setDate(1); f.setMonth(f.getMonth() + n); }
    var x = iso(f), h = hoyISO();
    dia = (periodo === 'dia' ? x >= h : x.slice(0, 7) >= h.slice(0, 7)) ? '' : x;
    cargar();
  }

  var espera = null;
  function refrescar() {   // varios cambios seguidos → una sola consulta
    clearTimeout(espera);
    espera = setTimeout(function () { if (!document.hidden) cargar(); }, 800);
  }

  function iniciar() {
    $('es-ven-dia').addEventListener('click', function () { elegir('dia'); });
    $('es-ven-mes').addEventListener('click', function () { elegir('mes'); });
    $('es-ven-prev').addEventListener('click', function () { mover(-1); });
    $('es-ven-next').addEventListener('click', function () { mover(1); });
    $('es-ven-hoy').addEventListener('click', function () { if (dia) { dia = ''; cargar(); } });
    document.querySelector('.es-tabs[aria-label="Periodo de ventas"]').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var p = periodo === 'dia' ? 'mes' : 'dia';
      elegir(p); $('es-ven-' + p).focus();
    });
    if (window.CRMRealtime) {
      window.CRMRealtime.connect('residencial', refrescar);
      window.CRMRealtime.connect('lineas', refrescar);
    }
    setInterval(function () { if (!document.hidden) cargar(); }, 120000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
