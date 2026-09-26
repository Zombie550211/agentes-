/**
 * El Semáforo — página doble.
 *
 * 1) El volteo: la página tiene dos caras (ventas / clientes) en un .libro. Los
 *    botones [data-voltear] doblan la hoja con una animación 3D. #clientes en la
 *    URL abre directamente la cara de detrás.
 *
 * 2) El semáforo de clientes: lee los leads del CRM (/api/leads, el mismo origen
 *    que la lista de clientes de residencial) y los clasifica por su STATUS DE
 *    COMISIÓN. El endpoint ya filtra por rol, así que un agente sólo ve los suyos.
 *
 * Seguridad: todo lo que viene del servidor se pinta con textContent / nodos del
 * DOM, nunca con innerHTML ni dentro de atributos de evento o de estilo. El semáforo
 * de ventas ya tuvo un XSS por interpolar datos en innerHTML.
 */
(function () {
  'use strict';

  var URL_MESES = '/api/leads/months?limit=120';

  // El mes se aplica en el servidor (?month=AAAA-MM). '' = todos los meses, que
  // en este endpoint se pide con noAutoMonth=1: sin eso el backend filtra por el
  // mes en curso por su cuenta.
  function urlLeads(mes) {
    return '/api/leads?limit=10000' + (mes ? '&month=' + encodeURIComponent(mes) : '&noAutoMonth=1');
  }

  function mesActual() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(ym) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return ym;
    var nombre = MESES_ES[Number(m[2]) - 1] || m[2];
    return nombre.charAt(0).toUpperCase() + nombre.slice(1) + ' ' + m[1];
  }

  var ESTADOS = {
    verde:    { titulo: 'Verde',    nota: 'Comisión completada' },
    amarillo: { titulo: 'Amarillo', nota: 'Comisión en hold' },
    ambar:    { titulo: 'Ámbar',    nota: 'Comisión pendiente' },
    rojo:     { titulo: 'Rojo',     nota: 'Comisión cancelada' },
    negro:    { titulo: 'Negro',    nota: 'Interviene oficina' },
    gris:     { titulo: 'Sin clasificar', nota: 'Status fuera del semáforo' }
  };

  // De menos a más grave. 'gris' queda fuera: no tiene luz en el poste ni entra
  // en los recuentos de color, sólo se ve en la cartera.
  var ORDEN = ['verde', 'amarillo', 'ambar', 'rojo', 'negro'];
  var PRIORIDAD = { negro: 0, rojo: 1, ambar: 2, amarillo: 3, verde: 4, gris: 5 };

  // Status de comisión -> color. Lo que no esté aquí (reserva, active, repro,
  // n/a…) se muestra en la cartera sin color, para que se vea que hay que
  // corregirlo en la lista de residencial en vez de esconderlo.
  var COLOR_POR_STATUS = {
    completed: 'verde',
    hold:      'amarillo',
    pending:   'ambar',
    cancelled: 'rojo',
    oficina:   'negro'
  };

  var ETIQUETA_STATUS = {
    completed: 'Completed', pending: 'Pending', hold: 'Hold', cancelled: 'Cancelled',
    oficina: 'Oficina', reserva: 'Reserva', active: 'Active', rescheduled: 'Rescheduled'
  };

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

  function usuarioActual() {
    try {
      var u = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
      return String(u.name || u.username || '').trim() || 'Tú';
    } catch (_) { return 'Tú'; }
  }

  function tokenActual() {
    try { return sessionStorage.getItem('token') || localStorage.getItem('token') || ''; }
    catch (_) { return ''; }
  }

  function normalizar(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Mismo criterio que normalizeStatus() de js/residencial/costumer-main.js: si
  // las dos páginas no normalizan igual, el semáforo y la lista de clientes
  // acabarían discrepando sobre el mismo cliente.
  function normalizarStatus(sv) {
    var s = String(sv == null ? '' : sv).trim().toLowerCase();
    if (!s) return 'pending';
    if (s === 'pending' || s === 'pendiente' || s.indexOf('pend') !== -1) return 'pending';
    if (s === 'reserva' || s.indexOf('reser') !== -1) return 'reserva';
    if (s === 'cancelled' || s.indexOf('cancel') !== -1) return 'cancelled';
    if (s === 'hold' || s.indexOf('hold') !== -1) return 'hold';
    if (s.indexOf('resched') !== -1 || s.indexOf('reagend') !== -1 || s.indexOf('reprogram') !== -1) return 'rescheduled';
    if (s === 'oficina' || (s.indexOf('active') !== -1 && s.indexOf('oficina') !== -1)) return 'oficina';
    if (s === 'active' || s === 'activo' || s === 'activa') return 'active';
    if (s === 'completed' || s.indexOf('complet') !== -1 || s.indexOf('cerrad') !== -1) return 'completed';
    return s;
  }

  function primero(obj, claves) {
    for (var i = 0; i < claves.length; i++) {
      var v = obj[claves[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  var HOY = (function () { var d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  function diasDesde(v) {
    var t = String(v == null ? '' : v).trim();
    var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return NaN;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d)) return NaN;
    d.setHours(0, 0, 0, 0);
    return Math.round((HOY - d) / 86400000);
  }

  function fecha(v) {
    var m = String(v == null ? '' : v).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  // ── Reglas ─────────────────────────────────────────────────────────────
  // El color lo decide el status de comisión, no el tiempo sin contacto
  // (decisión de negocio del 25-09-2026). Los días sin contacto pasan a ser
  // un dato informativo de la ficha y de la cartera.
  function clasificar(status) {
    return COLOR_POR_STATUS[status] || 'gris';
  }

  // Días desde la última llamada de validación. El 76% de la cartera no tiene
  // ninguna registrada: en ese caso se cuenta desde la venta y se marca como
  // nunca contactado, que es justo el caso que interesa sacar a la luz.
  function contacto(lead) {
    var ref = primero(lead, ['fecha_ultima_llamada', 'fecha_completed']);
    if (ref) {
      var d = diasDesde(ref);
      if (!isNaN(d)) return { dias: d, nunca: false };
    }
    var venta = primero(lead, ['dia_venta', 'fecha_contratacion', 'created_at']);
    if (venta) {
      var dv = diasDesde(venta);
      if (!isNaN(dv)) return { dias: dv, nunca: true };
    }
    return { dias: NaN, nunca: true };
  }

  // ── Estado ─────────────────────────────────────────────────────────────
  var st = {
    clientes: [],
    cargando: false,
    error: '',
    mes: mesActual(),   // por defecto, el mes en curso
    tab: 'panel',
    filtro: 'todos',
    busqueda: '',
    notas: {},       // id -> [{autor, fecha, texto}]  (solo en memoria)
    sel: null
  };

  function construir(leads) {
    st.clientes = leads.map(function (l, i) {
      var status = normalizarStatus(primero(l, ['status_comision', 'statusComision']) || primero(l, ['status', 'Status', 'estado']));
      var c = contacto(l);
      return {
        id: i,
        agente:      primero(l, ['agente_nombre', 'agente', 'created_by']) || '—',
        nombre:      primero(l, ['nombre_cliente', 'clientName', 'nombre']) || 'SIN NOMBRE',
        telefono:    primero(l, ['telefono_principal', 'telefono', 'telefonoPrincipal']),
        servicio:    primero(l, ['tipo_servicio', 'servicios_texto', 'producto_contratado']) || servicioDeLista(l),
        venta:       primero(l, ['dia_venta', 'fecha_contratacion']),
        instalacion: primero(l, ['dia_instalacion', 'fecha_instalacion']),
        status:      status,
        dias:        c.dias,
        nunca:       c.nunca,
        estado:      clasificar(status)
      };
    });
    st.filtro = 'todos';
    st.busqueda = '';
    st.notas = {};
    if ($('sc-buscar')) $('sc-buscar').value = '';
    pintarTodo();
  }

  // `servicios` llega como array JSON desde el backend.
  function servicioDeLista(l) {
    var v = l && l.servicios;
    if (Array.isArray(v)) return v.filter(Boolean).join(', ');
    return v ? String(v) : '';
  }

  function cuenta(estado) {
    return st.clientes.filter(function (c) { return c.estado === estado; }).length;
  }

  // ── Meses disponibles ──────────────────────────────────────────────────
  // El desplegable se llena con los meses que el CRM dice tener. El mes en curso
  // se añade aunque todavía no haya ventas, para que la opción por defecto exista
  // siempre (si no, el primer día del mes el selector aparecería en otro mes).
  function cargarMeses() {
    var sel = $('sc-mes');
    if (!sel) return;

    function pintar(meses) {
      vaciar(sel);
      sel.appendChild(el('option', { value: '', text: 'Todos los meses' }));
      meses.forEach(function (m) {
        sel.appendChild(el('option', { value: m, text: nombreMes(m) }));
      });
      sel.value = st.mes;
      if (sel.value !== st.mes) {      // el mes guardado ya no está en la lista
        st.mes = sel.value || '';
      }
    }

    pintar([st.mes]);                  // algo usable mientras responde el servidor

    var cfg = { credentials: 'include', headers: {} };
    var tk = tokenActual();
    if (tk) cfg.headers.Authorization = 'Bearer ' + tk;

    fetch(URL_MESES, cfg)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var meses = (d && (d.data || d.months)) || [];
        if (!Array.isArray(meses) || !meses.length) return;
        if (meses.indexOf(st.mes) === -1) meses = [st.mes].concat(meses);
        pintar(meses);
      })
      .catch(function () { /* el selector se queda con el mes en curso */ });
  }

  // ── Carga desde el CRM ─────────────────────────────────────────────────
  function cargarDesdeCRM() {
    if (st.cargando) return;
    st.cargando = true;
    st.error = '';
    pintarCabecera();

    var cfg = { credentials: 'include', headers: {} };
    var tk = tokenActual();
    if (tk) cfg.headers.Authorization = 'Bearer ' + tk;

    fetch(urlLeads(st.mes), cfg)
      .then(function (r) {
        if (!r.ok) throw new Error('El servidor respondió ' + r.status);
        return r.json();
      })
      .then(function (d) {
        var filas = Array.isArray(d) ? d : (d && (d.data || d.leads)) || [];
        st.cargando = false;
        construir(filas);
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
      else if (!st.clientes.length) a.textContent = 'Sin clientes en ' + periodo;
      else a.textContent = st.clientes.length + ' clientes · ' + periodo + ' · status de comisión';
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
    var riesgo = cuenta('rojo') + cuenta('negro');
    var sinContacto = st.clientes.filter(function (c) { return c.nunca; }).length;
    $('sc-kpi-total').textContent = String(total);
    $('sc-kpi-riesgo').textContent = total ? Math.round(riesgo / total * 100) + '%' : '—';
    $('sc-kpi-sincontacto').textContent = total ? String(sinContacto) : '—';

    var ul = $('sc-urgentes');
    vaciar(ul);
    var urgentes = st.clientes.filter(function (c) { return c.estado === 'rojo' || c.estado === 'negro'; })
      .sort(function (a, b) { return PRIORIDAD[a.estado] - PRIORIDAD[b.estado] || (b.dias || 0) - (a.dias || 0); });
    if (st.cargando) ul.appendChild(el('li', { class: 'sc-vacio', text: 'Cargando…' }));
    else if (!total) ul.appendChild(el('li', { class: 'sc-vacio', text: 'No hay clientes que mostrar.' }));
    else if (!urgentes.length) ul.appendChild(el('li', { class: 'sc-vacio', text: 'Ningún cliente en rojo ni en negro.' }));
    urgentes.slice(0, 50).forEach(function (c) {
      ul.appendChild(el('li', null, [
        el('button', { type: 'button', class: 'sc-urgente', on: { click: function () { abrirFicha(c.id); } } }, [
          punto(c.estado),
          el('b', { class: 'sc-urgente-nombre', text: c.nombre }),
          el('span', { class: 'sc-urgente-motivo', text: etiqueta(c.status) + ' · ' + textoContacto(c) }),
          el('span', { class: 'sc-urgente-ej', text: c.agente })
        ])
      ]));
    });
  }

  function etiqueta(status) {
    return ETIQUETA_STATUS[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : '—');
  }

  function textoContacto(c) {
    if (isNaN(c.dias)) return 'sin fecha';
    return c.dias + ' d' + (c.nunca ? ' sin contactar' : ' sin contacto');
  }

  function filtrados() {
    var q = normalizar(st.busqueda);
    return st.clientes.filter(function (c) {
      return (st.filtro === 'todos' || c.estado === st.filtro) &&
        (!q || normalizar(c.nombre + ' ' + c.agente + ' ' + c.telefono + ' ' + c.servicio).indexOf(q) !== -1);
    }).sort(function (a, b) { return PRIORIDAD[a.estado] - PRIORIDAD[b.estado] || (b.dias || 0) - (a.dias || 0); });
  }

  function pintarCartera() {
    var chips = $('sc-chips');
    vaciar(chips);
    var conColor = ORDEN.slice();
    if (cuenta('gris')) conColor.push('gris');
    ['todos'].concat(conColor).forEach(function (f) {
      var n = f === 'todos' ? st.clientes.length : cuenta(f);
      chips.appendChild(el('button', { type: 'button', class: 'sc-chip', 'aria-pressed': String(st.filtro === f),
        on: { click: function () { st.filtro = f; pintarCartera(); } } }, [
        f === 'todos' ? null : punto(f),
        (f === 'todos' ? 'Todos' : ESTADOS[f].titulo) + ' (' + n + ')'
      ]));
    });

    var lista = filtrados();
    $('sc-resumen').textContent = st.cargando
      ? 'Cargando clientes del CRM…'
      : st.error
        ? 'No se pudieron cargar los clientes: ' + st.error
        : st.clientes.length
          ? lista.length + ' de ' + st.clientes.length + ' clientes · pulsa en un cliente para abrir su ficha.'
          : 'No hay clientes en ' + (st.mes ? nombreMes(st.mes) : 'ningún mes') + '.';

    var tbody = $('sc-filas');
    vaciar(tbody);
    lista.slice(0, 1000).forEach(function (c) {
      var tr = el('tr', { on: { click: function (ev) { if (!ev.target.closest('button')) abrirFicha(c.id); } } }, [
        el('td', { text: c.agente }),
        el('td', null, [el('button', { type: 'button', class: 'sc-cliente-btn', text: c.nombre, on: { click: function () { abrirFicha(c.id); } } })]),
        el('td', { class: 'sc-tel', text: c.telefono }),
        el('td', { text: c.servicio }),
        el('td', { text: fecha(c.venta) }),
        el('td', { text: fecha(c.instalacion) }),
        el('td', null, [el('span', { class: 'sc-estado-celda' }, [punto(c.estado), etiqueta(c.status)])]),
        el('td', { class: 'num' + (c.nunca ? ' es-nunca' : ''), text: isNaN(c.dias) ? '—' : c.dias + ' d',
                   title: c.nunca ? 'Nunca se le hizo la llamada de validación: se cuenta desde la venta' : 'Desde la última llamada de validación' })
      ]);
      tbody.appendChild(tr);
    });
    if (st.clientes.length && !lista.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'sc-vacio', text: 'Ningún cliente coincide con el filtro.' })]));
    }
    if (lista.length > 1000) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'sc-vacio',
        text: 'Se muestran los 1000 más urgentes de ' + lista.length + '. Afina la búsqueda o el filtro.' })]));
    }
  }

  function pintarOficina() {
    var grid = $('sc-negros');
    vaciar(grid);
    var negros = st.clientes.filter(function (c) { return c.estado === 'negro'; })
      .sort(function (a, b) { return (b.dias || 0) - (a.dias || 0); });
    if (!negros.length) {
      grid.appendChild(el('p', { class: 'sc-vacio',
        text: st.clientes.length ? 'Ningún cliente con status de comisión «oficina».' : 'No hay clientes que mostrar.' }));
      return;
    }
    negros.forEach(function (c) {
      grid.appendChild(el('button', { type: 'button', class: 'sc-caso', on: { click: function () { abrirFicha(c.id); } } }, [
        el('div', { class: 'sc-eyebrow', text: 'Status de comisión: oficina' }),
        el('div', { class: 'sc-caso-t', text: c.nombre }),
        el('div', { class: 'sc-caso-d', text: (c.servicio || 'Sin servicio') + ' · venta ' + (fecha(c.venta) || '—') + ' · ' + textoContacto(c) }),
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
  function abrirFicha(id) {
    var c = st.clientes.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    st.sel = id;
    focoPrevio = document.activeElement;
    $('sc-f-nombre').textContent = c.nombre;
    $('sc-f-sub').textContent = (c.telefono || 'Sin teléfono') + ' · ' + c.agente;
    $('sc-f-luz').className = 'sc-punto is-' + c.estado;
    $('sc-f-estado').textContent = ESTADOS[c.estado].titulo + ' — ' + ESTADOS[c.estado].nota;
    $('sc-f-motivo').textContent = 'Status de comisión «' + etiqueta(c.status) + '» en la lista de clientes de residencial.' +
      (c.nunca ? ' Nunca se le registró la llamada de validación.' : '');
    $('sc-f-servicio').textContent = c.servicio || '—';
    $('sc-f-venta').textContent = fecha(c.venta) || '—';
    $('sc-f-instalacion').textContent = fecha(c.instalacion) || '—';
    $('sc-f-dias').textContent = isNaN(c.dias) ? '—' : textoContacto(c);
    $('sc-f-borrador').value = '';
    pintarNotas();
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
  function pintarNotas() {
    var ul = $('sc-f-notas');
    vaciar(ul);
    var notas = st.notas[st.sel] || [];
    if (!notas.length) ul.appendChild(el('li', { class: 'sc-vacio', text: 'Sin notas todavía.' }));
    notas.forEach(function (n) {
      ul.appendChild(el('li', null, [el('div', { class: 'sc-f-nota-meta', text: n.fecha + ' · ' + n.autor }), n.texto]));
    });
  }
  function guardarNota() {
    var t = $('sc-f-borrador').value.trim();
    if (!t || st.sel === null) return;
    var ahora = new Date();
    (st.notas[st.sel] = st.notas[st.sel] || []).unshift({
      autor: usuarioActual(),
      fecha: ahora.toLocaleDateString('es') + ' ' + ahora.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
      texto: t.slice(0, 1000)
    });
    $('sc-f-borrador').value = '';
    pintarNotas();
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
      if (hacia === 'clientes' && !st.clientes.length && !st.cargando && !st.error) cargarDesdeCRM();
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

    cargarMeses();
    var selMes = $('sc-mes');
    if (selMes) selMes.addEventListener('change', function (ev) {
      st.mes = ev.target.value;
      cargarDesdeCRM();
    });

    $('sc-buscar').addEventListener('input', function (ev) { st.busqueda = ev.target.value; pintarCartera(); });

    // Ficha
    $('sc-ficha-cerrar').addEventListener('click', cerrarFicha);
    $('sc-ficha-fondo').addEventListener('click', cerrarFicha);
    $('sc-f-guardar').addEventListener('click', guardarNota);
    document.addEventListener('keydown', function (ev) {
      if (st.sel === null) return;
      if (ev.key === 'Escape') { ev.preventDefault(); cerrarFicha(); return; }
      if (ev.key === 'Tab') {       // foco atrapado dentro del diálogo
        var foc = $('sc-ficha').querySelectorAll('button, textarea');
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
    if (location.hash === '#clientes' && !st.clientes.length && !st.cargando) cargarDesdeCRM();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
