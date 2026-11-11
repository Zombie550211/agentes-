/**
 * Consolidado (residencial/consolidado.html). Datos: GET /api/consolidado?mes=YYYY-MM
 * (routers/consolidado.py): suma del puntaje de las ventas del mes por status.
 * - Consolidado total: una fila por team (su supervisor) y el total general.
 * - Consolidado por equipos: una tabla por team con una fila por agente.
 * Admin y back office ven todos los teams; los demás solo el suyo (lo filtra el servidor).
 * Cada tabla se ordena tocando el encabezado de una columna.
 * «Por mercado»: ICON y BAMO como % de cada columna (cada columna suma 100 %): total y una tabla por team.
 */
(function () {
  'use strict';

  // La misma página sirve a las dos secciones; el <body> dice cuál (lineas/consolidado.html):
  // data-api (endpoint) y data-unidad («pts» en Residencial, «líneas» en Líneas, sin decimales).
  var API = document.body.dataset.api || '/api/consolidado';
  var UNIDAD = document.body.dataset.unidad || 'pts';
  var DEC = UNIDAD === 'pts' ? 2 : 0;
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
  var vista = 'team';               // 'team' | 'mercado'
  try { if (localStorage.getItem('co_vista' + UNIDAD) === 'mercado') vista = 'mercado'; } catch (e) {}

  var elTotal = document.getElementById('co-total');
  var elEquipos = document.getElementById('co-equipos');
  var elMercado = document.getElementById('co-mercado');
  var elMercadoEq = document.getElementById('co-mercado-equipos');
  var elMes = document.getElementById('co-mes');
  var btnPrev = document.getElementById('co-prev');
  var btnNext = document.getElementById('co-next');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    return Number(n || 0).toLocaleString('es-SV', { minimumFractionDigits: DEC, maximumFractionDigits: DEC });
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

  // ── Por mercado ───────────────────────────────────────────────────
  // Cada celda es el % que aporta ese mercado al total de la columna (ICON + BAMO = 100 %),
  // con el puntaje debajo. La fila Total da 100 % en toda columna que tenga puntaje.
  function pct(n) {
    return Number(n || 0).toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00a0%';
  }
  function celdasPct(f, tot) {
    return COLS.map(function (c) {
      var v = Number(f[c.k] || 0), base = Number(tot[c.k] || 0);
      var p = base ? v / base * 100 : 0;
      return '<td class="pg-n co-pct' + (c.sum ? ' co-sum' : '') + (c.tot ? ' co-tot' : '') + (p === 0 ? ' co-cero' : '') + '">' +
        pct(p) + '<small>' + num(v) + ' ' + UNIDAD + '</small></td>';
    }).join('');
  }
  function tablaMercado(filas) {
    var tot = sumar(filas);
    if (!filas.length || !tot.total) return '<div class="pg-vacio">Sin ventas este mes</div>';
    var cab = '<thead><tr><th scope="col" class="pg-izq"><span class="co-orden">Mercado</span></th>' +
      COLS.map(function (c) {
        var cls = c.st ? 'co-st co-st-' + c.st : c.sum ? 'co-sum' : 'co-tot';
        return '<th scope="col" class="' + cls + '"><span class="co-orden">' +
          (c.st ? '<span class="co-punto" aria-hidden="true"></span>' : '') + c.t + '</span></th>';
      }).join('') + '</tr></thead>';
    var cuerpo = filas.map(function (f) {
      return '<tr><th scope="row" class="pg-izq"><span class="co-mer co-mer-' + esc(f.mercado.toLowerCase()) + '">' +
        '<span class="co-mer-punto" aria-hidden="true"></span>' + esc(f.mercado) + '</span></th>' + celdasPct(f, tot) + '</tr>';
    }).join('');
    return '<div class="pg-scroll"><table class="pg-tbl co-tbl">' + cab + '<tbody>' + cuerpo + '</tbody>' +
      '<tfoot><tr><th scope="row" class="pg-izq">Total</th>' + celdasPct(tot, tot) + '</tr></tfoot></table></div>';
  }

  // «Ver team»: por cada agente, sus filas ICON y BAMO como % de SU puntaje (suman 100 %).
  // Solo agentes con puntaje; los demás se cuentan al pie.
  function tablaMercadoAgentes(lista) {
    var con = lista.filter(function (a) { return Number(a.total || 0) > 0; });
    var sin = lista.length - con.length;
    var notaSin = sin ? '<p class="co-nota">' + sin + (sin === 1 ? ' agente sin ventas' : ' agentes sin ventas') + ' este mes</p>' : '';
    if (!con.length) return '<div class="pg-vacio">Ningún agente con ventas este mes</div>';
    var cab = '<thead><tr><th scope="col" class="pg-izq"><span class="co-orden">Agente</span></th>' +
      '<th scope="col" class="pg-izq"><span class="co-orden">Mercado</span></th>' +
      COLS.map(function (c) {
        var cls = c.st ? 'co-st co-st-' + c.st : c.sum ? 'co-sum' : 'co-tot';
        return '<th scope="col" class="' + cls + '"><span class="co-orden">' +
          (c.st ? '<span class="co-punto" aria-hidden="true"></span>' : '') + c.t + '</span></th>';
      }).join('') + '</tr></thead>';
    var cuerpos = con.map(function (a) {
      var filas = (a.mercados || []).filter(function (f) { return f.mercado === 'ICON' || f.mercado === 'BAMO' || Number(f.total) > 0; });
      var tot = sumar(filas);
      return '<tbody class="co-ag">' + filas.map(function (f, i) {
        return '<tr>' + (i === 0 ? '<th scope="rowgroup" rowspan="' + filas.length + '" class="pg-izq co-ag-nom">' + esc(a.agente) + '</th>' : '') +
          '<th scope="row" class="pg-izq"><span class="co-mer co-mer-' + esc(f.mercado.toLowerCase()) + '">' +
          '<span class="co-mer-punto" aria-hidden="true"></span>' + esc(f.mercado) + '</span></th>' + celdasPct(f, tot) + '</tr>';
      }).join('') + '</tbody>';
    }).join('');
    return '<div class="pg-scroll"><table class="pg-tbl co-tbl co-tbl-ag">' + cab + cuerpos + '</table></div>' + notaSin;
  }

  var nEquipo = 0;
  function tablaMercadoEquipo(e) {
    var titulo = e.team ? nombreTeam(e.team) : e.supervisor;
    var id = 'co-mag-' + (nEquipo++);
    var lista = e.agentes_mercado || [];
    return '<section class="pg-card in-glass" aria-label="' + esc(titulo) + ' por mercado">' +
      '<div class="pg-card-head"><div>' +
        '<h2><i class="ph ph-users-three" aria-hidden="true"></i>' + esc(titulo) + '</h2>' +
        '<p>Supervisor: ' + esc(e.supervisor) + '</p>' +
      '</div>' +
      (lista.length ? '<button type="button" class="co-ver" aria-expanded="false" aria-controls="' + id + '">' +
        '<i class="ph ph-caret-down" aria-hidden="true"></i><span>Ver team</span></button>' : '') +
      '</div>' + tablaMercado(e.mercados || []) +
      (lista.length ? '<div class="co-ag-panel" id="' + id + '" hidden>' +
        '<h3 class="co-ag-titulo"><i class="ph ph-user-check" aria-hidden="true"></i>Por agente</h3>' +
        tablaMercadoAgentes(lista) + '</div>' : '') +
      '</section>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.co-ver');
    if (!b) return;
    var abierto = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(abierto));
    b.querySelector('span').textContent = abierto ? 'Ocultar team' : 'Ver team';
    document.getElementById(b.getAttribute('aria-controls')).hidden = !abierto;
  });

  function pintarVista() {
    document.querySelectorAll('.co-vista').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.vista === vista)); });
    document.querySelectorAll('.co-v-team').forEach(function (el) { el.hidden = vista !== 'team'; });
    document.querySelectorAll('.co-v-mercado').forEach(function (el) { el.hidden = vista !== 'mercado'; });
  }
  document.querySelectorAll('.co-vista').forEach(function (b) {
    b.addEventListener('click', function () {
      vista = b.dataset.vista;
      try { localStorage.setItem('co_vista' + UNIDAD, vista); } catch (e) {}
      pintarVista();
    });
  });
  pintarVista();

  function pintarMes() {
    elMes.textContent = MESES[mes.m - 1] + ' ' + mes.y;
    // No hay meses futuros que ver.
    btnNext.disabled = actual && clave(mes) >= actual;
  }

  function cargar() {
    pintarMes();
    elTotal.innerHTML = '<div class="pg-vacio">Cargando…</div>';
    elMercado.innerHTML = '<div class="pg-vacio">Cargando…</div>';
    fetch(API + '?mes=' + clave(mes), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        tablas = [];
        elMercado.innerHTML = tablaMercado(d.mercados || []);
        nEquipo = 0;
        elMercadoEq.innerHTML = (d.equipos || []).map(tablaMercadoEquipo).join('') ||
          '<div class="pg-vacio in-glass">' + (d.todos ? 'Sin equipos' : 'No tienes un equipo de venta asignado') + '</div>';
        elTotal.innerHTML = tablaTotal(d.total || [], d.todos);
        elEquipos.innerHTML = (d.equipos || []).map(tablaEquipo).join('') ||
          '<div class="pg-vacio in-glass">' + (d.todos ? 'Sin equipos' : 'No tienes un equipo de venta asignado') + '</div>';
      })
      .catch(function () {
        elTotal.innerHTML = '<div class="pg-vacio">No se pudo cargar el consolidado</div>';
        elEquipos.innerHTML = '';
        elMercado.innerHTML = '<div class="pg-vacio">No se pudo cargar el consolidado</div>';
        elMercadoEq.innerHTML = '';
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
  fetch(API, { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.mes) { actual = d.mes; mes = { y: +d.mes.slice(0, 4), m: +d.mes.slice(5, 7) }; }
      cargar();
    })
    .catch(cargar);
})();
