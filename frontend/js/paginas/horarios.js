/**
 * Horarios de agentes (horarios.html) — vista por día con línea de tiempo.
 *
 * Se elige un día de la semana (pestañas); cada agente muestra su turno de ese día
 * como una barra entre 8 a. m. y 9 p. m., con la hora de comida rayada. Arriba, cuántos
 * agentes hay en turno a cada hora (en naranja las horas con menos de MIN_TURNO).
 * Clic en la fila → turnos habituales (8–5, 10–7, 1–9, 9–6 y sus shortday de 4 h),
 * Libre, Vacaciones u otro horario. «Aplicar a Lun–Sáb» copia el turno a la semana.
 *
 * Supervisor / admin editan (el supervisor no toca días pasados); el agente solo ve
 * el suyo. Lo guardado se envía solo al Sistema de Cuadratura cada 15 min, o al
 * momento con «Enviar a Cuadratura».
 *
 * API: /api/horarios/* (CRM_PYTHON/routers/horarios.py)
 */
(function () {
  'use strict';

  var DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var H0 = 8, HN = 13;           // la línea de tiempo va de 8:00 a 21:00
  var MIN_TURNO = 4;             // menos agentes que esto en una hora → aviso
  var MAX_HORAS_SEMANA = 44;
  var VACACIONES = 'Vacaciones'; // se guarda como día libre con esta nota

  // Turnos habituales. sd = su versión shortday (4 h, sin comida).
  var TURNOS = [
    { k: 'A', corto: '8–5', s: '08:00', e: '17:00', sd: ['08:00', '12:00'], sdCorto: '8–12', comida: 12, color: 'var(--hr-a)' },
    { k: 'B', corto: '10–7', s: '10:00', e: '19:00', sd: ['15:00', '19:00'], sdCorto: '3–7', comida: 14, color: 'var(--hr-b)' },
    { k: 'C', corto: '1–9', s: '13:00', e: '21:00', sd: ['17:00', '21:00'], sdCorto: '5–9', comida: 16, color: 'var(--hr-c)' },
    { k: 'D', corto: '9–6', s: '09:00', e: '18:00', sd: null, comida: 13, color: 'var(--hr-d)' },
  ];

  var state = {
    inicio: null,        // lunes AAAA-MM-DD
    data: null,          // respuesta de GET /api/horarios/semana
    dia: 0,              // pestaña elegida (0 = lunes)
    dirty: {},           // user_id → true
    equipo: '',
    busqueda: '',
    colapsados: {},      // clave de equipo → true
    pop: null,           // { id }
    mostrada: null,      // semana que está en pantalla (para elegir el día al cambiar)
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Fechas (AAAA-MM-DD, sin zona: se manejan como texto/UTC) ──
  // Nombre que se muestra: el completo (users.nombre_completo) si lo hay, en tipo título;
  // si no, el del CRM. «JOSELYN LISBETH CORTEZ GONZALEZ» → «Joselyn Lisbeth Cortez Gonzalez».
  var PARTICULAS = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1 };
  function tipoTitulo(s) {
    return String(s).toLowerCase().split(' ').map(function (w, i) {
      return i && PARTICULAS[w] ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  function nombreDe(a) { return a.nombre_completo ? tipoTitulo(a.nombre_completo) : (a.name || a.username || ''); }

  function fecha(ymd) { return new Date(ymd + 'T00:00:00Z'); }
  function addDays(ymd, n) { var d = fecha(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmtCorta(ymd) { var d = fecha(ymd); return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()]; }
  function fmtFechaHora(iso) {
    if (!iso) return '';
    var d = new Date(iso.replace(' ', 'T'));
    return isNaN(d) ? iso : d.toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function fmtFechaCorta(ymd) { return ymd.slice(8, 10) + '/' + ymd.slice(5, 7) + '/' + ymd.slice(0, 4); }
  function horas(hhmm) { var p = hhmm.split(':'); return (+p[0]) + (+p[1]) / 60; }
  function h12(hhmm) {   // '15:30' → '3:30', '10:00' → '10'
    var p = hhmm.split(':'), h = +p[0] % 12 || 12;
    return p[1] === '00' ? String(h) : h + ':' + p[1];
  }
  function ampm(hhmm) { var h = +hhmm.split(':')[0]; return h12(hhmm) + (hhmm.split(':')[1] === '00' ? ':00' : '') + (h < 12 ? ' a. m.' : ' p. m.'); }
  function fmtHoras(h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm ? hh + ' h ' + mm + ' m' : hh + ' h';
  }

  // ── Qué es cada día de un agente ──
  function esVacaciones(t) { return t && t.rest_day && (t.notes || '').trim().toLowerCase() === VACACIONES.toLowerCase(); }
  function turnoDe(t) {        // → { turno, corto(bool) } o null si es un horario propio
    if (!t || t.rest_day || !t.start) return null;
    for (var i = 0; i < TURNOS.length; i++) {
      var T = TURNOS[i];
      if (t.start === T.s && t.end === T.e) return { turno: T, sd: false };
      if (T.sd && t.start === T.sd[0] && t.end === T.sd[1]) return { turno: T, sd: true };
    }
    return null;
  }
  function trabaja(t) { return !!(t && !t.rest_day && t.start && t.end); }
  function duracion(t) { var d = horas(t.end) - horas(t.start); return d <= 0 ? d + 24 : d; }
  function horasTurno(t) { return trabaja(t) ? Math.max(duracion(t) - (t.break_minutes || 0) / 60, 0) : 0; }
  function esShortday(t) {
    var m = turnoDe(t);
    return m ? m.sd : (trabaja(t) && !t.break_minutes && duracion(t) <= 4.5);
  }
  function etiquetaCorta(t) {
    if (!t) return 'Sin horario';
    if (esVacaciones(t)) return VACACIONES;
    if (t.rest_day) return 'Libre';
    var m = turnoDe(t);
    if (m) return m.sd ? m.turno.sdCorto : m.turno.corto;
    return h12(t.start) + '–' + h12(t.end);
  }
  function colorDe(t) {
    if (!t) return '';
    if (esVacaciones(t)) return 'var(--hr-vac)';
    if (t.rest_day) return 'var(--hr-libre)';
    var m = turnoDe(t);
    return m ? m.turno.color : 'var(--hr-x)';
  }

  // ── Red ──
  async function api(method, url, body) {
    var r = await fetch(url, {
      method: method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    var j = null;
    try { j = await r.json(); } catch (_) { }
    if (!r.ok) {
      var det = j && j.detail;
      if (Array.isArray(det)) det = det.map(function (d) { return String(d.msg || '').replace(/^Value error, /, ''); }).join(' · ');
      var err = new Error(det || ('Error ' + r.status));
      err.status = r.status;
      throw err;
    }
    return j;
  }

  var toastTimer;
  function toast(msg, err) {
    var t = $('hr-toast');
    t.textContent = msg;
    t.className = 'hr-toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'hr-toast'; }, err ? 6000 : 3500);
  }

  // ── Carga ──
  async function cargar() {
    if (Object.keys(state.dirty).length && !confirm('Hay cambios sin guardar en esta semana. ¿Descartarlos?')) return false;
    $('hr-board').innerHTML = '<div class="hr-loading">Cargando…</div>';
    try {
      var q = '/api/horarios/semana?inicio=' + encodeURIComponent(state.inicio || '') +
        '&equipo=' + encodeURIComponent(state.equipo);
      state.data = await api('GET', q);
    } catch (e) {
      $('hr-board').innerHTML = '<div class="hr-empty">No se pudieron cargar los horarios: ' + esc(e.message) + '</div>';
      return false;
    }
    var semanaNueva = state.mostrada !== state.data.inicio;
    state.inicio = state.mostrada = state.data.inicio;
    state.dirty = {};
    if (semanaNueva) {   // al cambiar de semana: hoy si cae en ella, si no el lunes
      var i = state.data.dias.indexOf(state.data.hoy);
      state.dia = i >= 0 ? i : 0;
    }
    cerrarPop();
    render();
    return true;
  }

  function editable(f) {
    var d = state.data;
    return d.puede_editar && (!d.editable_desde || f >= d.editable_desde);
  }
  function fechaSel() { return state.data.dias[state.dia]; }
  function agentePorId(id) { return state.data.agentes.find(function (a) { return String(a.id) === String(id); }); }

  function agentesFiltrados() {
    var q = state.busqueda.trim().toLowerCase();
    return state.data.agentes.filter(function (a) {
      return !q || (a.name || '').toLowerCase().indexOf(q) >= 0 || (a.username || '').toLowerCase().indexOf(q) >= 0 ||
        (a.nombre_completo || '').toLowerCase().indexOf(q) >= 0 ||
        String(a.reloj_id || '') === q || (a.team || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  // ── Render ──
  function render() {
    var d = state.data;
    $('hr-toolbar').hidden = false;
    $('hr-dayopts').hidden = false;
    $('hr-actions').hidden = !d.puede_editar;
    if (!d.puede_editar) {
      $('hr-eyebrow').textContent = 'Mi horario';
      $('hr-search').hidden = true;
      $('hr-short-wrap').hidden = true;
      $('hr-hint').hidden = true;
    }
    $('hr-week-label').textContent = fmtCorta(d.inicio) + ' – ' + fmtCorta(d.fin) + ' ' + d.fin.slice(0, 4);
    $('hr-today').hidden = d.dias.indexOf(d.hoy) >= 0;

    var sel = $('hr-team');
    if (d.es_admin && d.equipos.length) {
      sel.hidden = false;
      sel.innerHTML = '<option value="">Todos los equipos</option>' + d.equipos.map(function (t) {
        return '<option' + (t === state.equipo ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('');
    }
    renderEstado();
    renderDia();
  }

  // Todo lo que depende del día elegido o de las ediciones.
  function renderDia() {
    var f = fechaSel(), dt = fecha(f);
    $('hr-title').textContent = DIAS_LARGOS[state.dia] + ' ' + dt.getUTCDate() + ' de ' + MESES_LARGOS[dt.getUTCMonth()];
    renderPestanas();
    renderShortday();
    renderTablero();
    renderGuardar();
  }

  function renderEstado() {
    var d = state.data, el = $('hr-status');
    var n = Object.keys(state.dirty).length;
    if (!d.puede_editar) { el.hidden = true; return; }
    el.hidden = false;
    if (n) {
      el.className = 'hr-status warn';
      el.textContent = n + (n === 1 ? ' agente con cambios sin guardar' : ' agentes con cambios sin guardar');
      return;
    }
    var u = d.ultimo_envio;
    if (!d.cuadratura_configurada) {
      el.className = 'hr-status warn';
      el.textContent = 'La conexión con Cuadratura no está configurada: los horarios se guardan pero no se envían.';
      return;
    }
    if (!u) {
      el.className = 'hr-status';
      el.textContent = 'Esta semana aún no se ha enviado a Cuadratura. Se envía sola al guardar (en unos minutos).';
      return;
    }
    var r = u.resumen || {}, obs = r.observaciones || [];
    if (u.estado === 'error') {
      el.className = 'hr-status err';
      el.textContent = 'Falló el último envío a Cuadratura (' + fmtFechaHora(u.fecha) + '): ' + (u.error || '');
      return;
    }
    el.className = 'hr-status' + (u.estado === 'parcial' ? ' warn' : '');
    var html = '<span>Enviado a Cuadratura el ' + esc(fmtFechaHora(u.fecha)) +
      (u.origen === 'auto' ? ' (automático)' : ' por ' + esc(u.enviado_por || '')) + '</span>';
    if (obs.length) {
      html += '<details><summary>' + obs.length + ' con observaciones</summary><ul>' + obs.map(function (o) {
        var ag = agentePorId(o.crm_agent_id) ? nombreDe(agentePorId(o.crm_agent_id)) : ('ID CRM ' + o.crm_agent_id);
        var extra = (o.conflict_dates || []).length ? ' (' + o.conflict_dates.join(', ') + ')' : '';
        return '<li><b>' + esc(ag) + ':</b> ' + esc(o.message || o.status) + esc(extra) + '</li>';
      }).join('') + '</ul></details>';
    }
    el.innerHTML = html;
  }

  function renderPestanas() {
    var d = state.data, lista = agentesFiltrados();
    $('hr-days').innerHTML = d.dias.map(function (f, i) {
      var enTurno = 0, sinAsignar = 0, cortos = 0, turnos = 0;
      lista.forEach(function (a) {
        var t = a.dias[f];
        if (!t) sinAsignar++;
        else if (trabaja(t)) { enTurno++; turnos++; if (esShortday(t)) cortos++; }
      });
      var tag = f === d.hoy ? 'Hoy' : (turnos && cortos === turnos ? 'Shortday' : '');
      var sub = enTurno + ' en turno' + (sinAsignar ? ' · <span class="warn">' + sinAsignar + ' sin asignar</span>' : '');
      return '<button type="button" role="tab" class="hr-day' + (i === state.dia ? ' sel' : '') + (f < d.hoy ? ' past' : '') +
        '" data-dia="' + i + '" aria-selected="' + (i === state.dia) + '">' +
        '<span class="hr-day-top"><b>' + DIAS[i] + ' ' + f.slice(8) + '</b><i>' + tag + '</i></span>' +
        '<span class="hr-day-sub">' + sub + '</span></button>';
    }).join('');
  }

  // «Este día es shortday»: marcado si todos los turnos habituales del día (de los
  // agentes a la vista) están en su versión de 4 h. Al cambiarlo se pasan todos.
  function turnosHabitualesDelDia() {
    var f = fechaSel();
    return agentesFiltrados().map(function (a) { return { a: a, m: turnoDe(a.dias[f]) }; })
      .filter(function (x) { return x.m && x.m.turno.sd; });
  }
  function renderShortday() {
    var lista = turnosHabitualesDelDia(), chk = $('hr-short');
    chk.checked = lista.length > 0 && lista.every(function (x) { return x.m.sd; });
    var puede = state.data.puede_editar && editable(fechaSel()) && lista.length > 0;
    chk.disabled = !puede;
    $('hr-short-wrap').classList.toggle('disabled', !puede);
    $('hr-short-wrap').title = !lista.length ? 'Primero asigne turnos 8–5, 10–7 o 1–9 a este día' :
      (!editable(fechaSel()) ? 'Día pasado: lo corrige RRHH en Cuadratura' : '');
  }
  function cambiarShortday(aCorto) {
    var f = fechaSel(), n = 0;
    turnosHabitualesDelDia().forEach(function (x) {
      if (x.m.sd === aCorto) return;
      var T = x.m.turno, t = x.a.dias[f];
      x.a.dias[f] = aCorto
        ? { start: T.sd[0], end: T.sd[1], break_minutes: 0, rest_day: false, notes: t.notes || null }
        : { start: T.s, end: T.e, break_minutes: 60, rest_day: false, notes: t.notes || null };
      marcarCambio(x.a, f);
      n++;
    });
    renderDia();
    renderEstado();
    if (n) toast(n + ' turno(s) pasados a ' + (aCorto ? 'shortday (4 h)' : 'jornada completa') + '. Recuerde guardar.');
  }

  function renderTablero() {
    var d = state.data, f = fechaSel(), lista = agentesFiltrados();
    if (!d.agentes.length) {
      $('hr-board').innerHTML = '<div class="hr-empty">' + (d.puede_editar
        ? 'No hay agentes activos en su equipo. Revise en Permisos que tengan su mismo team.'
        : 'No se encontró su usuario de agente.') + '</div>';
      return;
    }

    // Agentes en turno por hora (del día elegido, con los filtros puestos)
    var hist = [];
    for (var k = 0; k < HN; k++) {
      var h = H0 + k;
      hist.push(lista.filter(function (a) {
        var t = a.dias[f];
        if (!trabaja(t)) return false;
        var s = horas(t.start), e = s + duracion(t);
        return s <= h && e > h;
      }).length);
    }
    var max = Math.max.apply(null, hist.concat([1]));
    var finas = [];
    hist.forEach(function (v, k) { if (v < MIN_TURNO) finas.push(etiquetaHora(H0 + k)); });
    var histHtml = '<div class="hr-row3"><div class="hr-hist-head"><b>Agentes en turno por hora</b><span>' +
      (lista.length && finas.length ? 'Menos de ' + MIN_TURNO + ' agentes: ' + finas.join(', ') : '') + '</span></div>' +
      '<div class="hr-hist">' + hist.map(function (v) {
        var fina = v < MIN_TURNO ? ' thin' : '';
        return '<div><span class="' + fina + '">' + v + '</span><i class="' + fina + '" style="height:' + Math.max(4, v / max * 100 - 22) + '%"></i></div>';
      }).join('') + '</div><div></div></div>';

    var cab = '<div class="hr-row3 hr-sticky"><span>Agente · ID de reloj</span><div class="hr-hours">' +
      Array.from({ length: HN }, function (_, k) { return '<span>' + etiquetaHora(H0 + k) + '</span>'; }).join('') +
      '</div><div class="hr-wk-head"><span>Semana</span><span>Horas</span></div></div>';

    var buscando = !!state.busqueda.trim(), seccion = null;
    var cuerpo = (d.grupos || []).map(function (g) {
      var miembros = lista.filter(function (a) { return a.grupo === g.clave; })
        .sort(function (x, y) { return (y.es_supervisor - x.es_supervisor) || nombreDe(x).localeCompare(nombreDe(y), 'es'); });
      if (!miembros.length) return '';
      var abierto = buscando || !state.colapsados[g.clave];
      var horasEq = miembros.reduce(function (s, a) { return s + totalAgente(a); }, 0);
      var sinHorario = miembros.filter(function (a) { return !a.dias[f]; }).length;
      var sinReloj = miembros.filter(function (a) { return !a.reloj_id; }).length;
      var avisos = [];
      if (sinHorario) avisos.push(sinHorario + ' sin horario este día');
      if (d.puede_editar && sinReloj) avisos.push(sinReloj + ' sin ID de reloj');
      var sep = '';
      if (g.seccion !== seccion) {
        seccion = g.seccion;
        sep = '<div class="hr-section">' + (g.seccion === 'lineas' ? 'Líneas' : 'Residencial') + '</div>';
      }
      return sep + '<section class="hr-team"><div class="hr-team-head">' +
        '<button type="button" class="hr-team-tg" data-tg="' + esc(g.clave) + '" aria-expanded="' + abierto + '">' +
        '<small>' + (abierto ? '▾' : '▸') + '</small><span>' + esc(g.team || 'Sin equipo') + '</span></button>' +
        '<span class="hr-team-meta">' + miembros.length + (miembros.length === 1 ? ' agente' : ' agentes') + ' · ' + fmtHoras(horasEq) + ' semana' +
        (g.supervisor ? ' · Sup. ' + esc(g.supervisor) : '') + '</span>' +
        '<span class="hr-team-warn">' + esc(avisos.join(' · ')) + '</span></div>' +
        (abierto ? miembros.map(function (a) { return filaAgente(a, f); }).join('') : '') + '</section>';
    }).join('');

    // El agente solo se ve a sí mismo: la cobertura por hora no le dice nada.
    $('hr-board').innerHTML = (d.puede_editar ? histHtml : '') + cab + (cuerpo || '<div class="hr-empty">Ningún agente coincide con la búsqueda.</div>');
  }

  function etiquetaHora(h) { return (h > 12 ? h - 12 : h) + (h < 12 ? 'a' : 'p'); }
  function totalAgente(a) { return state.data.dias.reduce(function (s, f) { return s + horasTurno(a.dias[f]); }, 0); }

  function filaAgente(a, f) {
    var d = state.data, t = a.dias[f], ed = editable(f);
    var nombre = nombreDe(a);
    var reloj = d.puede_editar
      ? 'Reloj <input class="hr-reloj' + (a.reloj_id ? '' : ' missing') + '" data-reloj="' + a.id + '" value="' + esc(a.reloj_id || '') +
        '" placeholder="sin ID" inputmode="numeric" maxlength="32" aria-label="ID de reloj de ' + esc(nombre) + '">'
      : 'Reloj ' + esc(a.reloj_id || '—');
    var ingreso = a.fecha_ingreso ? fmtFechaCorta(a.fecha_ingreso) : '';
    var ingresoHtml = d.puede_editar
      ? '<button type="button" class="hr-ingreso' + (ingreso ? '' : ' missing') + '" data-ingreso="' + a.id + '" title="Fecha de ingreso (clic para cambiarla)">' +
        (ingreso ? 'Ingreso ' + ingreso : 'sin ingreso') + '</button>'
      : (ingreso ? '<span>Ingreso ' + ingreso + '</span>' : '');

    var barra;
    if (trabaja(t)) {
      var s = horas(t.start), e = s + duracion(t);
      var x0 = Math.max(s, H0), x1 = Math.min(e, H0 + HN);
      var m = turnoDe(t);
      var largo = (m ? (m.sd ? m.turno.sdCorto : m.turno.corto) + ' · ' : '') + ampm(t.start) + ' – ' + ampm(t.end) + (esShortday(t) ? ' · shortday' : '');
      var comida = '';
      if (t.break_minutes && x1 > x0) {
        var c0 = m && !m.sd ? m.turno.comida : s + (duracion(t) - t.break_minutes / 60) / 2;
        comida = '<i title="Hora de comida" style="left:' + ((c0 - x0) / (x1 - x0) * 100) + '%;width:' + (t.break_minutes / 60 / (x1 - x0) * 100) + '%"></i>';
      }
      barra = x1 > x0
        ? '<span class="hr-bar" style="left:' + ((x0 - H0) / HN * 100) + '%;width:' + ((x1 - x0) / HN * 100) + '%;background:' + colorDe(t) + '"' +
          (t.notes ? ' title="' + esc(t.notes) + '"' : '') + '><b>' + esc(largo) + (t.notes ? ' · 📝' : '') + '</b>' + comida + '</span>'
        : '<span class="hr-line-empty">' + esc(largo) + ' (fuera de 8a–9p)</span>';
    } else {
      barra = '<span class="hr-line-empty' + (t ? '' : ' todo') + '">' +
        (t ? etiquetaCorta(t) : (ed && d.puede_editar ? 'Sin horario — clic para asignar' : 'Sin horario')) + '</span>';
    }

    var cuadros = d.dias.map(function (fd, i) {
      var td = a.dias[fd];
      return '<span class="' + (td ? 'on' : '') + (i === state.dia ? ' cur' : '') + '" title="' + DIAS[i] + ': ' + esc(etiquetaCorta(td)) +
        '"' + (td ? ' style="background:' + colorDe(td) + '"' : '') + '></span>';
    }).join('');
    var tot = totalAgente(a);

    return '<div class="hr-row3 hr-agent">' +
      '<div class="hr-who"><div class="hr-name-row"><div class="hr-name' + (a.nombre_completo ? '' : ' sin-completo') + '" title="' + esc(nombre) +
      (a.nombre_completo ? '' : ' (sin nombre completo)') + '">' + esc(nombre) + (a.es_supervisor ? '<em> · Supervisor</em>' : '') + '</div>' +
      (d.puede_editar ? '<button type="button" class="hr-edit-nombre" data-nombre="' + a.id + '" title="Nombre completo" aria-label="Editar el nombre completo de ' + esc(nombre) + '">✎</button>' : '') + '</div>' +
      '<div class="hr-mark"><span class="hr-user" title="Usuario del CRM">' + esc(a.username || '') + '</span> · ' + reloj + (ingresoHtml ? ' · ' + ingresoHtml : '') + '</div></div>' +
      '<button type="button" class="hr-line' + (a._dirtyDays && a._dirtyDays[f] ? ' dirty' : '') + '" data-u="' + a.id + '"' +
      (ed && d.puede_editar ? '' : ' disabled') + ' title="' + (d.puede_editar && !ed ? 'Día pasado: lo corrige RRHH en Cuadratura' : '') +
      '" aria-label="Turno de ' + esc(nombre) + ' el ' + DIAS_LARGOS[state.dia] + ': ' + esc(etiquetaCorta(t)) + '">' + barra + '</button>' +
      '<div class="hr-wk"><div class="hr-sq">' + cuadros + '</div><span class="hr-tot' + (!tot ? ' zero' : tot > MAX_HORAS_SEMANA ? ' over' : '') + '">' + fmtHoras(tot) + '</span></div>' +
      '</div>';
  }

  function renderGuardar() {
    var n = Object.keys(state.dirty).length, b = $('hr-save');
    b.disabled = !n;
    b.textContent = n ? 'Guardar (' + n + ')' : 'Guardado';
  }

  function marcarCambio(a, f) {
    state.dirty[a.id] = true;
    a._dirtyDays = a._dirtyDays || {};
    a._dirtyDays[f] = true;
  }

  function asignar(a, fechas, valor) {   // valor: objeto de día o null (vaciar)
    var n = 0;
    fechas.forEach(function (f) {
      if (!editable(f)) return;
      if (valor) a.dias[f] = Object.assign({}, valor); else delete a.dias[f];
      marcarCambio(a, f);
      n++;
    });
    cerrarPop();
    renderDia();
    renderEstado();
    return n;
  }

  // ── Selector de turno ──
  function abrirPop(boton) {
    var a = agentePorId(boton.dataset.u), f = fechaSel(), t = a.dias[f];
    var shortday = $('hr-short').checked, cur = turnoDe(t);
    state.pop = { id: a.id };

    function opcion(accion, nombre, meta, color, esActual) {
      return '<button type="button" class="hr-opt' + (esActual ? ' cur' : '') + '" data-op="' + accion + '">' +
        '<span><i style="background:' + color + '"></i>' + nombre + '</span><small>' + meta + '</small></button>';
    }
    var completos = TURNOS.map(function (T) {
      return opcion('full:' + T.k, T.corto, fmtHoras(horasTurno({ start: T.s, end: T.e, break_minutes: 60 })) + ' + 1 h comida', T.color, cur && cur.turno === T && !cur.sd);
    }).join('');
    var cortos = TURNOS.filter(function (T) { return T.sd; }).map(function (T) {
      return opcion('sd:' + T.k, T.sdCorto, '4 h', T.color, cur && cur.turno === T && cur.sd);
    }).join('');
    var grupos = shortday
      ? '<div class="hr-pop-group">Shortday · 4 h</div>' + cortos + '<div class="hr-pop-group">Jornada completa</div>' + completos
      : '<div class="hr-pop-group">Jornada completa</div>' + completos + '<div class="hr-pop-group">Shortday · 4 h</div>' + cortos;
    var propio = trabaja(t) && !cur;
    var libre = t && t.rest_day && !esVacaciones(t);

    var pop = $('hr-pop');
    pop.innerHTML =
      '<div class="hr-pop-title">' + esc(nombreDe(a)) + ' · ' + DIAS[state.dia] + ' ' + f.slice(8) + (shortday ? ' · shortday' : '') + '</div>' +
      grupos +
      '<div class="hr-pop-group">Otros</div>' +
      opcion('libre', 'Libre', '', 'var(--hr-libre)', libre) +
      opcion('vac', VACACIONES, '', 'var(--hr-vac)', esVacaciones(t)) +
      opcion('otro', 'Otro horario…', propio ? h12(t.start) + '–' + h12(t.end) : '', 'var(--hr-x)', propio) +
      '<div class="hr-custom" id="hp-custom" hidden>' +
      '<div class="row"><label>Entrada<input class="hr-input" type="time" id="hp-start" value="' + esc(trabaja(t) ? t.start : '09:00') + '"></label>' +
      '<label>Salida<input class="hr-input" type="time" id="hp-end" value="' + esc(trabaja(t) ? t.end : '18:00') + '"></label></div>' +
      '<div class="hint" id="hp-hint"></div>' +
      '<div class="row"><label>Comida (min)<input class="hr-input" type="number" id="hp-break" min="0" max="480" step="5" value="' + (trabaja(t) ? (t.break_minutes || 0) : 60) + '"></label>' +
      '<label>Nota<input class="hr-input" id="hp-notes" maxlength="500" value="' + esc(t && !esVacaciones(t) ? (t.notes || '') : '') + '"></label></div>' +
      '<button type="button" class="hr-btn hr-btn-sm" data-op="otro-ok">Aplicar</button></div>' +
      '<div class="hr-pop-foot">' +
      '<button type="button" class="hr-btn hr-btn-ghost hr-btn-sm" data-op="semana"' + (t ? '' : ' disabled') + '>Aplicar ' + esc(t ? etiquetaCorta(t) : '') + ' a Lun–Sáb</button>' +
      '<button type="button" class="hr-btn hr-btn-ghost hr-btn-sm" data-op="vaciar"' + (t ? '' : ' disabled') + '>Vaciar día</button></div>';

    pop.hidden = false;
    $('hr-pop-bg').hidden = false;
    var r = boton.getBoundingClientRect();
    var x = Math.min(Math.max(8, (window.__hrClickX || r.left + 20)), window.innerWidth - pop.offsetWidth - 8);
    var y = r.bottom + 6;
    if (y + pop.offsetHeight > window.innerHeight - 8) y = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    var foco = pop.querySelector('.hr-opt.cur') || pop.querySelector('.hr-opt');
    if (foco) foco.focus();

    function hint() {
      var s = $('hp-start').value, e = $('hp-end').value;
      $('hp-hint').textContent = s && e && horas(e) <= horas(s) ? 'Turno nocturno: termina el día siguiente.' : '';
    }
    $('hp-start').addEventListener('input', hint);
    $('hp-end').addEventListener('input', hint);
    hint();

    pop.onclick = function (ev) {
      var b = ev.target.closest('[data-op]');
      if (!b || b.disabled) return;
      var op = b.dataset.op, nota = t && !esVacaciones(t) ? (t.notes || null) : null;
      if (op.indexOf('full:') === 0 || op.indexOf('sd:') === 0) {
        var T = TURNOS.find(function (x) { return x.k === op.split(':')[1]; });
        var corto = op.indexOf('sd:') === 0;
        asignar(a, [f], { start: corto ? T.sd[0] : T.s, end: corto ? T.sd[1] : T.e, break_minutes: corto ? 0 : 60, rest_day: false, notes: nota });
      } else if (op === 'libre') {
        asignar(a, [f], { rest_day: true, break_minutes: 0, notes: nota });
      } else if (op === 'vac') {
        asignar(a, [f], { rest_day: true, break_minutes: 0, notes: VACACIONES });
      } else if (op === 'otro') {
        $('hp-custom').hidden = false;
        // Al crecer puede salirse por abajo: se sube lo necesario.
        var alto = pop.getBoundingClientRect();
        if (alto.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, window.innerHeight - alto.height - 8) + 'px';
        $('hp-start').focus();
      } else if (op === 'otro-ok') {
        var s = $('hp-start').value, e = $('hp-end').value;
        if (!s || !e) return toast('Indique entrada y salida', true);
        if (s === e) return toast('La entrada y la salida no pueden ser iguales', true);
        asignar(a, [f], { start: s, end: e, break_minutes: Math.max(0, Math.min(480, +$('hp-break').value || 0)), rest_day: false, notes: $('hp-notes').value.trim() || null });
      } else if (op === 'semana') {
        var n = asignar(a, state.data.dias.slice(0, 6), t);
        toast(n ? etiquetaCorta(t) + ' aplicado a ' + n + ' día(s). Recuerde guardar.' : 'Esos días ya pasaron y no se pueden editar.', !n);
      } else if (op === 'vaciar') {
        asignar(a, [f], null);
      }
    };
    pop.onkeydown = function (ev) {
      if (ev.key === 'Enter' && ev.target.closest('#hp-custom') && ev.target.tagName === 'INPUT') { ev.preventDefault(); pop.querySelector('[data-op="otro-ok"]').click(); }
    };
  }

  function cerrarPop() {
    $('hr-pop').hidden = true;
    $('hr-pop-bg').hidden = true;
    state.pop = null;
  }

  // ── Acciones ──
  async function guardar() {
    var ids = Object.keys(state.dirty);
    if (!ids.length) return true;
    var payload = {
      inicio: state.inicio,
      agentes: ids.map(function (id) {
        var a = agentePorId(id);
        return {
          user_id: +id,
          version: a.version,  // si otro guardó entretanto, el servidor responde 409
          dias: Object.keys(a.dias).map(function (f) {
            var t = a.dias[f];
            return { date: f, start: t.start || null, end: t.end || null, break_minutes: t.break_minutes || 0, rest_day: !!t.rest_day, notes: t.notes || null };
          }),
        };
      }),
    };
    var b = $('hr-save');
    b.disabled = true;
    b.textContent = 'Guardando…';
    try {
      var r = await api('PUT', '/api/horarios/semana', payload);
      state.dirty = {};
      // omitidos: días que pasaron a ser pasados con la página abierta (p. ej. tras la medianoche).
      if (r.omitidos) toast('Guardado, pero ' + r.omitidos + ' día(s) ya pasados no se guardaron: esos los corrige RRHH en Cuadratura.', true);
      else toast('Horarios guardados (' + r.guardados + ' días). Se enviarán a Cuadratura automáticamente.');
      await cargar();
      return true;
    } catch (e) {
      renderGuardar();
      if (e.status === 409) {
        // Nada se guardó. Los cambios siguen en pantalla hasta que el usuario decida.
        if (confirm(e.message + '\n\n¿Recargar ahora? (Aceptar descarta sus cambios sin guardar; Cancelar los mantiene en pantalla para anotarlos.)')) {
          state.dirty = {};
          await cargar();
        }
        return false;
      }
      toast(e.message, true);
      return false;
    }
  }

  async function guardarReloj(input) {
    var a = agentePorId(input.dataset.reloj);
    var val = input.value.trim();
    if ((a.reloj_id || '') === val) return;
    try {
      var r = await api('PUT', '/api/horarios/reloj/' + a.id, { reloj_id: val || null });
      a.reloj_id = r.reloj_id;
      input.value = r.reloj_id || '';
      input.classList.toggle('missing', !r.reloj_id);
      toast(r.reloj_id ? 'ID de reloj de ' + nombreDe(a) + ': ' + r.reloj_id : 'ID de reloj quitado a ' + nombreDe(a));
    } catch (e) {
      input.value = a.reloj_id || '';
      toast(e.message, true);
    }
  }

  async function editarNombre(id) {
    var a = agentePorId(id);
    var val = prompt('Nombre completo de ' + (a.name || a.username) + ' (usuario CRM: ' + a.username + '):', a.nombre_completo || '');
    if (val === null) return;
    val = val.trim().replace(/\s+/g, ' ');
    if (val === (a.nombre_completo || '')) return;
    try {
      var r = await api('PUT', '/api/horarios/nombre/' + a.id, { nombre_completo: val || null });
      a.nombre_completo = r.nombre_completo;
      renderTablero();
      toast(r.nombre_completo ? 'Nombre completo guardado: ' + nombreDe(a) : 'Nombre completo quitado a ' + a.username);
    } catch (e) { toast(e.message, true); }
  }

  async function editarIngreso(id) {
    var a = agentePorId(id);
    var val = prompt('Fecha de ingreso de ' + nombreDe(a) + ' (dd/mm/aaaa; vacío para quitarla):', a.fecha_ingreso ? fmtFechaCorta(a.fecha_ingreso) : '');
    if (val === null) return;
    val = val.trim();
    var iso = null;
    if (val) {
      var m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return toast('Use el formato dd/mm/aaaa, p. ej. 16/09/2026', true);
      iso = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    if (iso === (a.fecha_ingreso || null)) return;
    try {
      var r = await api('PUT', '/api/horarios/ingreso/' + a.id, { fecha_ingreso: iso });
      a.fecha_ingreso = r.fecha_ingreso;
      renderTablero();
      toast(r.fecha_ingreso ? 'Fecha de ingreso de ' + nombreDe(a) + ': ' + fmtFechaCorta(r.fecha_ingreso) : 'Fecha de ingreso quitada');
    } catch (e) { toast(e.message, true); }
  }

  async function copiarAnterior() {
    if (Object.keys(state.dirty).length) return toast('Guarde o descarte los cambios antes de copiar', true);
    if (!confirm('Se copiarán los horarios de la semana anterior' + (state.equipo ? ' (solo ' + state.equipo + ')' : '') +
      ' y reemplazarán los de esta semana de los agentes que tengan algo que copiar. ¿Continuar?')) return;
    try {
      var r = await api('POST', '/api/horarios/copiar', { desde: addDays(state.inicio, -7), hacia: state.inicio, equipo: state.equipo });
      toast(r.copiados ? r.copiados + ' días copiados de la semana anterior (' + r.agentes + ' agentes).' : 'La semana anterior no tiene horarios que copiar.', !r.copiados);
      await cargar();
    } catch (e) { toast(e.message, true); }
  }

  // Con cambios sin guardar, primero guarda y luego envía.
  async function enviar() {
    var btn = $('hr-send');
    btn.disabled = true;
    try {
      if (Object.keys(state.dirty).length && !(await guardar())) return;
      var r = await api('POST', '/api/horarios/enviar', { inicio: state.inicio });
      var msg = {
        ok: 'Semana enviada a Cuadratura.',
        parcial: 'Enviada con observaciones: revise el detalle.',
        sin_cambios: 'Cuadratura ya tiene esta semana al día.',
        sin_agentes: 'No hay horarios que enviar esta semana.',
        error: 'No se pudo enviar: ' + (r.error || ''),
      }[r.estado] || r.estado;
      toast(msg, r.estado === 'error');
      await cargar();
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }

  function irSemana(delta) {
    var prev = state.inicio;
    state.inicio = delta ? addDays(state.inicio, delta) : null;
    cargar().then(function (ok) { if (!ok) state.inicio = prev; });
  }

  // ── Eventos ──
  function bind() {
    $('hr-prev').onclick = function () { irSemana(-7); };
    $('hr-next').onclick = function () { irSemana(7); };
    $('hr-today').onclick = function () { irSemana(0); };
    $('hr-team').onchange = function (e) { state.equipo = e.target.value; cargar(); };
    $('hr-search').oninput = function (e) { state.busqueda = e.target.value; renderDia(); };
    $('hr-save').onclick = guardar;
    $('hr-copy').onclick = copiarAnterior;
    $('hr-send').onclick = enviar;
    $('hr-short').onchange = function (e) { cambiarShortday(e.target.checked); };
    $('hr-days').onclick = function (e) {
      var b = e.target.closest('[data-dia]');
      if (!b) return;
      state.dia = +b.dataset.dia;
      cerrarPop();
      renderDia();
    };
    $('hr-days').onkeydown = function (e) {   // flechas entre pestañas
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      state.dia = (state.dia + (e.key === 'ArrowRight' ? 1 : 6)) % 7;
      renderDia();
      $('hr-days').querySelector('.sel').focus();
    };

    var board = $('hr-board');
    board.addEventListener('click', function (e) {
      var tg = e.target.closest('[data-tg]');
      if (tg) {
        var k = tg.dataset.tg;
        if (state.colapsados[k]) delete state.colapsados[k]; else state.colapsados[k] = true;
        renderTablero();
        return;
      }
      var ed = e.target.closest('[data-nombre]');
      if (ed) { editarNombre(ed.dataset.nombre); return; }
      var ing = e.target.closest('[data-ingreso]');
      if (ing) { editarIngreso(ing.dataset.ingreso); return; }
      var linea = e.target.closest('.hr-line');
      if (linea && !linea.disabled && state.data.puede_editar) {
        window.__hrClickX = e.clientX || null;
        abrirPop(linea);
      }
    });
    board.addEventListener('change', function (e) { if (e.target.dataset.reloj) guardarReloj(e.target); });
    board.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.dataset.reloj) e.target.blur(); });

    $('hr-pop-bg').onclick = cerrarPop;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.pop) cerrarPop(); });
    window.addEventListener('beforeunload', function (e) {
      if (Object.keys(state.dirty).length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    cargar();
  });
})();
