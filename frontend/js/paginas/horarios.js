/**
 * Horarios (horarios.html) — el horario TAL COMO ESTÁ EN EL SISTEMA DE CUADRATURA.
 *
 * Desde el 13-10-2026 el CRM ya no edita horarios: muestra, en solo lectura y con el
 * diseño del CRM, la vista de Horarios de Cuadratura (sus empleados, turnos y días sin
 * turno). Se elige un día de la semana; cada persona muestra su turno de ese día como una
 * barra sobre las horas, con el descanso rayado. Arriba, cuántas personas hay en turno a
 * cada hora (en ámbar las horas con menos de MIN_TURNO). A la derecha, la semana en
 * cuadritos y sus horas de trabajo.
 *
 * Quién ve qué lo decide el backend: administración ve a todo el personal; supervisores
 * y agentes, solo el cuadro de su team.
 *
 * API: GET /api/horarios/cuadratura?inicio=AAAA-MM-DD (CRM_PYTHON/routers/horarios.py)
 */
(function () {
  'use strict';

  // Secciones: primero los teams (Residencial, Líneas); quien no tiene team va agrupado por
  // su cargo dentro de su área de Cuadratura (Employee.area), como en su vista de Horarios.
  var SECCIONES = {
    residencial: 'Residencial', lineas: 'Líneas',
    ventas: 'Agentes de ventas · sin team', administrativo: 'Administrativo', operativo: 'Operativo',
  };
  var ORDEN_SECCION = { residencial: 0, lineas: 1, ventas: 2, administrativo: 3, operativo: 4 };
  var DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MIN_TURNO = 4;          // menos personas que esto en una hora → aviso
  var MAX_HORAS_SEMANA = 44;  // jornada ordinaria diurna en El Salvador

  // Turnos habituales: mismos colores que Cuadratura (frontend/src/lib/shiftColors.ts).
  // comida = hora a la que se dibuja el descanso de la jornada completa.
  var TURNOS = [
    { corto: '8–5', s: '08:00', e: '17:00', color: 'var(--hr-a)', comida: 12 },
    { corto: '10–7', s: '10:00', e: '19:00', color: 'var(--hr-b)', comida: 14 },
    { corto: '1–9', s: '13:00', e: '21:00', color: 'var(--hr-c)', comida: 16 },
    { corto: '9–6', s: '09:00', e: '18:00', color: 'var(--hr-d)', comida: 13 },
    { corto: '8–12', s: '08:00', e: '12:00', color: 'var(--hr-a)', sd: true },
    { corto: '3–7', s: '15:00', e: '19:00', color: 'var(--hr-b)', sd: true },
    { corto: '5–9', s: '17:00', e: '21:00', color: 'var(--hr-c)', sd: true },
  ];
  // Días sin turno de Cuadratura (shift_days_off.kind) → etiqueta y clase de color.
  var LIBRES = {
    libre: ['Libre', 'libre'],
    compensatorio: ['Compensatorio', 'comp'],
    vacacion: ['Vacaciones', 'vac'],
    incapacidad: ['Incapacidad', 'inc'],
    suspendido: ['Suspendido', 'susp'],
    baja: ['De baja', 'baja'],
  };
  var NO_PRESENTO = 'No se presentó';   // el CRM lo guarda como día libre con esta nota

  var state = {
    inicio: null,        // lunes AAAA-MM-DD
    data: null,          // respuesta de GET /api/horarios/cuadratura
    dia: 0,              // pestaña elegida (0 = lunes)
    equipo: '',
    busqueda: '',
    colapsados: {},      // clave de grupo → true
    mostrada: null,      // semana en pantalla (para elegir el día al cambiar de semana)
    turno: {},           // "empleado|fecha" → turno
    libre: {},           // "empleado|fecha" → día sin turno
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Cuadratura guarda los nombres en mayúsculas: «JOSELYN LISBETH CORTEZ» → «Joselyn Lisbeth Cortez».
  var PARTICULAS = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1 };
  function tipoTitulo(s) {
    return String(s || '').toLowerCase().split(' ').map(function (w, i) {
      return i && PARTICULAS[w] ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // Cargo: igual, pero las siglas cortas se quedan en mayúsculas («RRHH», «IT», «BO»).
  function cargo(s) {
    return String(s || '').split(' ').map(function (w) {
      return w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w) && !/^(DE|DEL|LA|LAS|LOS|Y)$/.test(w) ? w : tipoTitulo(w);
    }).join(' ');
  }

  // ── Fechas (AAAA-MM-DD como texto/UTC) ──
  function fecha(ymd) { return new Date(ymd + 'T00:00:00Z'); }
  function addDays(ymd, n) { var d = fecha(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmtCorta(ymd) { var d = fecha(ymd); return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()]; }
  function h12(hhmm) {   // '15:30' → '3:30', '10:00' → '10'
    var p = hhmm.split(':'), h = +p[0] % 12 || 12;
    return p[1] === '00' ? String(h) : h + ':' + p[1];
  }
  function ampm(hhmm) { var h = +hhmm.split(':')[0]; return h12(hhmm) + (hhmm.split(':')[1] === '00' ? ':00' : '') + (h < 12 ? ' a. m.' : ' p. m.'); }
  function fmtHoras(h) {
    var hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60);
    return mm ? hh + ' h ' + mm + ' m' : hh + ' h';
  }
  function etiquetaHora(h) { var x = ((h % 24) + 24) % 24; return (x === 0 ? 12 : x > 12 ? x - 12 : x) + (x < 12 ? 'a' : 'p'); }

  // ── Qué es cada día de una persona ──
  function turnoHabitual(t) {
    return TURNOS.find(function (T) { return T.s === t.start && T.e === t.end; }) || null;
  }
  function colorTurno(t) { var T = turnoHabitual(t); return T ? T.color : 'var(--hr-x)'; }
  function horasTrabajo(t) { return Math.max(t.end_h - t.start_h - (t.break_minutes || 0) / 60, 0); }
  function esNoPresento(l) { return (l.notes || '').trim().toLowerCase() === NO_PRESENTO.toLowerCase(); }
  function infoLibre(l) {
    if (esNoPresento(l)) return [NO_PRESENTO, 'nop'];
    return LIBRES[l.kind] || ['Libre', 'libre'];
  }
  function claveDia(id, f) { return id + '|' + f; }
  function etiquetaDia(id, f) {
    var t = state.turno[claveDia(id, f)], l = state.libre[claveDia(id, f)];
    if (t) return h12(t.start) + '–' + h12(t.end);
    if (l) return infoLibre(l)[0];
    return 'Sin turno';
  }

  // ── Red ──
  async function api(url) {
    var r = await fetch(url, { credentials: 'include' });
    var j = null;
    try { j = await r.json(); } catch (_) { }
    if (!r.ok) throw new Error((j && j.detail) || ('Error ' + r.status));
    return j;
  }

  // ── Carga ──
  async function cargar() {
    $('hr-board').innerHTML = '<div class="hr-loading">Cargando…</div>';
    try {
      state.data = await api('/api/horarios/cuadratura?inicio=' + encodeURIComponent(state.inicio || ''));
    } catch (e) {
      $('hr-board').innerHTML = '<div class="hr-empty">No se pudieron cargar los horarios: ' + esc(e.message) + '</div>';
      return;
    }
    var d = state.data;
    state.turno = {};
    state.libre = {};
    d.turnos.forEach(function (t) { state.turno[claveDia(t.employee_id, t.work_date)] = t; });
    d.libres.forEach(function (l) { state.libre[claveDia(l.employee_id, l.work_date)] = l; });
    if (state.mostrada !== d.inicio) {   // semana nueva: hoy si cae en ella, si no el lunes
      var i = d.dias.indexOf(d.hoy);
      state.dia = i >= 0 ? i : 0;
    }
    state.inicio = state.mostrada = d.inicio;
    render();
  }

  // Grupos en el orden de Cuadratura: los teams (Residencial, Líneas; dentro, el supervisor
  // primero) y luego, por área, quien no tiene team agrupado por su cargo.
  function seccionDe(e) {
    if (e.team) return e.section === 'lineas' ? 'lineas' : 'residencial';
    return SECCIONES[e.area] ? e.area : 'ventas';
  }
  function grupos() {
    var lista = [], porClave = {};
    state.data.empleados.forEach(function (e) {
      var seccion = seccionDe(e);
      var clave = e.team ? 'team:' + e.team : 'cargo:' + seccion + ':' + (e.position || 'Sin cargo');
      if (!porClave[clave]) {
        porClave[clave] = {
          clave: clave,
          nombre: e.team || (e.position ? cargo(e.position) : 'Sin cargo'),
          seccion: seccion,
          miembros: [],
        };
        lista.push(porClave[clave]);
      }
      porClave[clave].miembros.push(e);
    });
    return lista.sort(function (a, b) {
      return (ORDEN_SECCION[a.seccion] - ORDEN_SECCION[b.seccion]) ||
        (a.clave.indexOf('cargo:') === 0 ? a.nombre.localeCompare(b.nombre, 'es') : 0);
    });
  }

  function filtrar(miembros) {
    var q = state.busqueda.trim().toLowerCase();
    return miembros.filter(function (e) {
      return !q || e.full_name.toLowerCase().indexOf(q) >= 0 || (e.team || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function gruposVisibles() {
    return grupos()
      .filter(function (g) { return !state.equipo || g.clave === state.equipo; })
      .map(function (g) { return Object.assign({}, g, { miembros: filtrar(g.miembros) }); })
      .filter(function (g) { return g.miembros.length; });
  }

  // ── Render ──
  function render() {
    var d = state.data;
    $('hr-toolbar').hidden = false;
    $('hr-legend').hidden = false;
    $('hr-eyebrow').textContent = d.es_admin ? 'Sistema de Cuadratura · todo el personal'
      : 'Horario de mi team' + (d.mi_team ? ' · ' + d.mi_team : '');
    $('hr-days').setAttribute('aria-label', 'Semana del ' + fmtCorta(d.dias[0]) + ' al ' + fmtCorta(d.dias[6]) + ' ' + d.dias[6].slice(0, 4));
    $('hr-today').hidden = d.dias.indexOf(d.hoy) >= 0;

    var sel = $('hr-team'), todos = grupos();
    sel.hidden = !d.es_admin || todos.length < 2;
    if (!sel.hidden) {
      sel.innerHTML = '<option value="">Todos los teams</option>' + todos.map(function (g) {
        return '<option value="' + esc(g.clave) + '"' + (g.clave === state.equipo ? ' selected' : '') + '>' + esc(g.nombre) + '</option>';
      }).join('');
    }
    renderDia();
  }

  function renderDia() {
    renderPestanas();
    renderTablero();
  }

  function renderPestanas() {
    var d = state.data, visibles = [];
    gruposVisibles().forEach(function (g) { visibles = visibles.concat(g.miembros); });
    $('hr-days').innerHTML = d.dias.map(function (f, i) {
      var enTurno = visibles.filter(function (e) { return state.turno[claveDia(e.id, f)]; }).length;
      return '<button type="button" role="tab" class="hr-day' + (i === state.dia ? ' sel' : '') + (f < d.hoy ? ' past' : '') +
        '" data-dia="' + i + '" aria-selected="' + (i === state.dia) + '">' +
        '<span class="hr-day-top"><b>' + DIAS[i] + ' ' + f.slice(8) + '</b><i>' + (f === d.hoy ? 'Hoy' : '') + '</i></span>' +
        '<span class="hr-day-sub">' + enTurno + ' en turno</span></button>';
    }).join('');
  }

  function renderTablero() {
    var d = state.data, f = d.dias[state.dia], gs = gruposVisibles();
    if (!d.empleados.length) {
      $('hr-board').innerHTML = '<div class="hr-empty">' + (d.es_admin
        ? 'El Sistema de Cuadratura no tiene personal activo.'
        : 'Tu usuario aún no está en un team del Sistema de Cuadratura. Pídele a RRHH que revise tu ficha.') + '</div>';
      return;
    }
    var visibles = [];
    gs.forEach(function (g) { visibles = visibles.concat(g.miembros); });

    // Ventana de horas del día: 8a–9p como mínimo, ampliada si hay turnos antes o nocturnos.
    var delDia = visibles.map(function (e) { return state.turno[claveDia(e.id, f)]; }).filter(Boolean);
    var h0 = Math.min.apply(null, [8].concat(delDia.map(function (t) { return Math.floor(t.start_h); })));
    var h1 = Math.min(32, Math.max.apply(null, [21].concat(delDia.map(function (t) { return Math.ceil(t.end_h); }))));
    var span = h1 - h0, horas = [];
    for (var h = h0; h < h1; h++) horas.push(h);

    var cobertura = horas.map(function (hh) {
      return delDia.filter(function (t) { return t.start_h <= hh && t.end_h > hh; }).length;
    });
    var max = Math.max.apply(null, cobertura.concat([1]));
    var finas = horas.filter(function (_, k) { return cobertura[k] < MIN_TURNO; }).map(etiquetaHora);
    var histHtml = '<div class="hr-row3"><div class="hr-hist-head"><b>Personas en turno por hora</b><span>' +
      (visibles.length && finas.length ? 'Menos de ' + MIN_TURNO + ': ' + finas.join(', ') : '') + '</span></div>' +
      '<div class="hr-hist">' + cobertura.map(function (v) {
        var fina = v < MIN_TURNO ? ' thin' : '';
        return '<div><span class="' + fina + '">' + v + '</span><i class="' + fina + '" style="height:' + Math.max(4, v / max * 100 - 22) + '%"></i></div>';
      }).join('') + '</div><div></div></div>';

    var cab = '<div class="hr-row3 hr-sticky"><span>Persona</span><div class="hr-hours">' +
      horas.map(function (hh) { return '<span>' + etiquetaHora(hh) + '</span>'; }).join('') +
      '</div><div class="hr-wk-head"><span>Semana</span><span>Horas</span></div></div>';

    var buscando = !!state.busqueda.trim(), seccion = null;
    var cuerpo = gs.map(function (g) {
      var abierto = buscando || !state.colapsados[g.clave];
      var horasEq = g.miembros.reduce(function (s, e) { return s + horasSemana(e); }, 0);
      var sinTurno = g.miembros.filter(function (e) { return !state.turno[claveDia(e.id, f)]; }).length;
      var sep = '';
      if (g.seccion !== seccion) {
        seccion = g.seccion;
        sep = '<div class="hr-section">' + SECCIONES[g.seccion] + '</div>';
      }
      return sep + '<section class="hr-team"><div class="hr-team-head">' +
        '<button type="button" class="hr-team-tg" data-tg="' + esc(g.clave) + '" aria-expanded="' + abierto + '">' +
        '<small>' + (abierto ? '▾' : '▸') + '</small><span>' + esc(g.nombre) + '</span></button>' +
        '<span class="hr-team-meta">' + g.miembros.length + (g.miembros.length === 1 ? ' persona' : ' personas') + ' · ' + fmtHoras(horasEq) + ' semana</span>' +
        (sinTurno ? '<span class="hr-team-warn">' + sinTurno + ' sin turno este día</span>' : '') +
        '</div>' +
        (abierto ? g.miembros.map(function (e) { return fila(e, f, h0, span); }).join('') : '') + '</section>';
    }).join('');

    // Con una sola persona a la vista la cobertura por hora no dice nada.
    $('hr-board').innerHTML = (visibles.length > 1 ? histHtml : '') + cab +
      (cuerpo || '<div class="hr-empty">Nadie coincide con la búsqueda.</div>');
    document.querySelector('.hr-board').style.setProperty('--hr-span', span);
  }

  function horasSemana(e) {
    return state.data.dias.reduce(function (s, f) {
      var t = state.turno[claveDia(e.id, f)];
      return s + (t ? horasTrabajo(t) : 0);
    }, 0);
  }

  function fila(e, f, h0, span) {
    var d = state.data, t = state.turno[claveDia(e.id, f)], l = state.libre[claveDia(e.id, f)];
    var nombre = tipoTitulo(e.full_name);
    var linea;
    if (t) {
      var T = turnoHabitual(t), len = t.end_h - t.start_h;
      var texto = ampm(t.start) + ' – ' + ampm(t.end) + ' · ' +
        (t.template || (T ? (T.sd ? 'Shortday ' + T.corto : T.corto) : 'Personalizado'));
      var brk = (t.break_minutes || 0) / 60, rayado = '';
      if (brk > 0 && len > brk) {
        // Descanso: a su hora habitual en los turnos fijos; si no, a mitad del turno.
        var c0 = T && T.comida ? T.comida - t.start_h : (len - brk) / 2;
        rayado = '<i title="Descanso de ' + t.break_minutes + ' min" style="left:' + (c0 / len * 100) + '%;width:' + (brk / len * 100) + '%"></i>';
      }
      linea = '<span class="hr-bar" style="left:' + ((t.start_h - h0) / span * 100) + '%;width:' + (len / span * 100) + '%;background:' + colorTurno(t) + '"' +
        (t.notes ? ' title="' + esc(t.notes) + '"' : '') + '><b>' + esc(texto) + (t.notes ? ' · 📝' : '') + '</b>' + rayado + '</span>';
    } else if (l) {
      var info = infoLibre(l);
      linea = '<span class="hr-line-empty ' + info[1] + '"' + (l.notes ? ' title="' + esc(l.notes) + '"' : '') + '>' + esc(info[0]) + '</span>';
    } else {
      linea = '<span class="hr-line-empty">Sin turno</span>';
    }

    var cuadros = d.dias.map(function (fd, i) {
      var td = state.turno[claveDia(e.id, fd)], ld = state.libre[claveDia(e.id, fd)];
      var fondo = td ? colorTurno(td) : ld ? 'var(--hr-' + infoLibre(ld)[1] + ')' : '';
      return '<span class="' + (fondo ? 'on' : '') + (i === state.dia ? ' cur' : '') + '" title="' + DIAS[i] + ': ' + esc(etiquetaDia(e.id, fd)) + '"' +
        (fondo ? ' style="background:' + fondo + '"' : '') + '></span>';
    }).join('');
    var tot = horasSemana(e);

    return '<div class="hr-row3 hr-agent' + (String(e.id) === String(d.yo) ? ' yo' : '') + '">' +
      '<div class="hr-who"><div class="hr-name" title="' + esc(nombre) + '">' + esc(nombre) + (e.is_supervisor ? '<em> · Supervisor</em>' : '') + '</div>' +
      // Cargo y team de la ficha de Cuadratura (el team ya es el título del grupo).
      '<div class="hr-mark">' + esc([e.position ? cargo(e.position) : '', e.team ? '' : 'Sin team'].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div class="hr-line" role="img" aria-label="' + esc(nombre) + ', ' + DIAS_LARGOS[state.dia] + ': ' + esc(etiquetaDia(e.id, f)) + '">' + linea + '</div>' +
      '<div class="hr-wk"><div class="hr-sq">' + cuadros + '</div><span class="hr-tot' + (!tot ? ' zero' : tot > MAX_HORAS_SEMANA ? ' over' : '') + '">' + fmtHoras(tot) + '</span></div>' +
      '</div>';
  }

  // ── Eventos ──
  function semana(n) {
    state.inicio = addDays(state.inicio, n);
    cargar();
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('hr-prev').addEventListener('click', function () { semana(-7); });
    $('hr-next').addEventListener('click', function () { semana(7); });
    $('hr-today').addEventListener('click', function () { state.inicio = null; cargar(); });
    $('hr-days').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dia]');
      if (!b) return;
      state.dia = +b.dataset.dia;
      renderDia();
    });
    $('hr-search').addEventListener('input', function (ev) { state.busqueda = ev.target.value; renderDia(); });
    $('hr-team').addEventListener('change', function (ev) { state.equipo = ev.target.value; renderDia(); });
    $('hr-board').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-tg]');
      if (!b) return;
      state.colapsados[b.dataset.tg] = !state.colapsados[b.dataset.tg];
      renderTablero();
    });
    cargar();
  });
})();
