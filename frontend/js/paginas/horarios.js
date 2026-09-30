/**
 * Horarios de agentes (horarios.html).
 *
 * Supervisor / admin: editan la semana (clic en una celda), asignan el ID de reloj de
 * cada agente, copian la semana anterior y guardan. Lo guardado se envía solo al
 * Sistema de Cuadratura (o al momento con "Enviar a Cuadratura").
 * Agente: ve su propio horario, sin editar.
 *
 * API: /api/horarios/* (CRM_PYTHON/routers/horarios.py)
 */
(function () {
  'use strict';

  var DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

  var state = {
    inicio: null,        // lunes AAAA-MM-DD
    data: null,          // respuesta de GET /api/horarios/semana
    dirty: {},           // user_id → true
    selected: {},        // user_id → true
    equipo: '',
    busqueda: '',
    bulkDays: [0, 1, 2, 3, 4],
    colapsados: {},      // clave de equipo → true
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Fechas (AAAA-MM-DD, sin zona: se manejan como texto/UTC) ──
  function addDays(ymd, n) {
    var d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtCorta(ymd) {
    var d = new Date(ymd + 'T00:00:00Z');
    return d.getUTCDate() + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()];
  }
  function fmtFechaHora(iso) {
    if (!iso) return '';
    var d = new Date(iso.replace(' ', 'T'));
    return isNaN(d) ? iso : d.toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function minutos(hhmm) { var p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function horasTurno(t) {
    if (!t || t.rest_day || !t.start || !t.end) return 0;
    var m = minutos(t.end) - minutos(t.start);
    if (m <= 0) m += 1440;
    return Math.max(m - (t.break_minutes || 0), 0) / 60;
  }
  function fmtHoras(h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm ? hh + 'h ' + mm + 'm' : hh + 'h';
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
    $('hr-content').innerHTML = '<div class="hr-loading">Cargando…</div>';
    try {
      var q = '/api/horarios/semana?inicio=' + encodeURIComponent(state.inicio || '') +
        '&equipo=' + encodeURIComponent(state.equipo);
      state.data = await api('GET', q);
    } catch (e) {
      $('hr-content').innerHTML = '<div class="hr-empty">No se pudieron cargar los horarios: ' + esc(e.message) + '</div>';
      return false;
    }
    state.inicio = state.data.inicio;
    state.dirty = {};
    state.selected = {};
    render();
    return true;
  }

  function editable(fecha) {
    var d = state.data;
    return d.puede_editar && (!d.editable_desde || fecha >= d.editable_desde);
  }

  // ── Render ──
  function render() {
    var d = state.data;
    $('hr-toolbar').hidden = false;
    $('hr-legend').hidden = false;
    $('hr-actions').hidden = !d.puede_editar;
    $('hr-bulk').hidden = !d.puede_editar;
    if (!d.puede_editar) {
      document.body.classList.add('hr-readonly');
      document.querySelector('.hr-eyebrow').textContent = 'Mi horario';
      $('hr-sub').textContent = 'Este es tu horario de la semana, cargado por tu supervisor.';
      $('hr-search').hidden = true;
      $('hr-legend').lastElementChild.hidden = true;  // "Cambio sin guardar" no aplica
    }
    $('hr-week-label').textContent = fmtCorta(d.inicio) + ' – ' + fmtCorta(d.fin) + ' ' + d.fin.slice(0, 4);

    var sel = $('hr-team');
    if (d.es_admin && d.equipos.length) {
      sel.hidden = false;
      sel.innerHTML = '<option value="">Todos los equipos</option>' + d.equipos.map(function (t) {
        return '<option' + (t === state.equipo ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('');
    }
    renderStatus();
    renderGrid();
    renderSaveBtn();
  }

  function renderStatus() {
    var d = state.data, el = $('hr-status');
    if (!d.puede_editar) { el.hidden = true; return; }
    el.hidden = false;
    var u = d.ultimo_envio;
    if (!d.cuadratura_configurada) {
      el.className = 'hr-status warn';
      el.innerHTML = '<span class="dot"></span> La conexión con el Sistema de Cuadratura aún no está configurada en el servidor. Los horarios se guardan, pero no se envían.';
      return;
    }
    if (!u) {
      el.className = 'hr-status';
      el.innerHTML = '<span class="dot"></span> Esta semana todavía no se ha enviado a Cuadratura. Se envía sola al guardar (en unos minutos) o con “Enviar a Cuadratura”.';
      return;
    }
    var r = u.resumen || {};
    var obs = (r.observaciones || []);
    var cls = u.estado === 'ok' ? 'ok' : (u.estado === 'parcial' ? 'warn' : 'err');
    var txt = u.estado === 'error'
      ? 'Falló el último envío a Cuadratura (' + fmtFechaHora(u.fecha) + '): ' + esc(u.error || '')
      : 'Enviado a Cuadratura el <b>' + esc(fmtFechaHora(u.fecha)) + '</b>' + (u.origen === 'auto' ? ' (automático)' : ' por ' + esc(u.enviado_por || '')) +
        ' · ' + (r.shifts_created || 0) + ' turnos nuevos, ' + (r.shifts_updated || 0) + ' cambiados, ' + (r.shifts_removed || 0) + ' quitados';
    var html = '<span class="dot"></span> <span>' + txt + '</span>';
    if (obs.length) {
      html += '<details><summary>' + obs.length + ' agente(s) con observaciones</summary><ul>' + obs.map(function (o) {
        var ag = (d.agentes.find(function (a) { return String(a.id) === String(o.crm_agent_id); }) || {}).name || ('ID CRM ' + o.crm_agent_id);
        var extra = (o.conflict_dates || []).length ? ' (' + o.conflict_dates.join(', ') + ')' : '';
        return '<li><b>' + esc(ag) + ':</b> ' + esc(o.message || o.status) + esc(extra) + '</li>';
      }).join('') + '</ul></details>';
    }
    el.className = 'hr-status ' + cls;
    el.innerHTML = html;
  }

  function agentesFiltrados() {
    var q = state.busqueda.trim().toLowerCase();
    return state.data.agentes.filter(function (a) {
      return !q || (a.name || '').toLowerCase().indexOf(q) >= 0 || (a.username || '').toLowerCase().indexOf(q) >= 0 ||
        String(a.reloj_id || '') === q || (a.team || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function cellHtml(a, fecha) {
    var t = a.dias[fecha];
    var dis = !editable(fecha);
    var dirty = a._dirtyDays && a._dirtyDays[fecha] ? ' dirty' : '';
    var attrs = ' data-u="' + a.id + '" data-f="' + fecha + '"' + (dis ? ' disabled' : '');
    if (!t) return '<button class="hr-cell' + dirty + '"' + attrs + ' aria-label="Sin horario">' + (dis ? '—' : '<i class="fas fa-plus"></i>') + '</button>';
    if (t.rest_day) return '<button class="hr-cell rest' + dirty + '"' + attrs + '>Libre</button>';
    var night = minutos(t.end) <= minutos(t.start);
    return '<button class="hr-cell shift' + (night ? ' night' : '') + dirty + '"' + attrs + ' title="' + esc(t.notes || '') + '">' +
      '<b>' + esc(t.start) + '–' + esc(t.end) + '</b><small>' + (t.break_minutes || 0) + ' min desc.' + (t.notes ? ' · 📝' : '') + '</small></button>';
  }

  function renderGrid() {
    var d = state.data;
    var lista = agentesFiltrados();
    if (!d.agentes.length) {
      $('hr-content').innerHTML = '<div class="hr-empty">' + (d.puede_editar
        ? 'No hay agentes activos asignados a usted. Revise en Permisos que sus agentes tengan su nombre como supervisor.'
        : 'No se encontró su usuario de agente.') + '</div>';
      return;
    }
    var head = '<tr><th>' + (d.puede_editar ? '<label class="hr-agent"><input type="checkbox" id="hr-all" aria-label="Seleccionar todos"> Agente · ID reloj</label>' : 'Agente') + '</th>' +
      d.dias.map(function (f, i) {
        var cls = f === d.hoy ? 'today' : (f < d.hoy ? 'past' : '');
        return '<th class="' + cls + '">' + DIAS[i] + ' ' + f.slice(8) + '</th>';
      }).join('') + '<th>Total</th></tr>';

    function totalAgente(a) {
      return d.dias.reduce(function (s, f) { return s + horasTurno(a.dias[f]); }, 0);
    }

    function filaAgente(a) {
      var reloj = d.puede_editar
        ? '<input class="' + (a.reloj_id ? '' : 'missing') + '" data-reloj="' + a.id + '" value="' + esc(a.reloj_id || '') + '" placeholder="?" inputmode="numeric" maxlength="32" aria-label="ID de reloj de ' + esc(a.name) + '">'
        : '<b>' + esc(a.reloj_id || '—') + '</b>';
      return '<tr><td><div class="hr-agent">' +
        (d.puede_editar ? '<input type="checkbox" data-sel="' + a.id + '"' + (state.selected[a.id] ? ' checked' : '') + ' aria-label="Seleccionar ' + esc(a.name) + '">' : '') +
        '<div><div class="hr-agent-name" title="' + esc(a.name) + '">' + esc(a.name) + '</div><div class="hr-agent-team">' + esc(a.username || '') + (a.es_supervisor ? ' · <b>Supervisor</b>' : '') + '</div></div>' +
        '<div class="hr-reloj"><span>Reloj</span>' + reloj + '</div></div></td>' +
        d.dias.map(function (f) { return '<td>' + cellHtml(a, f) + '</td>'; }).join('') +
        '<td class="hr-total">' + fmtHoras(totalAgente(a)) + '</td></tr>';
    }

    // Una sección por equipo, con su supervisor en la cabecera (plegable), bajo su área.
    var buscando = !!state.busqueda.trim();
    var seccionActual = null;
    var rows = (d.grupos || []).map(function (g) {
      var miembros = lista.filter(function (a) { return a.grupo === g.clave; })
        .sort(function (x, y) { return (x.name || '').localeCompare(y.name || '', 'es'); });
      if (!miembros.length) return '';
      var abierto = buscando || !state.colapsados[g.clave];
      var todos = miembros.every(function (a) { return state.selected[a.id]; });
      var horas = miembros.reduce(function (s, a) { return s + totalAgente(a); }, 0);
      var sinReloj = miembros.filter(function (a) { return !a.reloj_id; }).length;
      var cab = '<tr class="hr-group' + (abierto ? '' : ' closed') + '"><td colspan="9"><div class="hr-group-in">' +
        '<button type="button" class="hr-group-tg" data-tg="' + esc(g.clave) + '" aria-expanded="' + abierto + '" aria-label="Mostrar u ocultar ' + esc(g.team || 'Sin equipo') + '"><i class="fas fa-chevron-down"></i></button>' +
        (d.puede_editar ? '<input type="checkbox" data-gsel="' + esc(g.clave) + '"' + (todos ? ' checked' : '') + ' aria-label="Seleccionar todo ' + esc(g.team || 'Sin equipo') + '">' : '') +
        '<div class="hr-group-name">' + esc(g.team || 'Sin equipo') + '</div>' +
        '<div class="hr-group-sup' + (g.supervisor ? '' : ' none') + '"><i class="fas fa-user-tie"></i> ' +
        (g.supervisor ? esc(g.supervisor) : (g.clave ? 'Sin supervisor asignado' : 'Agentes sin equipo')) + '</div>' +
        '<div class="hr-group-meta">' + miembros.length + ' agente' + (miembros.length === 1 ? '' : 's') + ' · ' + fmtHoras(horas) +
        (d.puede_editar && sinReloj ? ' · <span class="warn">' + sinReloj + ' sin reloj</span>' : '') + '</div>' +
        '</div></td></tr>';
      var sep = '';
      if (g.seccion !== seccionActual) {
        seccionActual = g.seccion;
        sep = '<tr class="hr-section"><td colspan="9"><div class="hr-section-in">' +
          (g.seccion === 'lineas' ? '<i class="fas fa-sim-card"></i> Líneas' : '<i class="fas fa-house"></i> Residencial') + '</div></td></tr>';
      }
      return sep + cab + (abierto ? miembros.map(filaAgente).join('') : '');
    }).join('');

    $('hr-content').innerHTML = '<table class="hr-grid"><thead>' + head + '</thead><tbody>' +
      (rows || '<tr><td colspan="9" class="hr-empty">Ningún agente coincide con la búsqueda.</td></tr>') + '</tbody></table>';
    actualizarConteoSeleccion();
  }

  function renderSaveBtn() {
    var n = Object.keys(state.dirty).length;
    $('hr-save').disabled = !n;
    $('hr-save-label').textContent = n ? 'Guardar (' + n + ')' : 'Guardar';
  }

  function marcarCambio(a, fecha) {
    state.dirty[a.id] = true;
    a._dirtyDays = a._dirtyDays || {};
    a._dirtyDays[fecha] = true;
  }

  function agentePorId(id) {
    return state.data.agentes.find(function (a) { return String(a.id) === String(id); });
  }

  // ── Editor emergente de un día ──
  function abrirEditor(btn) {
    var a = agentePorId(btn.dataset.u), fecha = btn.dataset.f;
    var t = a.dias[fecha] || { start: '08:00', end: '17:00', break_minutes: 60, notes: '' };
    var idx = state.data.dias.indexOf(fecha);
    var pop = $('hr-pop');
    pop.innerHTML =
      '<h4>' + esc(a.name) + ' · ' + DIAS_LARGOS[idx] + ' ' + fecha.slice(8) + '</h4>' +
      '<div class="row"><label class="hr-field"><span>Entrada</span><input class="hr-input" type="time" id="hp-start" value="' + esc(t.start || '08:00') + '"></label>' +
      '<label class="hr-field"><span>Salida</span><input class="hr-input" type="time" id="hp-end" value="' + esc(t.end || '17:00') + '"></label></div>' +
      '<div class="hint" id="hp-hint"></div>' +
      '<label class="hr-field"><span>Descanso (min)</span><input class="hr-input" type="number" id="hp-break" min="0" max="480" step="5" value="' + (t.rest_day ? 60 : (t.break_minutes || 0)) + '"></label>' +
      '<label class="hr-field"><span>Nota (opcional)</span><input class="hr-input" id="hp-notes" maxlength="500" value="' + esc(t.notes || '') + '"></label>' +
      '<div class="btns"><button class="hr-btn" id="hp-ok">Aplicar</button><button class="hr-btn hr-btn-ghost" id="hp-rest">Libre</button><button class="hr-btn hr-btn-danger" id="hp-clear" title="Quitar horario">Quitar</button></div>';
    pop.hidden = false;
    var r = btn.getBoundingClientRect();
    var left = Math.min(r.left, window.innerWidth - 296);
    var top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = top + 'px';

    function hint() {
      var s = $('hp-start').value, e = $('hp-end').value;
      $('hp-hint').textContent = s && e && minutos(e) <= minutos(s) ? 'Turno nocturno: termina el día siguiente.' : '';
    }
    $('hp-start').addEventListener('input', hint);
    $('hp-end').addEventListener('input', hint);
    hint();
    $('hp-start').focus();

    function cerrarYPintar() { cerrarEditor(); marcarCambio(a, fecha); renderGrid(); renderSaveBtn(); }
    $('hp-ok').onclick = function () {
      var s = $('hp-start').value, e = $('hp-end').value;
      if (!s || !e) return toast('Indique entrada y salida', true);
      if (s === e) return toast('La entrada y la salida no pueden ser iguales', true);
      a.dias[fecha] = { start: s, end: e, break_minutes: Math.max(0, Math.min(480, +$('hp-break').value || 0)), rest_day: false, notes: $('hp-notes').value.trim() || null };
      cerrarYPintar();
    };
    $('hp-rest').onclick = function () { a.dias[fecha] = { rest_day: true, break_minutes: 0, notes: $('hp-notes').value.trim() || null }; cerrarYPintar(); };
    $('hp-clear').onclick = function () { delete a.dias[fecha]; cerrarYPintar(); };
    pop.onkeydown = function (ev) { if (ev.key === 'Enter') $('hp-ok').click(); };
  }

  function cerrarEditor() { $('hr-pop').hidden = true; }

  // ── Acciones ──
  async function guardar() {
    var ids = Object.keys(state.dirty);
    if (!ids.length) return;
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
    $('hr-save').disabled = true;
    try {
      var r = await api('PUT', '/api/horarios/semana', payload);
      state.dirty = {};
      // omitidos: días que pasaron a ser pasados con la página abierta (p.ej. tras la medianoche).
      if (r.omitidos) toast('Guardado, pero ' + r.omitidos + ' día(s) ya pasados no se guardaron: esos los corrige RRHH en Cuadratura.', true);
      else toast('Horarios guardados (' + r.guardados + ' días). Se enviarán a Cuadratura automáticamente.');
      await cargar();
    } catch (e) {
      renderSaveBtn();
      if (e.status === 409) {
        // Nada se guardó. Los cambios siguen en pantalla hasta que el usuario decida.
        if (confirm(e.message + '\n\n¿Recargar ahora? (Aceptar descarta sus cambios sin guardar; Cancelar los mantiene en pantalla para anotarlos.)')) {
          state.dirty = {};
          await cargar();
        }
        return;
      }
      toast(e.message, true);
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
      toast(r.reloj_id ? 'ID de reloj de ' + a.name + ': ' + r.reloj_id : 'ID de reloj quitado a ' + a.name);
    } catch (e) {
      input.value = a.reloj_id || '';
      toast(e.message, true);
    }
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

  async function enviar() {
    if (Object.keys(state.dirty).length) return toast('Guarde los cambios antes de enviar', true);
    var btn = $('hr-send');
    btn.disabled = true;
    try {
      var r = await api('POST', '/api/horarios/enviar', { inicio: state.inicio });
      var msg = {
        ok: 'Semana enviada a Cuadratura.',
        parcial: 'Enviada con observaciones: revise el detalle.',
        sin_cambios: 'Cuadratura ya tiene esta semana al día.',
        sin_agentes: 'No hay agentes para enviar.',
        error: 'No se pudo enviar: ' + (r.error || ''),
      }[r.estado] || r.estado;
      toast(msg, r.estado === 'error');
      await cargar();
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }

  function aplicarBulk(libre) {
    var ids = Object.keys(state.selected);
    if (!ids.length) return toast('Seleccione agentes en la tabla', true);
    if (!state.bulkDays.length) return toast('Elija al menos un día', true);
    var s = $('hr-b-start').value, e = $('hr-b-end').value;
    if (!libre && (!s || !e || s === e)) return toast('Revise la entrada y la salida', true);
    var n = 0;
    ids.forEach(function (id) {
      var a = agentePorId(id);
      state.bulkDays.forEach(function (i) {
        var f = state.data.dias[i];
        if (!editable(f)) return;
        a.dias[f] = libre ? { rest_day: true, break_minutes: 0 } :
          { start: s, end: e, break_minutes: Math.max(0, +$('hr-b-break').value || 0), rest_day: false };
        marcarCambio(a, f);
        n++;
      });
    });
    renderGrid();
    renderSaveBtn();
    toast(n ? n + ' días asignados. Recuerde guardar.' : 'Esos días ya pasaron y no se pueden editar.', !n);
  }

  function actualizarConteoSeleccion() {
    var n = Object.keys(state.selected).length;
    $('hr-b-count').textContent = n ? n + ' agente(s) seleccionado(s)' : 'Seleccione agentes en la tabla';
  }

  function renderBulkDays() {
    $('hr-b-days').innerHTML = DIAS.map(function (d, i) {
      return '<button type="button" class="hr-day-tg' + (state.bulkDays.indexOf(i) >= 0 ? ' on' : '') + '" data-bd="' + i + '" aria-pressed="' + (state.bulkDays.indexOf(i) >= 0) + '">' + d[0] + '</button>';
    }).join('');
  }

  // ── Eventos ──
  function bind() {
    $('hr-prev').onclick = function () { var prev = state.inicio; state.inicio = addDays(state.inicio, -7); cargar().then(function (ok) { if (!ok) state.inicio = prev; }); };
    $('hr-next').onclick = function () { var prev = state.inicio; state.inicio = addDays(state.inicio, 7); cargar().then(function (ok) { if (!ok) state.inicio = prev; }); };
    $('hr-today').onclick = function () { state.inicio = null; cargar(); };
    $('hr-team').onchange = function (e) { state.equipo = e.target.value; cargar(); };
    $('hr-search').oninput = function (e) { state.busqueda = e.target.value; renderGrid(); };
    $('hr-save').onclick = guardar;
    $('hr-copy').onclick = copiarAnterior;
    $('hr-send').onclick = enviar;
    $('hr-b-apply').onclick = function () { aplicarBulk(false); };
    $('hr-b-rest').onclick = function () { aplicarBulk(true); };
    $('hr-b-days').onclick = function (e) {
      var b = e.target.closest('[data-bd]');
      if (!b) return;
      var i = +b.dataset.bd, pos = state.bulkDays.indexOf(i);
      if (pos >= 0) state.bulkDays.splice(pos, 1); else state.bulkDays.push(i);
      renderBulkDays();
    };

    var content = $('hr-content');
    content.addEventListener('click', function (e) {
      var tg = e.target.closest('[data-tg]');
      if (tg) {
        var k = tg.dataset.tg;
        if (state.colapsados[k]) delete state.colapsados[k]; else state.colapsados[k] = true;
        cerrarEditor();
        renderGrid();
        return;
      }
      var cell = e.target.closest('.hr-cell');
      if (cell && !cell.disabled && state.data.puede_editar) { e.stopPropagation(); abrirEditor(cell); }
    });
    content.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.sel) {
        if (t.checked) state.selected[t.dataset.sel] = true; else delete state.selected[t.dataset.sel];
        renderGrid();
      } else if (t.dataset.gsel != null) {
        agentesFiltrados().forEach(function (a) {
          if (a.grupo !== t.dataset.gsel) return;
          if (t.checked) state.selected[a.id] = true; else delete state.selected[a.id];
        });
        renderGrid();
      } else if (t.id === 'hr-all') {
        agentesFiltrados().forEach(function (a) { if (t.checked) state.selected[a.id] = true; else delete state.selected[a.id]; });
        renderGrid();
      } else if (t.dataset.reloj) {
        guardarReloj(t);
      }
    });
    content.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.dataset.reloj) e.target.blur();
    });

    document.addEventListener('mousedown', function (e) {
      var pop = $('hr-pop');
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.hr-cell')) cerrarEditor();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarEditor(); });
    window.addEventListener('beforeunload', function (e) {
      if (Object.keys(state.dirty).length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderBulkDays();
    bind();
    cargar();
  });
})();
