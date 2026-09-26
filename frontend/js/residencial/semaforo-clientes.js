/**
 * El Semáforo — página doble.
 *
 * 1) El volteo: la página tiene dos caras (ventas / clientes) en un .libro. Los
 *    botones [data-voltear] doblan la hoja con una animación 3D. #clientes en la
 *    URL abre directamente la cara de detrás.
 *
 * 2) El semáforo de clientes: los CASOS A SOLVENTAR de las ventas completadas
 *    (/api/casos/semaforo; reglas en CRM_PYTHON/casos.py). Al pasar a completed
 *    el cliente cae en verde y el agente tiene 3 días; luego amarillo (+2) y
 *    rojo (+1). Sin comprobante, pasa solo a negro: status y status comisión
 *    «oficina». El caso se solventa subiendo el comprobante en Editar cliente.
 *    El color lo calcula el servidor; el endpoint ya filtra por rol.
 *
 * Seguridad: todo lo que viene del servidor se pinta con textContent / nodos del
 * DOM, nunca con innerHTML ni dentro de atributos de evento o de estilo.
 */
(function () {
  'use strict';

  var URL_SEMAFORO = '/api/casos/semaforo';

  var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(ym) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return ym;
    var nombre = MESES_ES[Number(m[2]) - 1] || m[2];
    return nombre.charAt(0).toUpperCase() + nombre.slice(1) + ' ' + m[1];
  }

  var ESTADOS = {
    verde:    { titulo: 'Verde',    nota: 'En plazo (3 días) o solventado' },
    amarillo: { titulo: 'Amarillo', nota: 'Días 4 y 5 sin solventar' },
    rojo:     { titulo: 'Rojo',     nota: 'Último día para solventar' },
    negro:    { titulo: 'Negro',    nota: 'Pasó a oficina' }
  };
  // Orden de la cartera y del poste: verde → amarillo → rojo → negro.
  var ORDEN = ['verde', 'amarillo', 'rojo', 'negro'];
  var POS = { verde: 0, amarillo: 1, rojo: 2, negro: 3 };

  // ── Utilidades ─────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // Crea un elemento. Los hijos que son texto se añaden como nodos de texto:
  // nunca se interpreta HTML.
  function el(tag, props, hijos) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') { n.textContent = String(v); return; }
        if (k === 'on') { Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); }); return; }
        if (k === 'class') { n.className = String(v); return; }
        n.setAttribute(k, String(v));
      });
    }
    (hijos || []).forEach(function (h) {
      if (h === null || h === undefined || h === false) return;
      n.appendChild(typeof h === 'string' || typeof h === 'number' ? document.createTextNode(String(h)) : h);
    });
    return n;
  }

  function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function punto(estado) { return el('span', { class: 'sc-punto is-' + estado, 'aria-hidden': 'true' }); }
  function reduceMovimiento() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function tokenActual() {
    try { return sessionStorage.getItem('token') || localStorage.getItem('token') || ''; }
    catch (_) { return ''; }
  }
  function cfgFetch() {
    var cfg = { credentials: 'include', headers: {} };
    var tk = tokenActual();
    if (tk) cfg.headers.Authorization = 'Bearer ' + tk;
    return cfg;
  }

  function normalizar(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Fechas del servidor en UTC ("2026-09-26T22:08:04" o "2026-09-26 22:08:04").
  function fechaUTC(v) {
    if (!v) return null;
    var s = String(v).replace(' ', 'T');
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function fecha(v) {
    var m = String(v == null ? '' : v).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  function fechaHora(v) {
    var d = fechaUTC(v);
    return d ? d.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function horas(h) {
    if (h == null || isNaN(h)) return '';
    var t = Math.round(h), d = Math.floor(t / 24), r = t % 24;
    return d > 0 ? d + ' d' + (r ? ' ' + r + ' h' : '') : t + ' h';
  }

  // Texto del plazo de un caso.
  function plazo(c) {
    if (c.solventado) return 'Solventado';
    if (c.color === 'negro') return 'Pasó a oficina';
    if (c.horas_restantes_color == null) return '—';
    return 'Quedan ' + horas(c.horas_restantes_color) + (c.color === 'rojo' ? ' para oficina' : ' en ' + ESTADOS[c.color].titulo.toLowerCase());
  }

  // ── Estado ─────────────────────────────────────────────────────────────
  var st = {
    clientes: [],
    meses: [],
    cargando: false,
    error: '',
    mes: '',            // '' = todos los meses (el semáforo es operativo: lo vivo)
    team: '',           // filtro de team (solo administración / backoffice)
    ambito: '',         // 'agente' | 'supervisor' | 'todos' (lo decide el servidor)
    equipos: [],
    tab: 'panel',
    filtro: 'todos',
    busqueda: '',
    sel: null
  };

  function cuenta(estado) {
    return st.clientes.filter(function (c) { return c.color === estado; }).length;
  }

  // Dentro de cada color: primero lo que va a vencer antes; los solventados al final.
  function porUrgencia(a, b) {
    if (a.solventado !== b.solventado) return a.solventado ? 1 : -1;
    var ha = a.horas_restantes_color == null ? 1e9 : a.horas_restantes_color;
    var hb = b.horas_restantes_color == null ? 1e9 : b.horas_restantes_color;
    return ha - hb;
  }

  // ── Carga ──────────────────────────────────────────────────────────────
  function pintarMeses() {
    var sel = $('sc-mes');
    if (!sel) return;
    vaciar(sel);
    sel.appendChild(el('option', { value: '', text: 'Todos los meses' }));
    st.meses.forEach(function (m) { sel.appendChild(el('option', { value: m, text: nombreMes(m) })); });
    sel.value = st.mes;
    if (sel.value !== st.mes) st.mes = '';
  }

  function pintarTeams() {
    var wrap = $('sc-team-wrap'), sel = $('sc-team');
    if (!wrap || !sel) return;
    wrap.hidden = st.ambito !== 'todos';
    if (st.ambito !== 'todos') return;
    vaciar(sel);
    sel.appendChild(el('option', { value: '', text: 'Todos los teams' }));
    st.equipos.forEach(function (t) { sel.appendChild(el('option', { value: t, text: t })); });
    sel.value = st.team;
  }

  function cargarDesdeCRM() {
    if (st.cargando) return;
    st.cargando = true;
    st.error = '';
    pintarCabecera();
    var qs = [];
    if (st.mes) qs.push('mes=' + encodeURIComponent(st.mes));
    if (st.team) qs.push('team=' + encodeURIComponent(st.team));
    fetch(URL_SEMAFORO + (qs.length ? '?' + qs.join('&') : ''), cfgFetch())
      .then(function (r) {
        if (!r.ok) throw new Error('El servidor respondió ' + r.status);
        return r.json();
      })
      .then(function (d) {
        st.cargando = false;
        st.clientes = (d && Array.isArray(d.data)) ? d.data : [];
        if (!st.mes && Array.isArray(d.meses)) { st.meses = d.meses; pintarMeses(); }
        st.ambito = d.ambito || '';
        if (!st.team && Array.isArray(d.equipos)) { st.equipos = d.equipos; pintarTeams(); }
        st.filtro = 'todos';
        pintarTodo();
      })
      .catch(function (e) {
        st.cargando = false;
        st.error = e && e.message ? e.message : 'No se pudieron cargar los clientes';
        st.clientes = [];
        pintarTodo();
      });
  }

  // ── Pintado ────────────────────────────────────────────────────────────
  function pintarTodo() {
    pintarCabecera();
    pintarPanel();
    pintarCartera();
    pintarOficina();
  }

  function pintarCabecera() {
    var a = $('sc-origen');
    if (a) {
      a.classList.toggle('is-error', !!st.error);
      var periodo = st.mes ? nombreMes(st.mes) : 'todos los meses';
      if (st.cargando) a.textContent = 'Cargando ' + periodo + '…';
      else if (st.error) a.textContent = 'No se pudo cargar: ' + st.error;
      else if (!st.clientes.length) a.textContent = 'Sin casos en ' + periodo;
      else a.textContent = st.clientes.length + ' clientes · ' + periodo + ' · ' +
        (st.ambito === 'agente' ? 'tus clientes' : st.ambito === 'supervisor' ? 'clientes de tu team' :
         (st.team ? st.team : 'todos los teams'));
    }
    var n = cuenta('negro'), badge = $('sc-tab-oficina-n');
    if (badge) {
      badge.hidden = !n;
      badge.textContent = n ? String(n) : '';
    }
  }

  function abrirPor(estado) {
    return function () {
      st.filtro = estado;
      irATab(estado === 'negro' ? 'oficina' : 'cartera', true);
    };
  }

  // 10 clientes mezclados entre los 4 colores: se toma uno de cada color por
  // turnos (rojo, amarillo, verde, negro), el más urgente primero, hasta 10.
  function mezcla(max) {
    var colas = { rojo: [], amarillo: [], verde: [], negro: [] };
    st.clientes.slice().sort(porUrgencia).forEach(function (c) { if (colas[c.color]) colas[c.color].push(c); });
    var turno = ['rojo', 'amarillo', 'verde', 'negro'], out = [];
    while (out.length < max && turno.some(function (k) { return colas[k].length; })) {
      turno.forEach(function (k) { if (out.length < max && colas[k].length) out.push(colas[k].shift()); });
    }
    return out;
  }

  function fila(c, onClick) {
    return el('button', { type: 'button', class: 'sc-urgente is-' + c.color, on: { click: onClick } }, [
      punto(c.color),
      el('b', { class: 'sc-urgente-nombre', text: c.nombre_cliente || 'SIN NOMBRE' }),
      el('span', { class: 'sc-urgente-motivo', text: (c.caso_solventar || '—') }),
      el('span', { class: 'sc-urgente-ej' }, [
        el('span', { class: 'sc-urgente-plazo', text: plazo(c) }),
        el('span', { class: 'sc-urgente-agente', text: c.agente || '—' })
      ])
    ]);
  }

  function pintarPanel() {
    ORDEN.forEach(function (e) {
      var foco = document.querySelector('[data-foco="' + e + '"]');
      if (!foco) return;
      var n = cuenta(e);
      foco.querySelector('.sc-foco-num').textContent = String(n);
      foco.classList.toggle('is-apagado', n === 0);
    });

    var tarjetas = $('sc-tarjetas');
    vaciar(tarjetas);
    ORDEN.forEach(function (e) {
      tarjetas.appendChild(el('button', { type: 'button', class: 'sc-tarjeta', on: { click: abrirPor(e) },
        'aria-label': ESTADOS[e].titulo + ': ' + cuenta(e) + ' clientes. ' + ESTADOS[e].nota }, [
        punto(e),
        el('div', { class: 'sc-tarjeta-n', text: String(cuenta(e)) }),
        el('div', { class: 'sc-tarjeta-t', text: ESTADOS[e].titulo }),
        el('div', { class: 'sc-tarjeta-d', text: ESTADOS[e].nota })
      ]));
    });

    var total = st.clientes.length;
    var solv = st.clientes.filter(function (c) { return c.solventado; }).length;
    var pend = st.clientes.filter(function (c) { return !c.solventado && c.color !== 'negro'; }).length;
    $('sc-kpi-total').textContent = String(total);
    $('sc-kpi-solventados').textContent = total ? String(solv) : '—';
    $('sc-kpi-pendientes').textContent = total ? String(pend) : '—';

    pintarPorTeam();

    var ul = $('sc-urgentes');
    vaciar(ul);
    if (st.cargando) { ul.appendChild(el('li', { class: 'sc-vacio', text: 'Cargando…' })); return; }
    if (st.error) { ul.appendChild(el('li', { class: 'sc-vacio', text: 'No se pudieron cargar los clientes.' })); return; }
    if (!total) {
      ul.appendChild(el('li', { class: 'sc-vacio', text: 'Todavía no hay clientes con caso a solventar. Entran al semáforo cuando una venta con caso pasa a completed.' }));
      return;
    }
    mezcla(10).forEach(function (c) {
      ul.appendChild(el('li', null, [fila(c, function () { abrirFicha(c.id); })]));
    });
  }

  function porTeam() {
    var m = {};
    st.clientes.forEach(function (c) {
      var t = c.equipo || 'Sin team';
      if (!m[t]) m[t] = { verde: 0, amarillo: 0, rojo: 0, negro: 0, total: 0 };
      m[t][c.color] = (m[t][c.color] || 0) + 1;
      m[t].total++;
    });
    return m;
  }

  function pintarPorTeam() {
    var sec = $('sc-por-team'), tb = $('sc-por-team-filas');
    if (!sec || !tb) return;
    var ver = st.ambito === 'todos' && !st.team && st.clientes.length > 0;
    sec.hidden = !ver;
    if (!ver) return;
    vaciar(tb);
    var m = porTeam();
    Object.keys(m).sort().forEach(function (t) {
      var fila = el('tr', { class: 'sc-team-fila', tabindex: '0', role: 'button', 'aria-label': 'Ver la cartera de ' + t,
        on: {
          click: function () { elegirTeam(t, true); },
          keydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegirTeam(t, true); } }
        } }, [
        el('th', { scope: 'row', text: t }),
        el('td', { class: 'num' }, [m[t].verde ? el('span', { class: 'sc-n is-verde', text: String(m[t].verde) }) : '—']),
        el('td', { class: 'num' }, [m[t].amarillo ? el('span', { class: 'sc-n is-amarillo', text: String(m[t].amarillo) }) : '—']),
        el('td', { class: 'num' }, [m[t].rojo ? el('span', { class: 'sc-n is-rojo', text: String(m[t].rojo) }) : '—']),
        el('td', { class: 'num' }, [m[t].negro ? el('span', { class: 'sc-n is-negro', text: String(m[t].negro) }) : '—']),
        el('td', { class: 'num', text: String(m[t].total) })
      ]);
      tb.appendChild(fila);
    });
  }

  function elegirTeam(t, abrirCartera) {
    st.team = t || '';
    var sel = $('sc-team');
    if (sel) sel.value = st.team;
    cargarDesdeCRM();
    if (abrirCartera) irATab('cartera', true);
  }

  function filtrados() {
    var q = normalizar(st.busqueda);
    return st.clientes.filter(function (c) {
      return (st.filtro === 'todos' || c.color === st.filtro) &&
        (!q || normalizar([c.nombre_cliente, c.agente, c.telefono, c.servicio, c.caso_solventar].join(' ')).indexOf(q) !== -1);
    }).sort(function (a, b) { return (POS[a.color] - POS[b.color]) || porUrgencia(a, b); });
  }

  function pintarCartera() {
    var chips = $('sc-chips');
    vaciar(chips);
    ['todos'].concat(ORDEN).forEach(function (f) {
      var n = f === 'todos' ? st.clientes.length : cuenta(f);
      chips.appendChild(el('button', { type: 'button', class: 'sc-chip', 'aria-pressed': String(st.filtro === f),
        on: { click: function () { st.filtro = f; pintarCartera(); } } }, [
        f === 'todos' ? null : punto(f),
        (f === 'todos' ? 'Todos' : ESTADOS[f].titulo) + ' (' + n + ')'
      ]));
    });

    var lista = filtrados();
    $('sc-resumen').textContent = st.cargando
      ? 'Cargando clientes…'
      : st.error
        ? 'No se pudieron cargar los clientes: ' + st.error
        : st.clientes.length
          ? lista.length + ' de ' + st.clientes.length + ' clientes · verde, amarillo, rojo y negro · pulsa en un cliente para abrir su ficha.'
          : 'No hay clientes con caso a solventar' + (st.mes ? ' en ' + nombreMes(st.mes) : '') + '.';

    var tbody = $('sc-filas');
    vaciar(tbody);
    // Administración / backoffice: separados por team, y dentro de cada team de
    // verde a negro. Agente y supervisor: una sola lista.
    var agrupar = st.ambito === 'todos';
    if (agrupar) {
      lista.sort(function (a, b) {
        return String(a.equipo || '').localeCompare(String(b.equipo || ''), 'es') ||
          (POS[a.color] - POS[b.color]) || porUrgencia(a, b);
      });
    }
    var grupo = null, cuentaGrupo = {};
    lista.forEach(function (c) { cuentaGrupo[c.equipo] = (cuentaGrupo[c.equipo] || 0) + 1; });
    lista.slice(0, 1000).forEach(function (c) {
      if (agrupar && c.equipo !== grupo) {
        grupo = c.equipo;
        tbody.appendChild(el('tr', { class: 'sc-grupo' }, [
          el('th', { colspan: '8', scope: 'colgroup' }, [
            el('span', { class: 'sc-grupo-t', text: grupo || 'Sin team' }),
            el('span', { class: 'sc-grupo-n', text: cuentaGrupo[grupo] + ' cliente(s)' })
          ])
        ]));
      }
      var tr = el('tr', { class: 'sc-fila is-' + c.color + (c.solventado ? ' is-solventado' : ''),
        on: { click: function (ev) { if (!ev.target.closest('button')) abrirFicha(c.id); } } }, [
        el('td', { text: c.agente || '—' }),
        el('td', null, [el('button', { type: 'button', class: 'sc-cliente-btn', text: c.nombre_cliente || 'SIN NOMBRE', on: { click: function () { abrirFicha(c.id); } } })]),
        el('td', { class: 'sc-tel', text: c.telefono }),
        el('td', { text: c.servicio }),
        el('td', { text: fecha(c.inicio_reloj) }),
        el('td', null, [el('div', { class: 'sc-caso-celda', text: c.caso_solventar || '—', title: c.caso_solventar || '' })]),
        el('td', null, [el('span', { class: 'sc-estado-celda' }, [punto(c.color), el('span', null, [
          el('b', { text: ESTADOS[c.color].titulo }), ' · ', plazo(c)])])]),
        el('td', { class: 'num', text: c.comprobantes ? '✓ ' + c.comprobantes : '—',
                   title: c.comprobantes ? 'Comprobantes subidos' : 'Sin comprobante' })
      ]);
      tbody.appendChild(tr);
    });
    if (st.clientes.length && !lista.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'sc-vacio', text: 'Ningún cliente coincide con el filtro.' })]));
    }
    if (lista.length > 1000) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'sc-vacio',
        text: 'Se muestran 1000 de ' + lista.length + '. Afina la búsqueda o el filtro.' })]));
    }
  }

  function pintarOficina() {
    var grid = $('sc-negros');
    vaciar(grid);
    var negros = st.clientes.filter(function (c) { return c.color === 'negro'; });
    if (!negros.length) {
      grid.appendChild(el('p', { class: 'sc-vacio',
        text: st.clientes.length ? 'Ningún cliente ha pasado a oficina.' : 'No hay clientes que mostrar.' }));
      return;
    }
    if (st.ambito === 'todos') negros.sort(function (a, b) { return String(a.equipo || '').localeCompare(String(b.equipo || ''), 'es'); });
    var grupoOf = null;
    negros.forEach(function (c) {
      if (st.ambito === 'todos' && c.equipo !== grupoOf) {
        grupoOf = c.equipo;
        grid.appendChild(el('h3', { class: 'sc-grupo-oficina', text: grupoOf || 'Sin team' }));
      }
      grid.appendChild(el('button', { type: 'button', class: 'sc-caso', on: { click: function () { abrirFicha(c.id); } } }, [
        el('div', { class: 'sc-eyebrow', text: 'En oficina desde ' + (fechaHora(c.caso_vencido_at) || '—') }),
        el('div', { class: 'sc-caso-t', text: c.nombre_cliente || 'SIN NOMBRE' }),
        el('div', { class: 'sc-caso-d', text: c.caso_solventar || '—' }),
        el('div', { class: 'sc-caso-m', text: c.agente + (c.telefono ? ' · ' + c.telefono : '') })
      ]));
    });
  }

  // ── Pestañas ───────────────────────────────────────────────────────────
  var TABS = ['panel', 'cartera', 'oficina'];
  function irATab(tab, foco) {
    st.tab = tab;
    TABS.forEach(function (t) {
      var b = $('sc-tab-' + t), p = $('sc-panel-' + t), on = t === tab;
      if (!b || !p) return;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      p.hidden = !on;
    });
    if (tab === 'cartera') pintarCartera();
    if (foco) $('sc-tab-' + tab).focus();
  }

  // ── Ficha (diálogo) ────────────────────────────────────────────────────
  var focoPrevio = null;
  function comprobante(cp) {
    var li = el('li', { class: 'sc-f-comp' });
    li.appendChild(el('div', { class: 'sc-f-comp-llamada', text: cp.llamada === 'seguimiento' ? 'Seguimiento ' + (cp.numero || '') : 'Llamada del caso' }));
    var url = String(cp.url || '');
    var seguro = /^(\/api\/files\/\d+(\/image)?|\/uploads\/files\/[A-Za-z0-9._\- ]+)$/.test(url);
    if (!seguro) { li.appendChild(el('span', { text: 'Comprobante no disponible' })); return li; }
    if (cp.tipo === 'imagen') {
      var a = el('a', { href: url, target: '_blank', rel: 'noopener', class: 'sc-f-comp-img', title: 'Abrir captura' });
      a.appendChild(el('img', { src: url, alt: 'Captura del comprobante', loading: 'lazy' }));
      li.appendChild(a);
    } else if (cp.tipo === 'audio') {
      var au = el('audio', { controls: 'controls', preload: 'none', class: 'sc-f-comp-audio' });
      au.src = encodeURI(url);
      li.appendChild(au);
    } else {
      li.appendChild(el('a', { href: encodeURI(url), target: '_blank', rel: 'noopener', text: '📄 ' + (cp.nombre || 'Documento') }));
    }
    li.appendChild(el('div', { class: 'sc-f-comp-meta', text: (cp.created_by || '—') + ' · ' + fechaHora(cp.created_at) }));
    if (cp.nota) li.appendChild(el('div', { class: 'sc-f-comp-nota', text: cp.nota }));
    return li;
  }

  function abrirFicha(id) {
    var c = st.clientes.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    st.sel = id;
    focoPrevio = document.activeElement;
    $('sc-f-nombre').textContent = c.nombre_cliente || 'SIN NOMBRE';
    $('sc-f-sub').textContent = (c.telefono || 'Sin teléfono') + ' · ' + (c.agente || '—') + (c.equipo ? ' · ' + c.equipo : '');
    $('sc-f-luz').className = 'sc-punto is-' + c.color;
    $('sc-f-estado').textContent = ESTADOS[c.color].titulo + ' — ' + (c.solventado ? 'caso solventado' : ESTADOS[c.color].nota);
    $('sc-f-motivo').textContent = plazo(c);
    $('sc-f-servicio').textContent = c.servicio || '—';
    $('sc-f-venta').textContent = fecha(c.dia_venta) || '—';
    $('sc-f-completado').textContent = fechaHora(c.inicio_reloj) || '—';
    $('sc-f-plazo').textContent = c.vence_at ? 'Oficina el ' + fechaHora(c.vence_at) : (c.solventado ? 'Solventado el ' + (fechaHora(c.caso_solventado_at) || '—') : '—');
    $('sc-f-caso').textContent = c.caso_solventar || '—';
    var ul = $('sc-f-comps');
    vaciar(ul);
    ul.appendChild(el('li', { class: 'sc-vacio', text: 'Cargando…' }));
    fetch('/api/leads/' + encodeURIComponent(c.id) + '/caso', cfgFetch())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (st.sel !== id) return;
        vaciar(ul);
        var comps = (d && d.comprobantes_lista) || [];
        if (!comps.length) ul.appendChild(el('li', { class: 'sc-vacio', text: 'Sin comprobante todavía.' }));
        comps.forEach(function (cp) { ul.appendChild(comprobante(cp)); });
        var dd = d && d.data;
        if (dd && dd.proximo_seguimiento) {
          $('sc-f-plazo').textContent = (dd.seguimiento_vencido ? 'Seguimiento pendiente desde el ' : 'Próximo seguimiento: ') + fechaHora(dd.proximo_seguimiento);
        }
        var ed = $('sc-f-editar');
        if (ed) ed.hidden = !(d && d.data && d.data.puede_subir) || c.color === 'negro';
      })
      .catch(function () { if (st.sel === id) { vaciar(ul); ul.appendChild(el('li', { class: 'sc-vacio', text: 'No se pudieron cargar los comprobantes.' })); } });
    $('sc-ficha-fondo').hidden = false;
    $('sc-ficha').hidden = false;
    document.querySelector('.layout').inert = true;
    $('sc-ficha-cerrar').focus();
  }
  function cerrarFicha() {
    if (st.sel === null) return;
    st.sel = null;
    $('sc-ficha').hidden = true;
    $('sc-ficha-fondo').hidden = true;
    document.querySelector('.layout').inert = false;
    if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
  }

  // ── El volteo de la página ─────────────────────────────────────────────
  // Dos fases: la cara actual gira hasta 90° (de canto: no se ve), en ese instante
  // se cambia de cara, y la nueva termina el giro desde el canto. Nunca hay dos
  // caras visibles a la vez, así que no pueden superponerse en ningún navegador
  // (con dos caras apiladas y backface-visibility, Firefox dejaba ver la de atrás).
  var girando = false;
  var GIRO_MS = 420;
  function caraActiva() { return $('cara-clientes').hidden ? 'ventas' : 'clientes'; }

  function voltear(hacia, animar) {
    if (girando || hacia === caraActiva()) return;
    var desde = $(hacia === 'clientes' ? 'cara-ventas' : 'cara-clientes');
    var destino = $(hacia === 'clientes' ? 'cara-clientes' : 'cara-ventas');
    var titulo = $(hacia === 'clientes' ? 'sc-titulo' : 'titulo-ventas');

    function cambiarCara() {
      desde.hidden = true;
      destino.hidden = false;
      document.title = hacia === 'clientes' ? 'Semáforo de Clientes' : 'El Semáforo';
      // La primera vez que se abre la cara de clientes se piden los datos.
      if (hacia === 'clientes' && !st.cargado && !st.cargando) { st.cargado = true; cargarDesdeCRM(); }
    }
    function terminar() {
      desde.classList.remove('gira');
      destino.classList.remove('gira');
      girando = false;
      titulo.focus({ preventScroll: true });
    }

    if (!animar || reduceMovimiento() || !desde.animate) { cambiarCara(); terminar(); return; }

    girando = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Hacia clientes la hoja se pasa hacia la izquierda; de vuelta, al revés.
    var s = hacia === 'clientes' ? -1 : 1;
    desde.classList.add('gira');
    var ida = desde.animate([
      { transform: 'perspective(2200px) rotateY(0deg) scale(1)', filter: 'brightness(1)' },
      { transform: 'perspective(2200px) rotateY(' + (90 * s) + 'deg) scale(.96)', filter: 'brightness(.78)' }
    ], { duration: GIRO_MS, easing: 'cubic-bezier(.55, 0, .85, .35)', fill: 'forwards' });

    ida.onfinish = function () {
      // En el mismo instante (sin pintar entre medias): fuera la cara vieja, que está
      // de canto, y entra la nueva, también de canto (fill 'both' aplica ya el 1er fotograma).
      cambiarCara();
      destino.classList.add('gira');
      var vuelta = destino.animate([
        { transform: 'perspective(2200px) rotateY(' + (-90 * s) + 'deg) scale(.96)', filter: 'brightness(.78)' },
        { transform: 'perspective(2200px) rotateY(0deg) scale(1)', filter: 'brightness(1)' }
      ], { duration: GIRO_MS + 60, easing: 'cubic-bezier(.15, .65, .45, 1)', fill: 'both' });
      ida.cancel();                     // la cara vieja ya está oculta
      vuelta.onfinish = function () { vuelta.cancel(); terminar(); };   // último fotograma = sin transformar
      vuelta.oncancel = null;
    };
  }

  function segunHash(animar) {
    voltear(location.hash === '#clientes' ? 'clientes' : 'ventas', animar);
  }

  // ── Arranque ───────────────────────────────────────────────────────────
  function iniciar() {
    if (!$('libro-semaforo') || !$('cara-clientes')) return;

    document.querySelectorAll('[data-voltear]').forEach(function (b) {
      b.addEventListener('click', function () {
        var hacia = b.getAttribute('data-voltear');
        // #clientes en la URL: se puede enlazar la cara de detrás y volver con Atrás.
        if (hacia === 'clientes' && location.hash !== '#clientes') {
          location.hash = 'clientes';            // dispara hashchange → voltear
          return;
        }
        if (hacia === 'ventas' && location.hash) {
          history.pushState(null, '', location.pathname + location.search);
        }
        voltear(hacia, true);
      });
    });
    window.addEventListener('hashchange', function () { segunHash(true); });
    window.addEventListener('popstate', function () { segunHash(true); });

    // Pestañas: clic y flechas (patrón de tablist accesible).
    TABS.forEach(function (t, i) {
      var b = $('sc-tab-' + t);
      if (!b) return;
      b.addEventListener('click', function () { irATab(t, false); });
      b.addEventListener('keydown', function (ev) {
        var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (ev.key === 'Home') { ev.preventDefault(); irATab(TABS[0], true); }
        else if (ev.key === 'End') { ev.preventDefault(); irATab(TABS[TABS.length - 1], true); }
        else if (d) { ev.preventDefault(); irATab(TABS[(i + d + TABS.length) % TABS.length], true); }
      });
    });

    var refrescar = $('sc-refrescar');
    if (refrescar) refrescar.addEventListener('click', cargarDesdeCRM);

    pintarMeses();
    var selTeam = $('sc-team');
    if (selTeam) selTeam.addEventListener('change', function (ev) { elegirTeam(ev.target.value, false); });
    var selMes = $('sc-mes');
    if (selMes) selMes.addEventListener('change', function (ev) {
      st.mes = ev.target.value;
      cargarDesdeCRM();
    });

    $('sc-buscar').addEventListener('input', function (ev) { st.busqueda = ev.target.value; pintarCartera(); });

    // Ficha
    $('sc-ficha-cerrar').addEventListener('click', cerrarFicha);
    $('sc-ficha-fondo').addEventListener('click', cerrarFicha);
    document.addEventListener('keydown', function (ev) {
      if (st.sel === null) return;
      if (ev.key === 'Escape') { ev.preventDefault(); cerrarFicha(); return; }
      if (ev.key === 'Tab') {       // foco atrapado dentro del diálogo
        var foc = [].filter.call($('sc-ficha').querySelectorAll('button, a[href], audio'), function (x) { return !x.hidden && x.offsetParent !== null; });
        var primeroF = foc[0], ultimo = foc[foc.length - 1];
        if (ev.shiftKey && document.activeElement === primeroF) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeroF.focus(); }
      }
    });

    irATab('panel', false);
    pintarTodo();
    segunHash(false);
    // Si se entra directamente con #clientes, segunHash ya abrió la cara y pidió
    // los datos; si no, se piden al voltear.
    if (location.hash === '#clientes' && !st.cargado && !st.cargando) { st.cargado = true; cargarDesdeCRM(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
