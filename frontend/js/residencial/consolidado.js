/**
 * Consolidado (residencial/consolidado.html). Datos: GET /api/consolidado?mes=YYYY-MM
 * (routers/consolidado.py): suma del puntaje de las ventas del mes por status.
 * - Consolidado total: una fila por team (su supervisor) y el total general.
 * - Consolidado por equipos: una tabla por team con una fila por agente.
 */
(function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var COLS = [
    { k: 'active', t: 'Active' },
    { k: 'pending', t: 'Pending' },
    { k: 'active_pending', t: 'Active + Pending', sum: true },
    { k: 'cancel', t: 'Cancel' },
    { k: 'hold', t: 'Hold' },
    { k: 'total', t: 'Suma total', tot: true },
  ];
  var hoy = new Date();
  var mes = { y: hoy.getFullYear(), m: hoy.getMonth() + 1 };   // se corrige con lo que diga el servidor
  var actual = null;

  var elTotal = document.getElementById('co-total');
  var elEquipos = document.getElementById('co-equipos');
  var elMes = document.getElementById('co-mes');
  var btnPrev = document.getElementById('co-prev');
  var btnNext = document.getElementById('co-next');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    return Number(n || 0).toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // "TEAM IRANIA SERRANO" → "Irania Serrano"
  function nombreTeam(t) {
    return String(t || '').replace(/^\s*team\s+/i, '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
  }
  function clave(m) { return m.y + '-' + String(m.m).padStart(2, '0'); }

  function celdas(f) {
    return COLS.map(function (c) {
      var v = Number(f[c.k] || 0);
      return '<td class="pg-n' + (c.sum ? ' co-sum' : '') + (c.tot ? ' co-tot' : '') + (v === 0 ? ' co-cero' : '') + '">' + num(v) + '</td>';
    }).join('');
  }
  function cabecera(primera) {
    return '<thead><tr><th scope="col" class="pg-izq">' + primera + '</th>' + COLS.map(function (c) {
      return '<th scope="col"' + (c.sum ? ' class="co-sum"' : '') + '>' + c.t + '</th>';
    }).join('') + '</tr></thead>';
  }
  function sumar(filas) {
    var t = {};
    COLS.forEach(function (c) { t[c.k] = filas.reduce(function (n, f) { return n + Number(f[c.k] || 0); }, 0); });
    return t;
  }

  function tablaTotal(filas) {
    if (!filas.length) return '<div class="pg-vacio">Sin ventas este mes</div>';
    return '<div class="pg-scroll"><table class="pg-tbl co-tbl">' + cabecera('Supervisor') + '<tbody>' +
      filas.map(function (f) {
        return '<tr><th scope="row" class="pg-izq">' + esc(f.supervisor) +
          // El team solo si no se llama como el supervisor (Eduardo Nuñez → Team Miguel Nuñez).
          (f.team && nombreTeam(f.team).toLowerCase() !== String(f.supervisor).toLowerCase()
            ? '<small>Team ' + esc(nombreTeam(f.team)) + '</small>' : '') + '</th>' + celdas(f) + '</tr>';
      }).join('') + '</tbody><tfoot><tr><th scope="row" class="pg-izq">Total</th>' + celdas(sumar(filas)) +
      '</tr></tfoot></table></div>';
  }

  function tablaEquipo(e) {
    var titulo = e.team ? nombreTeam(e.team) : e.supervisor;
    var cuerpo = e.agentes.length
      ? '<div class="pg-scroll"><table class="pg-tbl co-tbl">' + cabecera('Agente') + '<tbody>' +
          e.agentes.map(function (a) {
            return '<tr><th scope="row" class="pg-izq">' + esc(a.agente) + '</th>' + celdas(a) + '</tr>';
          }).join('') + '</tbody><tfoot><tr><th scope="row" class="pg-izq">Total del team</th>' + celdas(e.totales) +
          '</tr></tfoot></table></div>'
      : '<div class="pg-vacio">Sin agentes</div>';
    return '<section class="pg-card in-glass" aria-label="' + esc(titulo) + '">' +
      '<div class="pg-card-head"><div>' +
        '<h2><i class="ph ph-users-three" aria-hidden="true"></i>' + esc(titulo) + '</h2>' +
        '<p>Supervisor: ' + esc(e.supervisor) + '</p>' +
      '</div></div>' + cuerpo + '</section>';
  }

  function pintarMes() {
    elMes.textContent = MESES[mes.m - 1] + ' ' + mes.y;
    // No hay meses futuros que ver.
    btnNext.disabled = actual && clave(mes) >= actual;
  }

  function cargar() {
    pintarMes();
    elTotal.innerHTML = '<div class="pg-vacio">Cargando…</div>';
    fetch('/api/consolidado?mes=' + clave(mes), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        elTotal.innerHTML = tablaTotal(d.total || []);
        elEquipos.innerHTML = (d.equipos || []).map(tablaEquipo).join('') ||
          '<div class="pg-vacio in-glass">Sin equipos</div>';
      })
      .catch(function () {
        elTotal.innerHTML = '<div class="pg-vacio">No se pudo cargar el consolidado</div>';
        elEquipos.innerHTML = '';
      });
  }

  function mover(delta) {
    var m = mes.m + delta;
    mes = { y: mes.y + Math.floor((m - 1) / 12), m: ((m - 1) % 12 + 12) % 12 + 1 };
    cargar();
  }
  btnPrev.addEventListener('click', function () { mover(-1); });
  btnNext.addEventListener('click', function () { mover(1); });

  // El mes en curso lo fija el servidor (hora de El Salvador), no el reloj del equipo.
  fetch('/api/consolidado', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.mes) { actual = d.mes; mes = { y: +d.mes.slice(0, 4), m: +d.mes.slice(5, 7) }; }
      cargar();
    })
    .catch(cargar);
})();
