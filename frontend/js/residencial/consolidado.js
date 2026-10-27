/**
 * Consolidado (residencial/consolidado.html). Datos: GET /api/consolidado?mes=YYYY-MM
 * (routers/consolidado.py): suma del puntaje de las ventas del mes por status.
 * - Consolidado total: una fila por team (su supervisor) y el total general.
 * - Consolidado por equipos: una tabla por team con una fila por agente.
 * Admin y back office ven todos los teams; los demás solo el suyo (lo filtra el servidor).
 * Cada tabla se ordena tocando el encabezado de una columna.
 */
(function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // st: color del status en el encabezado (css/residencial/consolidado.css).
  var COLS = [
    { k: 'active', t: 'Active', st: 'active' },
    { k: 'pending', t: 'Pending', st: 'pending' },
    { k: 'active_pending', t: 'Active + Pending', sum: true },
    { k: 'cancel', t: 'Cancel', st: 'cancel' },
    { k: 'hold', t: 'Hold', st: 'hold' },
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
  // ── Tablas ordenables ─────────────────────────────────────────────
  // Sin orden al cargar (por nombre, como viene del servidor). Al tocar un encabezado esa
  // tabla se ordena por esa columna de mayor a menor; tocarlo otra vez lo invierte. Cada
  // tabla guarda su propio orden.
  var tablas = [];   // { filas, primera, nombre(f) → html, pie → html, col, dir }

  function ordenadas(t) {
    if (!t.col) return t.filas;
    var signo = t.dir === 'asc' ? 1 : -1;
    return t.filas.slice().sort(function (a, b) {
      if (t.col === 'nombre') return signo * t.texto(a).localeCompare(t.texto(b), 'es');
      return signo * (Number(a[t.col] || 0) - Number(b[t.col] || 0)) || t.texto(a).localeCompare(t.texto(b), 'es');
    });
  }

  function encabezado(i, k, contenido, cls) {
    var t = tablas[i];
    var activo = t.col === k;
    var flecha = activo ? (t.dir === 'asc' ? 'ph-caret-up' : 'ph-caret-down') : 'ph-caret-up-down';
    return '<th scope="col" class="' + cls + (activo ? ' co-activo' : '') + '"' +
      (activo ? ' aria-sort="' + (t.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' +
      '<button type="button" class="co-orden" data-t="' + i + '" data-c="' + k + '">' + contenido +
      '<i class="ph ' + flecha + ' co-flecha" aria-hidden="true"></i></button></th>';
  }

  function htmlTabla(i) {
    var t = tablas[i];
    return '<table class="pg-tbl co-tbl"><thead><tr>' +
      encabezado(i, 'nombre', t.primera, 'pg-izq') +
      COLS.map(function (c) {
        var cls = c.st ? 'co-st co-st-' + c.st : c.sum ? 'co-sum' : 'co-tot';
        return encabezado(i, c.k, (c.st ? '<span class="co-punto" aria-hidden="true"></span>' : '') + c.t, cls);
      }).join('') + '</tr></thead><tbody>' +
      ordenadas(t).map(function (f) { return '<tr><th scope="row" class="pg-izq">' + t.nombre(f) + '</th>' + celdas(f) + '</tr>'; }).join('') +
      '</tbody>' + t.pie + '</table>';
  }

  function nuevaTabla(t) {
    t.col = null; t.dir = 'desc';
    tablas.push(t);
    return '<div class="pg-scroll" id="co-t-' + (tablas.length - 1) + '">' + htmlTabla(tablas.length - 1) + '</div>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.co-orden');
    if (!b) return;
    var i = +b.dataset.t, k = b.dataset.c, t = tablas[i];
    if (t.col === k) t.dir = t.dir === 'desc' ? 'asc' : 'desc';
    else { t.col = k; t.dir = k === 'nombre' ? 'asc' : 'desc'; }
    var cont = document.getElementById('co-t-' + i);
    cont.innerHTML = htmlTabla(i);
    cont.querySelector('.co-orden[data-c="' + k + '"]').focus();   // el foco sigue en el encabezado
  });

  function sumar(filas) {
    var t = {};
    COLS.forEach(function (c) { t[c.k] = filas.reduce(function (n, f) { return n + Number(f[c.k] || 0); }, 0); });
    return t;
  }

  function tablaTotal(filas, todos) {
    if (!filas.length) return '<div class="pg-vacio">' + (todos ? 'Sin ventas este mes' : 'No tienes un equipo de venta asignado') + '</div>';
    return nuevaTabla({
      filas: filas,
      primera: 'Supervisor',
      texto: function (f) { return f.supervisor; },
      nombre: function (f) {
        // El team solo si no se llama como el supervisor (Eduardo Nuñez → Team Miguel Nuñez).
        return esc(f.supervisor) + (f.team && nombreTeam(f.team).toLowerCase() !== String(f.supervisor).toLowerCase()
          ? '<small>Team ' + esc(nombreTeam(f.team)) + '</small>' : '');
      },
      // Con un solo team el total repetiría su fila.
      pie: filas.length > 1 ? '<tfoot><tr><th scope="row" class="pg-izq">Total</th>' + celdas(sumar(filas)) + '</tr></tfoot>' : '',
    });
  }

  function tablaEquipo(e) {
    var titulo = e.team ? nombreTeam(e.team) : e.supervisor;
    var cuerpo = e.agentes.length
      ? nuevaTabla({
          filas: e.agentes,
          primera: 'Agente',
          texto: function (a) { return a.agente; },
          nombre: function (a) { return esc(a.agente); },
          pie: '<tfoot><tr><th scope="row" class="pg-izq">Total del team</th>' + celdas(e.totales) + '</tr></tfoot>',
        })
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
        tablas = [];
        elTotal.innerHTML = tablaTotal(d.total || [], d.todos);
        elEquipos.innerHTML = (d.equipos || []).map(tablaEquipo).join('') ||
          '<div class="pg-vacio in-glass">' + (d.todos ? 'Sin equipos' : 'No tienes un equipo de venta asignado') + '</div>';
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
