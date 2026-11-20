/* estadisticas-calis.js — tabla «Calis del día» de Estadísticas (residencial/estadisticas.html).
 *
 * Filas = teams de venta (Residencial y Líneas móviles); columnas ICON y BAMO (editables) y
 * Total, del día que se ve (hoy por defecto; ‹ › cambia de día). El API trae la semana de ese día y aquí se muestra solo él.
 * Cada casilla se guarda sola (PUT /api/calis) al salir de ella o con Enter; vacía = sin dato.
 * Teclado como en una hoja: Enter / ↓ baja, ↑ sube (en el mismo mercado), Tab avanza, Esc deshace.
 * Si otra persona edita, llega el evento «calis» por el centro de notificaciones y se recarga.
 * API: CRM_PYTHON/routers/calis.py.
 */
(function () {
  'use strict';

  var DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var $ = function (id) { return document.getElementById(id); };

  var datos = null;      // respuesta de GET /api/calis
  var dia = '';          // día consultado ('' = hoy)
  var diaVisto = '';     // el que se está mostrando (YYYY-MM-DD)
  var editando = false;  // no recargar mientras alguien escribe

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fecha(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function isoDe(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function sumaDias(iso, n) { var d = fecha(iso); d.setDate(d.getDate() + n); return isoDe(d); }
  function nombreTeam(t) { return t.replace(/^TEAM\s+(L[IÍ]NEAS\s+)?/i, ''); }

  function estado(msg, error) {
    var el = $('es-calis-estado');
    el.textContent = msg || '';
    el.style.color = error ? '#c81a27' : '';
  }

  function cargar() {
    var url = '/api/calis' + (dia ? '?semana=' + dia : '');
    return fetch(url, { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { datos = d; pintar(); })
      .catch(function () {
        $('es-calis-cuerpo').innerHTML = '<div class="es-estado">No se pudieron cargar los calis. Recarga la página.</div>';
      });
  }

  function pintar() {
    var d = datos;
    diaVisto = dia || d.hoy;
    var dias = [diaVisto], f = fecha(diaVisto), esHoy = diaVisto === d.hoy;
    var nomDia = DIAS[(f.getDay() + 6) % 7];
    $('es-calis-rango').textContent = (esHoy ? 'Hoy' : nomDia) + ', ' + f.getDate() + ' ' + MESES[f.getMonth()];
    $('es-calis-hoy').disabled = esHoy;
    $('es-calis-next').disabled = diaVisto >= d.hoy;

    if (!d.teams.length) {
      $('es-calis-cuerpo').innerHTML = '<div class="es-vacio">No hay equipos de venta.</div>';
      return;
    }
    var algunaEditable = d.teams.some(function (t) { return t.editable; });
    $('es-calis-ayuda').textContent = algunaEditable ? 'Escribe las calis de cada team por mercado' : 'Calis de cada team por mercado';

    window.ESTeam.registrar(d.teams);
    var MERC = ['ICON', 'BAMO'];
    var h = '<table class="es-tabla es-calis"><thead><tr><th scope="col" class="es-col-team">Team</th>' +
      '<th scope="col" class="es-col-cali">ICON</th><th scope="col" class="es-col-cali">BAMO</th>' +
      '<th scope="col" class="es-col-tot">Total</th></tr></thead>';

    var fila = 0, iso = diaVisto;
    [['residencial', 'Residencial'], ['lineas', 'Líneas móviles']].forEach(function (g) {
      var teams = d.teams.filter(function (t) { return (t.seccion === 'lineas' ? 'lineas' : 'residencial') === g[0]; });
      if (!teams.length) return;
      h += '<tbody><tr class="es-sec"><th colspan="4" scope="colgroup">' + g[1] + '</th></tr>';
      teams.forEach(function (t) {
        var del = t.valores[iso] || {};
        h += '<tr>' + window.ESTeam.celda(t.team);
        MERC.forEach(function (mk) {
          var v = del[mk];
          h += '<td class="es-col-cali"><input class="es-cali" type="number" inputmode="numeric" min="0" step="1"' +
            ' data-team="' + esc(t.team) + '" data-fecha="' + iso + '" data-fila="' + fila + '" data-col="' + mk + '" data-sec="' + g[0] + '"' +
            ' value="' + (v != null ? v : '') + '" data-guardado="' + (v != null ? v : '') + '"' +
            ' aria-label="Calis ' + mk + ' de ' + esc(window.ESTeam.nombre(t.team)) + ', ' + nomDia + ' ' + f.getDate() + '"' +
            (t.editable ? ' placeholder="–"' : ' disabled placeholder="–"') + '></td>';
        });
        h += '<td class="es-col-tot" data-total-fila="' + fila + '"></td></tr>';
        fila++;
      });
      h += '<tr class="es-subtotal"><th scope="row" class="es-col-team">Total ' + g[1].toLowerCase() + '</th>' +
        '<td class="es-col-cali" data-sub="' + g[0] + '" data-col-sub="ICON"></td>' +
        '<td class="es-col-cali" data-sub="' + g[0] + '" data-col-sub="BAMO"></td>' +
        '<td class="es-col-tot" data-sub="' + g[0] + '" data-col-sub="t"></td></tr></tbody>';
    });
    h += '<tfoot><tr><th scope="row" class="es-col-team">Total general</th>' +
      '<td class="es-col-cali" data-total-col="ICON"></td><td class="es-col-cali" data-total-col="BAMO"></td>' +
      '<td class="es-col-tot" data-total-col="t"></td></tr></tfoot></table>';
    $('es-calis-cuerpo').innerHTML = h;
    totales();
  }

  // Recalcula los totales (por team, por sección y general; por mercado y juntos) con lo escrito.
  function totales() {
    var cuerpo = $('es-calis-cuerpo'), cols = { ICON: 0, BAMO: 0, t: 0 }, filas = {}, subs = {};
    cuerpo.querySelectorAll('.es-cali').forEach(function (inp) {
      var n = parseInt(inp.value, 10);
      if (isNaN(n)) return;
      cols[inp.dataset.col] += n; cols.t += n;
      filas[inp.dataset.fila] = (filas[inp.dataset.fila] || 0) + n;
      var sb = subs[inp.dataset.sec] = subs[inp.dataset.sec] || { ICON: 0, BAMO: 0, t: 0 };
      sb[inp.dataset.col] += n; sb.t += n;
    });
    cuerpo.querySelectorAll('[data-sub]').forEach(function (td) {
      td.textContent = (subs[td.dataset.sub] || {})[td.dataset.colSub] || 0;
    });
    cuerpo.querySelectorAll('[data-total-fila]').forEach(function (td) { td.textContent = filas[td.dataset.totalFila] || 0; });
    cuerpo.querySelectorAll('[data-total-col]').forEach(function (td) { td.textContent = cols[td.dataset.totalCol] || 0; });
  }

  function guardar(inp) {
    var txt = inp.value.trim();
    if (txt === inp.dataset.guardado || txt === inp.dataset.enviando) return;
    var n = txt === '' ? null : parseInt(txt, 10);
    if (txt !== '' && (isNaN(n) || n < 0 || String(n) !== txt.replace(/^0+(?=\d)/, ''))) {
      inp.classList.add('es-err');
      estado('Solo números enteros, sin decimales ni negativos.', true);
      return;
    }
    inp.classList.remove('es-err', 'es-ok');
    estado('Guardando…');
    inp.dataset.enviando = txt;
    fetch('/api/calis', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: inp.dataset.team, fecha: inp.dataset.fecha, mercado: inp.dataset.col, cantidad: n })
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) { throw new Error(e.detail || 'Error ' + r.status); });
      inp.dataset.guardado = n == null ? '' : String(n);
      inp.value = inp.dataset.guardado;
      inp.classList.add('es-ok');
      setTimeout(function () { inp.classList.remove('es-ok'); }, 900);
      estado('Guardado ' + new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }));
      totales();
    }).catch(function (e) {
      inp.classList.add('es-err');
      estado('No se guardó: ' + (typeof e.message === 'string' ? e.message : 'error'), true);
    }).then(function () { delete inp.dataset.enviando; });
  }

  function mover(inp, df) {
    var sig = $('es-calis-cuerpo').querySelector('.es-cali[data-fila="' + (+inp.dataset.fila + df) + '"][data-col="' + inp.dataset.col + '"]:not(:disabled)');
    if (sig) { sig.focus(); sig.select(); }
  }

  function enlazar() {
    var cuerpo = $('es-calis-cuerpo');
    cuerpo.addEventListener('focusin', function (e) { if (e.target.classList.contains('es-cali')) { editando = true; e.target.select(); } });
    cuerpo.addEventListener('focusout', function (e) {
      if (!e.target.classList.contains('es-cali')) return;
      editando = false;
      clearTimeout(e.target._tGuardar);
      guardar(e.target);
    });
    // Si cierran o cambian de página con algo sin guardar, se manda igual (keepalive).
    window.addEventListener('pagehide', function () {
      cuerpo.querySelectorAll('.es-cali').forEach(function (inp) {
        var txt = inp.value.trim();
        if (txt === inp.dataset.guardado || !/^\d+$/.test(txt) && txt !== '') return;
        try {
          fetch('/api/calis', { method: 'PUT', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team: inp.dataset.team, fecha: inp.dataset.fecha, mercado: inp.dataset.col, cantidad: txt === '' ? null : +txt }) });
        } catch (_) {}
      });
    });
    // Se guarda también mientras se escribe (0,7 s después de la última tecla): antes solo al salir
    // de la casilla o con Enter, y quien escribía y cerraba la página perdía el dato (20-nov).
    cuerpo.addEventListener('input', function (e) {
      var inp = e.target;
      if (!inp.classList.contains('es-cali')) return;
      inp.classList.remove('es-err');
      totales();
      clearTimeout(inp._tGuardar);
      inp._tGuardar = setTimeout(function () { guardar(inp); }, 700);
    });
    cuerpo.addEventListener('keydown', function (e) {
      var inp = e.target;
      if (!inp.classList.contains('es-cali')) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); clearTimeout(inp._tGuardar); guardar(inp); mover(inp, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); clearTimeout(inp._tGuardar); guardar(inp); mover(inp, -1); }
      else if (e.key === 'Escape') { inp.value = inp.dataset.guardado; inp.classList.remove('es-err'); totales(); inp.blur(); }
    });
    // La rueda del ratón no debe cambiar el número por accidente.
    cuerpo.addEventListener('wheel', function (e) { if (e.target === document.activeElement && e.target.classList.contains('es-cali')) e.target.blur(); }, { passive: true });

    function irA(n) { dia = sumaDias(diaVisto, n); if (dia >= datos.hoy) dia = ''; cargar(); }
    $('es-calis-prev').addEventListener('click', function () { irA(-1); });
    $('es-calis-next').addEventListener('click', function () { irA(1); });
    $('es-calis-hoy').addEventListener('click', function () { dia = ''; cargar(); });

    // Cambios de otras personas: recargar si no estoy escribiendo y es el día que veo.
    var pendiente = false;
    function refrescar(ev) {
      if (!datos || (ev && ev.fecha && ev.fecha !== diaVisto)) return;
      if (editando) { pendiente = true; return; }
      cargar();
    }
    cuerpo.addEventListener('focusout', function () { if (pendiente) { pendiente = false; setTimeout(function () { if (!editando) cargar(); }, 300); } });
    // El centro de notificaciones lo carga topbar-acciones.js después de esta página: se espera a
    // que exista para escuchar «calis» (antes se preguntaba una sola vez, muy pronto, y nunca
    // quedaba escuchando: lo que escribía otra persona no se veía sin recargar).
    (function escuchar(intentos) {
      if (window.CRMNotificaciones) { window.CRMNotificaciones.on('calis', refrescar); return; }
      if (intentos > 0) setTimeout(function () { escuchar(intentos - 1); }, 500);
    })(60);
    // Respaldo: cada 30 s, aunque haya conexión en vivo (es una consulta pequeña).
    setInterval(function () { if (!document.hidden) refrescar(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
  }

  function iniciar() { enlazar(); cargar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
