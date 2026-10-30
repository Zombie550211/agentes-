/**
 * Transferencia de llamada — página propia (residencial/transferencia.html y
 * lineas/transferencia.html, en el menú «Clientes y ventas» / «Servicios móviles»).
 *
 * La página aporta el hueco del formulario:  <main id="trf-panel">
 * (Sigue admitiendo el modo antiguo con pestañas: botones [data-trf-tab="lead"|"transferencia"]
 *  y paneles [data-trf-panel]; sin botones de pestaña, el formulario se muestra directamente.)
 *
 * La sección de origen sale de la ruta (/lineas/… o /residencial/…) y el backend
 * devuelve los teams y agentes de la sección CONTRARIA. Con #transferencia en la
 * URL la página abre directamente en esa pestaña.
 *
 * Debajo del formulario va "Mis transferencias": el backend ya filtra según el rol
 * (agente → las suyas, supervisor → su team, admin/BO → todas), así cada agente
 * consulta lo que envió y lo que recibió sin salir del formulario. Su buscador
 * (nombre del cliente o teléfono) busca en todas las fechas, no solo en el periodo.
 *
 * Resultado: quien RECIBIÓ la transferencia (o el supervisor de su team) la cierra desde su fila de "Mis
 * transferencias" con Venta completada / Fraude / Balance / Pago full / No
 * interesado / En seguimiento y la captura de la venta (obligatoria para "completada"). Si la venta
 * completada llegó a Líneas, también la cantidad de líneas (1-5): se paga por línea.
 * Las ventas completadas antes de existir ese campo salen en un aviso bloqueante al
 * agente de Líneas que las recibió, hasta que indique las líneas de cada una.
 * La captura
 * se sube primero a /api/files/upload y luego se envía su URL con el resultado.
 *
 * Un panel con data-trf-reserve (el botón "Guardar Lead" de la cabecera) se
 * vuelve invisible en vez de desaparecer, para que las pestañas no salten.
 */
(function () {
  'use strict';

  const ORIGEN = location.pathname.indexOf('/lineas/') === 0 ? 'lineas' : 'residencial';
  const DESTINO_LABEL = ORIGEN === 'lineas' ? 'Residencial' : 'Líneas';
  // Residencial → Líneas no elige destino: lo asigna la cola de agentes de Líneas conectados.
  const COLA = ORIGEN === 'residencial';
  const COLA_MS = 8000;   // cada cuánto se refresca la cola mientras la página está visible
  const SALIDA_MS = 160;   // = duración de trfSale en transferencia-form.css

  let destinos = null;   // [{team, agentes:[{id,nombre,username}]}] — se carga al abrir la pestaña
  let panel = null;
  let historial = [];    // última carga de "Mis transferencias"
  let filtroTipo = '';   // '' | 'enviada' | 'recibida'
  let periodo = 0;       // días hacia atrás: 0 = hoy, 7, 30
  let busqueda = '';     // texto del buscador de "Mis transferencias" (nombre o teléfono)
  let encontradas = [];  // resultado de la búsqueda (todas las fechas)
  let busqPedido = 0;
  let busqTimer = null;
  const PAGO_POR_VENTA = 1;   // US$ por venta completada; si llegó a Líneas, por cada línea
  const MAX_LINEAS = 5;

  // Los "antiguo" ya no se ofrecen en el diálogo: solo se muestran en las transferencias
  // que los tienen, cuentan como pendientes y se pueden actualizar a un status vigente.
  const RESULTADOS = {
    completada:    { label: 'Venta completada',       ic: 'fa-circle-check',       cls: 'ok' },
    fraude:        { label: 'Fraude',                 ic: 'fa-user-secret',        cls: 'fra' },
    balance:       { label: 'Balance',                ic: 'fa-scale-unbalanced',   cls: 'bal' },
    pago_full:     { label: 'Pago full',              ic: 'fa-money-bill-wave',    cls: 'full' },
    no_interesado: { label: 'No interesado',          ic: 'fa-circle-xmark',       cls: 'noi' },
    seguimiento:   { label: 'En seguimiento',         ic: 'fa-clock',              cls: 'seg' },
    no_realizada:  { label: 'Venta no realizada',     ic: 'fa-circle-xmark',       cls: 'no',  antiguo: true },
  };
  const VIGENTES = Object.keys(RESULTADOS).filter((k) => !RESULTADOS[k].antiguo);

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  const q = (sel) => panel.querySelector(sel);

  /** Tarjeta «Transferencias por agente»: en Residencial va al final como gráfica de
   *  barras; en Líneas (sin cola), al lado del formulario como lista con barras. */
  function seccionRanking() {
    return '<section class="trf-card trf-rank" aria-labelledby="trf-rank-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="ph ph-trophy"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-rank-title">Transferencias por agente</h2>' +
            '<p class="trf-sub" id="trf-rank-sub">Cuántas lleva cada agente hoy.</p>' +
          '</div>' +
        '</div>' +
        '<div class="trf-rank-body" id="trf-rank-body" aria-live="polite"></div>' +
      '</section>';
  }

  function render() {
    panel.innerHTML =
      // Arriba el resumen (cifras + barra de resultados) con los filtros, que mandan en toda la
      // página; debajo el formulario y el ranking lado a lado; al final la tabla, a todo el ancho.
      '<section class="trf-card trf-resumen" aria-labelledby="trf-res-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="ph ph-chart-bar"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-res-title">Resumen de transferencias</h2>' +
            '<p class="trf-sub" id="trf-res-sub">Las que enviaste y las que te transfirieron hoy.</p>' +
          '</div>' +
          '<div class="trf-hist-filtros">' +
            '<div class="trf-seg" role="group" aria-label="Periodo">' +
              '<button type="button" data-dias="0" class="trf-seg-on" aria-pressed="true">Hoy</button>' +
              '<button type="button" data-dias="7" aria-pressed="false">7 días</button>' +
              '<button type="button" data-dias="30" aria-pressed="false">30 días</button>' +
            '</div>' +
            '<div class="trf-seg" role="group" aria-label="Tipo">' +
              '<button type="button" data-tipo="" class="trf-seg-on" aria-pressed="true">Todas</button>' +
              '<button type="button" data-tipo="enviada" aria-pressed="false">Enviadas</button>' +
              '<button type="button" data-tipo="recibida" aria-pressed="false">Recibidas</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="trf-kpis" id="trf-kpis" aria-live="polite"></div>' +
      '</section>' +
      '<div class="trf-fila">' +
      '<section class="trf-card" aria-labelledby="trf-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="fas fa-phone-volume"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-title">Nueva transferencia</h2>' +
            '<p class="trf-sub">Registra la llamada que transfieres a un agente de ' + esc(DESTINO_LABEL) + '.</p>' +
          '</div>' +
        '</div>' +
        '<form class="trf-form" novalidate>' +
          '<div class="trf-grid">' +
            '<div class="trf-field">' +
              '<label for="trf-telefono">Número de teléfono <span class="trf-req">*</span></label>' +
              '<input type="tel" id="trf-telefono" inputmode="tel" maxlength="20" autocomplete="off" placeholder="(555) 123-4567">' +
            '</div>' +
            '<div class="trf-field">' +
              '<label for="trf-nombre">Nombre del cliente <span class="trf-req">*</span></label>' +
              '<input type="text" id="trf-nombre" maxlength="150" autocomplete="off">' +
            '</div>' +
            '<div class="trf-field trf-full">' +
              '<label for="trf-direccion">Dirección <span class="trf-req">*</span></label>' +
              '<input type="text" id="trf-direccion" maxlength="300" autocomplete="off">' +
            '</div>' +
            '<div class="trf-field trf-full">' +
              '<label for="trf-motivo">Motivo de la llamada <span class="trf-req">*</span></label>' +
              '<textarea id="trf-motivo" maxlength="1000"></textarea>' +
            '</div>' +
            (COLA
              ? '<div class="trf-field trf-full trf-asigna" id="trf-asigna" aria-live="polite">Buscando agentes de Líneas conectados…</div>'
              : '<div class="trf-field">' +
              '<label for="trf-team">Team de ' + esc(DESTINO_LABEL) + ' <span class="trf-req">*</span></label>' +
              '<select id="trf-team"><option value="">Cargando…</option></select>' +
            '</div>' +
            '<div class="trf-field">' +
              '<label for="trf-agente">Agente <span class="trf-req">*</span></label>' +
              '<select id="trf-agente" disabled><option value="">Primero elige un team</option></select>' +
            '</div>') +
          '</div>' +
          '<div class="trf-msg" role="status" aria-live="polite"></div>' +
          '<button type="submit" class="trf-btn"><i class="fas fa-share"></i> Registrar transferencia</button>' +
        '</form>' +
      '</section>' +
      (COLA
        ? '<section class="trf-card trf-cola" aria-labelledby="trf-cola-title">' +
            '<div class="trf-head">' +
              '<div class="trf-ic"><i class="ph ph-users-three"></i></div>' +
              '<div class="trf-head-txt">' +
                '<h2 class="trf-title" id="trf-cola-title">Cola de Líneas</h2>' +
                '<p class="trf-sub">En turno los conectados; la próxima transferencia va al primero.</p>' +
              '</div>' +
            '</div>' +
            '<ol class="trf-cola-lista" id="trf-cola-lista" aria-live="polite"></ol>' +
          '</section>'
        // Líneas (sin cola): el ranking en lista, al lado del formulario.
        : seccionRanking()) +
      '</div>' +
      '<section class="trf-card trf-hist" aria-labelledby="trf-hist-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="fas fa-clock-rotate-left"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-hist-title">Mis transferencias</h2>' +
            '<p class="trf-sub" id="trf-hist-sub">Las de hoy, según los filtros del resumen.</p>' +
          '</div>' +
          '<label class="trf-buscar">' +
            '<i class="ph ph-magnifying-glass" aria-hidden="true"></i>' +
            '<input type="search" id="trf-buscar" maxlength="100" autocomplete="off" ' +
              'placeholder="Buscar por cliente o teléfono" aria-label="Buscar venta por nombre del cliente o teléfono">' +
          '</label>' +
        '</div>' +
        '<div class="trf-hist-body" id="trf-hist-body"></div>' +
      '</section>' +
      // Residencial: el ranking va al final, como gráfica de barras.
      (COLA ? seccionRanking() : '');

    if (q('#trf-team')) q('#trf-team').addEventListener('change', onTeamChange);
    q('form').addEventListener('submit', onSubmit);
    q('#trf-buscar').addEventListener('input', function () {
      clearTimeout(busqTimer);
      busqTimer = setTimeout(buscarVentas, 300);
    });
    // Dos grupos de botones: periodo (recarga del servidor) y tipo (filtra lo cargado).
    panel.querySelectorAll('.trf-seg').forEach(function (grupo) {
      grupo.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          grupo.querySelectorAll('button').forEach(function (x) {
            const on = x === b;
            x.classList.toggle('trf-seg-on', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          if (b.hasAttribute('data-dias')) {
            periodo = parseInt(b.getAttribute('data-dias'), 10) || 0;
            const txt = periodo ? 'de los últimos ' + periodo + ' días' : 'de hoy';
            q('#trf-res-sub').textContent = 'Las que enviaste y las que te transfirieron ' + (periodo ? 'en los últimos ' + periodo + ' días' : 'hoy') + '.';
            q('#trf-hist-sub').textContent = 'Las ' + txt + ', según los filtros del resumen.';
            q('#trf-rank-sub').textContent = 'Cuántas lleva cada agente ' + (periodo ? 'en los últimos ' + periodo + ' días' : 'hoy') + '.';
            cargarHistorial();
          } else {
            filtroTipo = b.getAttribute('data-tipo');
            pintarHistorial();
            pintarRanking();
          }
        });
      });
    });
  }

  // ── Mis transferencias ─────────────────────────────────────────
  function fechaISO(diasAtras) {
    const d = new Date();
    d.setDate(d.getDate() - diasAtras);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtFecha(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function fmtTel(t) {
    const s = String(t || '');
    return s.length === 10 ? '(' + s.slice(0, 3) + ') ' + s.slice(3, 6) + '-' + s.slice(6) : s;
  }

  // ── Transferencias por agente (barras ordenadas de más a menos) ──
  let rankPedido = 0;
  let rankDatos = [];   // última respuesta de /ranking (enviadas y recibidas por agente)
  const RANK_TOP = 10;
  async function cargarRanking() {
    const box = q('#trf-rank-body');
    if (!box) return;
    const pedido = ++rankPedido;
    const qs = new URLSearchParams({ seccion: ORIGEN, desde: fechaISO(periodo), hasta: fechaISO(0) });
    try {
      const r = await fetch('/api/transferencias/ranking?' + qs);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      if (pedido === rankPedido) { rankDatos = j.agentes || []; pintarRanking(); }
    } catch (e) {
      if (pedido === rankPedido) box.innerHTML = '<div class="trf-vacio">No se pudo cargar el ranking</div>';
    }
  }
  // Según el filtro de tipo: Enviadas (las que hizo), Recibidas (las que le llegaron) o
  // Todas (la suma). Ordenadas de más a menos.
  /** Ranking con el filtro actual (Todas / Enviadas / Recibidas), de más a menos. */
  function rankingActual() {
    const filas = rankDatos.map(function (a) {
      const env = filtroTipo !== 'recibida', rec = filtroTipo !== 'enviada';
      return { nombre: a.nombre, team: a.team,
        total: (env ? a.enviadas : 0) + (rec ? a.recibidas : 0),
        cerradas: (env ? a.enviadas_cerradas : 0) + (rec ? a.recibidas_cerradas : 0) };
    }).sort(function (x, y) { return y.total - x.total || y.cerradas - x.cerradas || x.nombre.localeCompare(y.nombre); });
    const max = filas.reduce((m, f) => Math.max(m, f.total), 0);
    const min = filas.reduce((m, f) => Math.min(m, f.total), Infinity);
    // Si el mínimo lo comparten muchos, se resume en una nota en vez de etiquetar cada fila.
    const enMin = filas.filter((f) => f.total === min).length;
    return { filas, max, min, enMin, marcarMin: max > min && enMin <= 3,
      que: filtroTipo === 'enviada' ? 'hechas' : filtroTipo === 'recibida' ? 'recibidas' : 'hechas y recibidas',
      cuando: periodo ? 'en los últimos ' + periodo + ' días' : 'hoy' };
  }

  function filasRanking(rk, lista) {
    return '<ol class="trf-rank-lista">' + lista.map(function (f, i) {
      const tags = [];
      if (rk.max && f.total === rk.max) tags.push('<span class="trf-rank-tag mas"><i class="ph ph-caret-up"></i> Más</span>');
      if (rk.marcarMin && f.total === rk.min) tags.push('<span class="trf-rank-tag menos"><i class="ph ph-caret-down"></i> Menos</span>');
      const ancho = rk.max ? Math.round(f.total * 100 / rk.max) : 0;
      const tip = f.nombre + ' · ' + f.team + ': ' + f.total + (f.total === 1 ? ' transferencia' : ' transferencias') +
        ', ' + f.cerradas + (f.cerradas === 1 ? ' cerrada' : ' cerradas');
      return '<li class="trf-rank-fila" title="' + esc(tip) + '">' +
        '<span class="trf-rank-pos">' + (i + 1) + '</span>' +
        '<span class="trf-rank-nom"><b>' + esc(f.nombre) + '</b>' + tags.join('') +
          '<small>' + esc(String(f.team).replace(/^TEAM\s+/i, '')) + '</small></span>' +
        '<span class="trf-rank-barra" aria-hidden="true"><i style="width:' + ancho + '%"></i></span>' +
        '<span class="trf-rank-num">' + f.total + '</span>' +
      '</li>';
    }).join('') + '</ol>';
  }

  function notaEmpate(rk) {
    return rk.max > rk.min && !rk.marcarMin
      ? '<div class="trf-rank-nota">' + rk.enMin + ' agentes empatan con lo mínimo: ' + rk.min + '.</div>' : '';
  }

  /** Gráfica de barras verticales: una barra por agente con movimiento, de más a menos.
   *  Una sola serie (el filtro Todas / Enviadas / Recibidas), en el azul del logo. */
  function pintarRanking() {
    const box = q('#trf-rank-body');
    const rk = rankingActual();
    q('#trf-rank-title').textContent = 'Transferencias por agente · ' + rk.que;
    if (!rk.filas.length) { box.innerHTML = '<div class="trf-vacio">Sin agentes en esta sección</div>'; return; }
    if (!rk.max) { box.innerHTML = '<p class="trf-sin-mov">Nadie tiene transferencias ' + rk.que + ' ' + rk.cuando + '.</p>'; return; }
    if (!COLA) {
      // Líneas: lista con barras al lado del formulario (los 10 primeros + «Ver todos»).
      box.innerHTML = notaEmpate(rk) + filasRanking(rk, rk.filas.slice(0, RANK_TOP)) +
        (rk.filas.length > RANK_TOP
          ? '<button type="button" class="trf-rank-ver" aria-haspopup="dialog">Ver todos (' + rk.filas.length + ' agentes)</button>' : '');
      const ver = box.querySelector('.trf-rank-ver');
      if (ver) ver.addEventListener('click', function () { abrirRankingTodos(ver); });
      return;
    }
    const con = rk.filas.filter((f) => f.total > 0);
    const ceros = rk.filas.length - con.length;
    // Las barras se reparten el ancho de la tarjeta (entre 30 y 72 px por agente); si no
    // caben, la gráfica se desplaza de lado. MARGEN deja sitio al primer nombre inclinado.
    const H = 200, IZQ = 34, ARR = 18, ABJ = 96, MARGEN = 64, DER = 24;
    const disponible = Math.max(0, (box.clientWidth || 600) - 8 - IZQ - MARGEN - DER);
    const slot = Math.max(30, Math.min(72, disponible / con.length));
    const BW = Math.round(Math.min(40, slot * 0.62)), GAP = slot - BW;
    // Escala con números redondos (4 líneas guía).
    const paso = Math.max(1, Math.ceil(rk.max / 4));
    const tope = paso * 4;
    const ancho = Math.max((box.clientWidth || 0) - 12, IZQ + MARGEN + con.length * slot + DER);
    const y = (v) => ARR + H - (v * H / tope);
    let svg = '';
    for (let k = 0; k <= 4; k++) {
      const v = paso * k, yy = y(v);
      svg += '<line class="trf-gb-guia" x1="' + IZQ + '" x2="' + (ancho - DER) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text class="trf-gb-eje" x="' + (IZQ - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + v + '</text>';
    }
    con.forEach(function (f, i) {
      const x = IZQ + MARGEN + i * slot + (slot - BW) / 2;
      const alto = Math.max(2, f.total * H / tope);
      const top = ARR + H - alto;
      const r = Math.min(4, alto / 2);
      // Barra con las esquinas de arriba redondeadas y anclada a la base.
      const d = 'M' + x + ',' + (ARR + H) + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top +
        'H' + (x + BW - r) + 'Q' + (x + BW) + ',' + top + ' ' + (x + BW) + ',' + (top + r) + 'V' + (ARR + H) + 'Z';
      const tip = f.nombre + ' · ' + String(f.team).replace(/^TEAM\s+/i, '') + '\n' + f.total +
        (f.total === 1 ? ' transferencia' : ' transferencias') + ', ' + f.cerradas + (f.cerradas === 1 ? ' cerrada' : ' cerradas');
      svg += '<g class="trf-gb-barra" tabindex="0" role="img" aria-label="' + esc(tip.replace('\n', ': ')) + '">' +
        '<title>' + esc(tip) + '</title>' +
        '<rect class="trf-gb-hit" x="' + (x - GAP / 2) + '" y="' + ARR + '" width="' + (BW + GAP) + '" height="' + H + '"/>' +
        '<path d="' + d + '"/>' +
        '<text class="trf-gb-val" x="' + (x + BW / 2) + '" y="' + (top - 5) + '" text-anchor="middle">' + f.total + '</text>' +
        '<text class="trf-gb-nom" transform="translate(' + (x + BW / 2 + 4) + ',' + (ARR + H + 10) + ') rotate(-45)" text-anchor="end">' +
          esc(f.nombre.length > 16 ? f.nombre.slice(0, 15) + '…' : f.nombre) + '</text>' +
      '</g>';
    });
    box.innerHTML =
      '<div class="trf-gb-scroll"><svg class="trf-gb" width="' + ancho + '" height="' + (ARR + H + ABJ) + '" ' +
        'viewBox="0 0 ' + ancho + ' ' + (ARR + H + ABJ) + '" aria-label="Transferencias por agente">' + svg + '</svg></div>' +
      '<div class="trf-gb-pie">' +
        (ceros ? '<span>' + ceros + (ceros === 1 ? ' agente sin transferencias' : ' agentes sin transferencias') + ' ' + rk.cuando + '.</span>' : '<span></span>') +
        '<button type="button" class="trf-rank-ver" aria-haspopup="dialog">Ver como lista</button>' +
      '</div>';
    const btn = box.querySelector('.trf-rank-ver');
    btn.addEventListener('click', function () { abrirRankingTodos(btn); });
  }

  let anchoRank = 0;
  window.addEventListener('resize', function () {
    const box = panel && q('#trf-rank-body');
    if (!box || !COLA || !rankDatos.length) return;
    if (Math.abs(box.clientWidth - anchoRank) > 20) { anchoRank = box.clientWidth; pintarRanking(); }
  });

  /** «Ver todos»: ventana con el ranking completo del filtro elegido; la lista tiene su propio scroll. */
  function abrirRankingTodos(origenBtn) {
    const rk = rankingActual();
    const fondo = document.createElement('div');
    fondo.className = 'trf-dlg-fondo';
    fondo.innerHTML =
      '<div class="trf-dlg trf-dlg-rank" role="dialog" aria-modal="true" aria-labelledby="trf-rkt-t">' +
        '<div class="trf-dlg-rank-cab">' +
          '<div><h3 class="trf-dlg-t" id="trf-rkt-t">Transferencias por agente · ' + esc(rk.que) + '</h3>' +
          '<p class="trf-dlg-sub">' + rk.filas.length + ' agentes, ' + esc(rk.cuando) + '.</p></div>' +
          '<button type="button" class="trf-dlg-x" aria-label="Cerrar"><i class="ph ph-x" aria-hidden="true"></i></button>' +
        '</div>' +
        notaEmpate(rk) +
        '<div class="trf-rank-scroll" tabindex="0" aria-label="Lista de agentes">' + filasRanking(rk, rk.filas) + '</div>' +
      '</div>';
    function cerrar() {
      document.removeEventListener('keydown', onKey, true);
      fondo.remove();
      if (origenBtn && document.contains(origenBtn)) origenBtn.focus();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } }
    fondo.addEventListener('click', function (e) { if (e.target === fondo) cerrar(); });
    fondo.querySelector('.trf-dlg-x').addEventListener('click', cerrar);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(fondo);
    fondo.querySelector('.trf-dlg-x').focus();
  }

  /** Buscador: busca en todas las fechas por nombre del cliente o teléfono (el backend
   *  respeta lo que cada rol puede ver). Vacío → vuelve a la tabla del periodo. */
  async function buscarVentas() {
    const texto = q('#trf-buscar').value.trim();
    const pedido = ++busqPedido;
    const box = q('#trf-hist-body');
    if (texto.length < 2) {
      busqueda = '';
      encontradas = [];
      pintarHistorial();
      return;
    }
    busqueda = texto;
    box.innerHTML = '<div class="trf-vacio">Buscando…</div>';
    const qs = new URLSearchParams({ seccion: ORIGEN, buscar: texto });
    try {
      const r = await fetch('/api/transferencias?' + qs);
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'Error');
      if (pedido !== busqPedido) return;
      encontradas = j.transferencias || [];
      pintarHistorial();
    } catch (e) {
      if (pedido === busqPedido) box.innerHTML = '<div class="trf-vacio">No se pudo hacer la búsqueda</div>';
    }
  }

  async function cargarHistorial() {
    cargarRanking();
    const box = q('#trf-hist-body');
    const qs = new URLSearchParams({ seccion: ORIGEN, desde: fechaISO(periodo), hasta: fechaISO(0) });
    if (!busqueda) box.innerHTML = '<div class="trf-vacio">Cargando…</div>';
    try {
      const r = await fetch('/api/transferencias?' + qs);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      historial = j.transferencias || [];
    } catch (e) {
      q('#trf-kpis').innerHTML = '';
      if (!busqueda) box.innerHTML = '<div class="trf-vacio">No se pudieron cargar tus transferencias</div>';
      return;
    }
    if (busqueda) { pintarKpis(filtrarTipo(historial)); buscarVentas(); } else pintarHistorial();
  }

  function filtrarTipo(lista) {
    return filtroTipo ? lista.filter((f) => f.direccion_tipo === filtroTipo) : lista;
  }

  /** KPIs del periodo y del filtro (Todas / Enviadas / Recibidas) que se ven en la tabla. */
  function pintarKpis(filas) {
    const n = { total: filas.length, pendiente: 0 };
    VIGENTES.forEach((k) => { n[k] = 0; });
    filas.forEach(function (f) {
      if (VIGENTES.indexOf(f.resultado) >= 0) n[f.resultado]++;
      else n.pendiente++;   // sin resultado o con un status antiguo
    });
    const pct = (v) => (n.total ? Math.round(v * 100 / n.total) : 0) + '% del total';
    // Monedero: transferencias del periodo y del filtro (Todas / Enviadas / Recibidas)
    // cerradas como venta completada, a PAGO_POR_VENTA cada una o cada línea si llegó a Líneas.
    const vendidas = filas.reduce(function (t, f) {
      return t + (f.resultado === 'completada' ? (f.lineas || 1) : 0);
    }, 0);
    const conLineas = filas.some((f) => f.resultado === 'completada' && f.lineas);
    const dinero = '$' + (vendidas * PAGO_POR_VENTA).toFixed(2);
    const cifras = [
      { cls: 'tot', v: n.total, label: n.total === 1 ? 'transferencia' : 'transferencias' },
      { cls: 'ok',  v: n.completada, label: n.completada === 1 ? 'cerrada como venta' : 'cerradas como venta' },
      { cls: 'pend', v: n.pendiente, label: 'sin resultado' },
      { cls: 'mon', v: dinero, label: 'en el monedero · ' + vendidas +
          (conLineas ? (vendidas === 1 ? ' línea' : ' líneas') : (vendidas === 1 ? ' venta' : ' ventas')) + ' × $' + PAGO_POR_VENTA.toFixed(2) },
    ];
    // Barra de resultados: un tramo por resultado, proporcional a cuántas hay.
    const tramos = VIGENTES.map((k) => ({ cls: RESULTADOS[k].cls, label: RESULTADOS[k].label, v: n[k] }))
      .concat([{ cls: 'pend', label: 'Sin resultado', v: n.pendiente }]);
    q('#trf-kpis').innerHTML =
      '<div class="trf-cifras">' + cifras.map(function (c) {
        return '<p class="trf-cifra ' + c.cls + '"><b>' + c.v + '</b><span>' + esc(c.label) + '</span></p>';
      }).join('') + '</div>' +
      (n.total
        ? '<div class="trf-barra-res" role="img" aria-label="' + esc(tramos.filter((t) => t.v).map((t) => t.label + ': ' + t.v).join(', ')) + '">' +
            tramos.filter((t) => t.v).map(function (t) {
              return '<i class="' + t.cls + '" style="flex-grow:' + t.v + '" title="' + esc(t.label + ': ' + t.v) + '"></i>';
            }).join('') + '</div>' +
          '<ul class="trf-leyenda">' + tramos.map(function (t) {
            return '<li class="' + t.cls + (t.v ? '' : ' cero') + '"><i aria-hidden="true"></i>' + esc(t.label) + ' <b>' + t.v + '</b></li>';
          }).join('') + '</ul>'
        : '<p class="trf-sin-mov">Todavía no hay transferencias ' + (periodo ? 'en los últimos ' + periodo + ' días' : 'hoy') + '. Registra la primera en «Nueva transferencia».</p>');
  }

  function pintarHistorial() {
    const box = q('#trf-hist-body');
    // Los KPIs son siempre del periodo; la tabla, del periodo o de la búsqueda.
    pintarKpis(filtrarTipo(historial));
    const origen = busqueda ? encontradas : historial;
    const filas = filtrarTipo(origen);
    if (!filas.length) {
      box.innerHTML = '<div class="trf-vacio">' + (busqueda
        ? 'Ninguna transferencia coincide con «' + esc(busqueda) + '»'
        : 'Sin transferencias en este periodo') + '</div>';
      return;
    }
    box.innerHTML = (busqueda
        ? '<div class="trf-busq-nota">' + filas.length + (filas.length === 1 ? ' resultado' : ' resultados') +
          ' para «' + esc(busqueda) + '» en todas las fechas' + (filas.length >= 500 ? ' (se muestran los 500 más recientes)' : '') + '</div>'
        : '') +
      '<div class="trf-tabla-wrap"><table class="trf-tabla"><thead><tr>' +
      '<th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Teléfono</th><th>Motivo</th><th>De</th><th>Para</th><th>Resultado</th><th>Protegido</th>' +
      '</tr></thead><tbody>' +
      filas.map((f) => {
        const env = f.direccion_tipo === 'enviada';
        return '<tr>' +
          '<td data-l="Fecha" class="trf-nw">' + esc(fmtFecha(f.created_at)) + '</td>' +
          '<td data-l="Tipo"><span class="trf-chip ' + (env ? 'env' : 'rec') + '">' + (env ? 'Enviada' : 'Recibida') + '</span></td>' +
          '<td data-l="Cliente">' + recorte(f.nombre_cliente, 'span') + recorte(f.direccion, 'small', 1) + '</td>' +
          '<td data-l="Teléfono" class="trf-nw">' + (f.protegida_otro ? '<span class="trf-oculto-dato">' + ICONOS.ICO_CANDADO + ' Protegido</span>' : esc(fmtTel(f.telefono))) + '</td>' +
          // Motivo largo: caja de alto fijo con scroll propio, para que la fila no crezca.
          '<td data-l="Motivo" class="trf-motivo"><div class="trf-motivo-txt" tabindex="0" aria-label="Motivo de la llamada">' + esc(f.motivo) + '</div></td>' +
          '<td data-l="De">' + recorte(f.created_by_nombre || f.created_by, 'span') + recorte(f.created_by_team || '', 'small', 1) + '</td>' +
          '<td data-l="Para">' + recorte(f.agente_destino_nombre, 'span') + recorte(f.team_destino, 'small', 1) + '</td>' +
          '<td data-l="Resultado" class="trf-res-cel">' + celdaResultado(f) + '</td>' +
          '<td data-l="Protegido" class="trf-prot-cel">' + celdaProtegido(f) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
    box.querySelectorAll('[data-trf-res]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = origen.find((x) => String(x.id) === b.getAttribute('data-trf-res'));
        if (f) abrirResultado(f);
      });
    });
    box.querySelectorAll('[data-trf-tomar]').forEach(function (b) {
      b.dataset.ok = '1';
      b.addEventListener('click', function () { tomarTransferencia(b); });
    });
    box.querySelectorAll('[data-trf-lin]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = origen.find((x) => String(x.id) === b.getAttribute('data-trf-lin'));
        if (f) dialogoLineas([f], false);
      });
    });
  }

  // Iconos de línea (el subconjunto de Phosphor de la página no trae estos).
  const svgIco = (d) => '<svg class="trf-svg" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  const ICONOS = {
    ICO_CANDADO: svgIco('M56 104h144a8 8 0 0 1 8 8v96a8 8 0 0 1-8 8H56a8 8 0 0 1-8-8v-96a8 8 0 0 1 8-8Zm32 0V72a40 40 0 0 1 80 0v32'),
    ICO_ABIERTO: svgIco('M56 104h144a8 8 0 0 1 8 8v96a8 8 0 0 1-8 8H56a8 8 0 0 1-8-8v-96a8 8 0 0 1 8-8Zm32 0V72a40 40 0 0 1 76-17'),
    ICO_CHECK: svgIco('M40 144l56 56L216 80'),
    ICO_TOMAR: svgIco('M128 40v136m-48-48 48 48 48-48M48 216h160'),
  };

  // ── Protección de 24 h ─────────────────────────────────────────
  /** Celda «Protegido»: cuenta regresiva con candado mientras el agente asignado tiene la
   *  transferencia para él; «Libre» si venció sin resultado; «Gestionada» si ya lo tiene. */
  function celdaProtegido(f) {
    if (f.resultado) return '<span class="trf-prot gest">' + ICONOS.ICO_CHECK + ' Gestionada</span>';
    if (f.libre || !f.protegido_hasta) return chipLibre(f.id, f.tomable);
    return '<span class="trf-prot on" data-hasta="' + esc(f.protegido_hasta) + '"' + (f.tomable ? ' data-tomable="' + esc(f.id) + '"' : '') +
      ' title="Protegida para ' + esc(f.agente_destino_nombre || '') + '">' +
      ICONOS.ICO_CANDADO + ' <b>' + restante(f.protegido_hasta) + '</b></span>';
  }

  /** Candado abierto. Si el agente puede tomarla, el contador es un botón: al presionarlo
   *  se le asigna y vuelven a correr las 24 h. */
  function chipLibre(id, tomable) {
    return tomable
      ? '<button type="button" class="trf-prot libre trf-tomar" data-trf-tomar="' + esc(id) + '" title="Tomar esta transferencia: se te asigna y tienes 24 h">' +
          ICONOS.ICO_ABIERTO + ' 00:00:00</button>'
      : '<span class="trf-prot libre">' + ICONOS.ICO_ABIERTO + ' Libre</span>';
  }

  async function tomarTransferencia(b) {
    b.disabled = true;
    try {
      const r = await fetch('/api/transferencias/' + b.dataset.trfTomar + '/tomar', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo tomar');
      mensaje('ok', j.message || 'La tomaste');
      cargarHistorial();
    } catch (e) {
      b.disabled = false;
      mensaje('err', e.message);
      cargarHistorial();
    }
  }

  function restante(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return '00:00:00';
    const t = Math.floor(ms / 1000), p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor(t / 60) % 60) + ':' + p(t % 60);
  }

  // Un solo reloj para todas las cuentas regresivas de la página.
  setInterval(function () {
    if (!panel || document.hidden) return;
    let vencio = false;
    panel.querySelectorAll('.trf-prot.on[data-hasta]').forEach(function (el) {
      const ms = new Date(el.dataset.hasta).getTime() - Date.now();
      if (ms <= 0) {
        el.outerHTML = chipLibre(el.dataset.tomable, !!el.dataset.tomable);
        vencio = true;
      } else {
        const b = el.querySelector('b');
        if (b) b.textContent = restante(el.dataset.hasta);
      }
    });
    if (vencio) panel.querySelectorAll('[data-trf-tomar]').forEach(function (b) {
      if (!b.dataset.ok) { b.dataset.ok = '1'; b.addEventListener('click', function () { tomarTransferencia(b); }); }
    });
  }, 1000);

  /** Texto de la tabla recortado a 2 líneas (o 1) con «…», para que un texto largo no
   *  estire la fila; el completo sale al pasar el mouse. */
  function recorte(txt, tag, lineas) {
    const t = String(txt == null ? '' : txt);
    if (!t) return '';
    return '<' + tag + ' class="trf-recorte' + (lineas === 1 ? ' l1' : '') + '" title="' + esc(t) + '">' + esc(t) + '</' + tag + '>';
  }

  function celdaResultado(f) {
    const r = RESULTADOS[f.resultado];
    // Nota, quién lo registró y cuándo van en el title de la etiqueta: así la celda tiene
    // siempre el mismo alto (etiqueta + botón) aunque la nota sea larga.
    const detalle = [f.resultado_nota, f.resultado_por ? f.resultado_por + ' · ' + fmtFecha(f.resultado_at) : '']
      .filter(Boolean).join('\n');
    const etiqueta = r ? r.label : 'Pendiente';
    let html = '<span class="trf-res-linea">' +
      '<span class="trf-res ' + (r ? r.cls : 'pend') + '" title="' + esc(etiqueta + (detalle ? '\n' + detalle : '')) + '">' +
        '<i class="fas ' + (r ? r.ic : 'fa-hourglass-half') + '"></i> ' + esc(etiqueta) + (detalle ? ' <i class="ph ph-note trf-res-hay-nota" aria-label="Tiene nota"></i>' : '') + '</span>' +
      (f.lineas ? '<small class="trf-res-lin" title="Líneas vendidas">' + f.lineas + (f.lineas === 1 ? ' línea' : ' líneas') + '</small>'
        : faltanLineas(f) ? '<small class="trf-falta trf-res-lin" title="Faltan las líneas"><i class="fas fa-triangle-exclamation"></i> Líneas</small>' : '') +
      (f.captura_url ? '<a class="trf-res-cap-ic" href="' + esc(f.captura_url) + '" target="_blank" rel="noopener" title="Ver captura" aria-label="Ver captura de la venta"><i class="fas fa-image"></i></a>' : '') +
    '</span>';
    if (f.puede_lineas && !f.puede_registrar) {
      html += '<button type="button" class="trf-res-btn" data-trf-lin="' + esc(f.id) + '" title="Indicar la cantidad de líneas vendidas">' +
        '<i class="fas fa-list-ol"></i> Indicar líneas</button>';
    }
    if (f.puede_registrar) {
      html += '<button type="button" class="trf-res-btn" data-trf-res="' + esc(f.id) + '" title="Registrar el resultado de la transferencia">' +
        '<i class="fas fa-pen-to-square"></i> ' + (f.resultado ? 'Actualizar' : 'Registrar') + '</button>';
    }
    return html;
  }

  // ── Diálogo de resultado ───────────────────────────────────────
  let dlg = null;          // <div class="trf-dlg-fondo">
  let dlgFila = null;      // transferencia que se está cerrando
  let dlgArchivo = null;   // File de la captura elegida o pegada
  let dlgPreview = null;   // object URL de la vista previa

  function crearDialogo() {
    dlg = document.createElement('div');
    dlg.className = 'trf-dlg-fondo trf-oculto';
    dlg.innerHTML =
      '<form class="trf-dlg" role="dialog" aria-modal="true" aria-labelledby="trf-dlg-t" novalidate>' +
        '<h3 class="trf-dlg-t" id="trf-dlg-t">Resultado de la transferencia</h3>' +
        '<p class="trf-dlg-sub" id="trf-dlg-sub"></p>' +
        '<fieldset class="trf-dlg-ops"><legend>Status <span class="trf-req">*</span></legend>' +
          VIGENTES.map(function (k) {
            const r = RESULTADOS[k];
            return '<label class="trf-op ' + r.cls + '"><input type="radio" name="trf-res" value="' + k + '">' +
              '<i class="fas ' + r.ic + '"></i><span>' + esc(r.label) + '</span></label>';
          }).join('') +
        '</fieldset>' +
        '<div class="trf-field trf-oculto" id="trf-lineas-campo">' +
          '<label for="trf-lineas">Cantidad de líneas <span class="trf-req" id="trf-lineas-req">*</span></label>' +
          '<select id="trf-lineas"><option value="">Selecciona</option>' +
            Array.from({ length: MAX_LINEAS }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + '</option>').join('') +
          '</select>' +
          '<small class="trf-dlg-ayuda">Obligatoria para "Venta completada": se paga $' + PAGO_POR_VENTA.toFixed(2) + ' por línea al agente que transfirió.</small>' +
        '</div>' +
        '<div class="trf-field">' +
          '<label>Captura de la venta <span class="trf-req" id="trf-cap-req">*</span></label>' +
          '<label class="trf-drop" tabindex="0">' +
            '<input type="file" accept="image/*" id="trf-cap-in" hidden>' +
            '<span class="trf-drop-txt"><i class="fas fa-cloud-arrow-up"></i> Elige la imagen o pégala aquí con Ctrl+V</span>' +
            '<img class="trf-drop-img trf-oculto" alt="Vista previa de la captura">' +
          '</label>' +
          '<small class="trf-dlg-ayuda" id="trf-cap-ayuda"></small>' +
        '</div>' +
        '<div class="trf-field">' +
          '<label for="trf-res-nota">Nota (opcional)</label>' +
          '<textarea id="trf-res-nota" maxlength="500" placeholder="Ej. el cliente pidió que le llamen el viernes"></textarea>' +
        '</div>' +
        '<div class="trf-msg" role="status" aria-live="polite"></div>' +
        '<div class="trf-dlg-acc">' +
          '<button type="button" class="trf-btn-sec" data-trf-cerrar>Cancelar</button>' +
          '<button type="submit" class="trf-btn"><i class="fas fa-floppy-disk"></i> Guardar resultado</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(dlg);

    const d = (sel) => dlg.querySelector(sel);
    d('form').addEventListener('submit', guardarResultado);
    d('[data-trf-cerrar]').addEventListener('click', cerrarResultado);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) cerrarResultado(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dlg && !dlg.classList.contains('trf-oculto')) cerrarResultado();
    });
    dlg.querySelectorAll('input[name="trf-res"]').forEach(function (r) {
      r.addEventListener('change', pintarRequisitoCaptura);
    });
    d('#trf-cap-in').addEventListener('change', function (e) { elegirCaptura(e.target.files[0]); });
    d('.trf-drop').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d('#trf-cap-in').click(); }
    });
    dlg.addEventListener('paste', function (e) {
      const it = Array.prototype.find.call((e.clipboardData || {}).items || [], (x) => x.type.indexOf('image/') === 0);
      if (it) { e.preventDefault(); elegirCaptura(it.getAsFile()); }
    });
  }

  function msgDlg(tipo, texto) {
    const el = dlg.querySelector('.trf-msg');
    el.className = 'trf-msg ' + tipo;
    el.textContent = texto;
  }

  function elegirCaptura(file) {
    if (!file) return;
    if (file.type.indexOf('image/') !== 0) { msgDlg('err', 'La captura debe ser una imagen'); return; }
    if (file.size > 10 * 1024 * 1024) { msgDlg('err', 'La imagen supera 10 MB'); return; }
    dlgArchivo = file;
    if (dlgPreview) URL.revokeObjectURL(dlgPreview);
    dlgPreview = URL.createObjectURL(file);
    const img = dlg.querySelector('.trf-drop-img');
    img.src = dlgPreview;
    img.classList.remove('trf-oculto');
    dlg.querySelector('.trf-drop-txt').innerHTML = '<i class="fas fa-rotate"></i> Cambiar imagen';
    msgDlg('', '');
  }

  function resultadoElegido() {
    const r = dlg.querySelector('input[name="trf-res"]:checked');
    return r ? r.value : '';
  }

  /** Las transferencias que llegaron a Líneas muestran la cantidad de líneas; solo la
   *  venta completada la exige (y es la única que la guarda). */
  function llegoALineas() {
    return !!dlgFila && dlgFila.seccion_origen === 'residencial';
  }
  function pideLineas() {
    return resultadoElegido() === 'completada' && llegoALineas();
  }

  function pintarRequisitoCaptura() {
    dlg.querySelector('#trf-lineas-campo').classList.toggle('trf-oculto', !llegoALineas());
    dlg.querySelector('#trf-lineas-req').style.visibility = pideLineas() ? 'visible' : 'hidden';
    const obligatoria = resultadoElegido() === 'completada' && !(dlgFila && dlgFila.captura_url);
    dlg.querySelector('#trf-cap-req').style.visibility = obligatoria ? 'visible' : 'hidden';
    dlg.querySelector('#trf-cap-ayuda').textContent = dlgFila && dlgFila.captura_url
      ? 'Ya hay una captura guardada; sube otra solo si quieres reemplazarla.'
      : 'Obligatoria para "Venta completada".';
  }

  function abrirResultado(f) {
    if (!dlg) crearDialogo();
    dlgFila = f;
    dlgArchivo = null;
    if (dlgPreview) { URL.revokeObjectURL(dlgPreview); dlgPreview = null; }
    dlg.querySelector('form').reset();
    dlg.querySelector('.trf-drop-img').classList.add('trf-oculto');
    dlg.querySelector('.trf-drop-txt').innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Elige la imagen o pégala aquí con Ctrl+V';
    dlg.querySelector('#trf-dlg-sub').textContent = f.nombre_cliente + ' · ' + fmtTel(f.telefono);
    if (f.resultado) {
      const r = dlg.querySelector('input[name="trf-res"][value="' + f.resultado + '"]');
      if (r) r.checked = true;
    }
    dlg.querySelector('#trf-res-nota').value = f.resultado_nota || '';
    dlg.querySelector('#trf-lineas').value = f.lineas ? String(f.lineas) : '';
    msgDlg('', '');
    pintarRequisitoCaptura();
    dlg.classList.remove('trf-oculto');
    const primero = dlg.querySelector('input[name="trf-res"]:checked') || dlg.querySelector('input[name="trf-res"]');
    primero.focus();
  }

  function cerrarResultado() {
    if (!dlg) return;
    dlg.classList.add('trf-oculto');
    if (dlgPreview) { URL.revokeObjectURL(dlgPreview); dlgPreview = null; }
    dlgFila = null;
    dlgArchivo = null;
  }

  async function guardarResultado(ev) {
    ev.preventDefault();
    const resultado = resultadoElegido();
    if (!resultado) { msgDlg('err', 'Elige el status'); return; }
    const lineas = pideLineas() ? parseInt(dlg.querySelector('#trf-lineas').value, 10) || 0 : null;
    if (lineas === 0) {
      msgDlg('err', 'Elige la cantidad de líneas vendidas');
      dlg.querySelector('#trf-lineas').focus();
      return;
    }
    if (resultado === 'completada' && !dlgArchivo && !dlgFila.captura_url) {
      msgDlg('err', 'Sube la captura donde se ve la venta cerrada');
      return;
    }
    const btn = dlg.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      let capturaUrl = null;
      if (dlgArchivo) {
        msgDlg('', '');
        const fd = new FormData();
        fd.append('file', dlgArchivo, dlgArchivo.name || 'captura.png');
        const up = await fetch('/api/files/upload', { method: 'POST', body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.data) throw new Error(typeof uj.detail === 'string' ? uj.detail : 'No se pudo subir la captura');
        capturaUrl = uj.data.url;
      }
      const r = await fetch('/api/transferencias/' + encodeURIComponent(dlgFila.id) + '/resultado', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultado: resultado,
          captura_url: capturaUrl,
          nota: dlg.querySelector('#trf-res-nota').value.trim(),
          lineas: lineas,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo guardar el resultado');
      cerrarResultado();
      cargarHistorial();
    } catch (e) {
      msgDlg('err', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ── Aviso: ventas completadas sin cantidad de líneas ───────────
  function faltanLineas(f) {
    return f.resultado === 'completada' && f.seccion_origen === 'residencial' && !f.lineas;
  }

  /** Bloquea la página hasta que el agente de Líneas indique las líneas de cada venta
   *  completada que recibió sin ellas (registradas antes de existir el campo). */
  async function avisoLineasPendientes() {
    let filas;
    try {
      const r = await fetch('/api/transferencias/lineas-pendientes');
      const j = await r.json();
      if (!r.ok) return;
      filas = j.transferencias || [];
    } catch (e) { return; }
    if (filas.length) dialogoLineas(filas, true);
  }

  /** Diálogo para indicar las líneas de una o varias ventas completadas. Obligatorio (el
   *  aviso) no se puede cerrar; si no, lleva Cancelar (botón "Indicar líneas" de la fila). */
  function dialogoLineas(filas, obligatorio) {

    const fondo = document.createElement('div');
    fondo.className = 'trf-dlg-fondo';
    const opciones = '<option value="">Líneas</option>' +
      Array.from({ length: MAX_LINEAS }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + '</option>').join('');
    fondo.innerHTML =
      '<form class="trf-dlg trf-aviso" role="alertdialog" aria-modal="true" aria-labelledby="trf-aviso-t" aria-describedby="trf-aviso-sub" novalidate>' +
        '<h3 class="trf-dlg-t" id="trf-aviso-t"><i class="fas fa-triangle-exclamation"></i> Completa la cantidad de líneas</h3>' +
        '<p class="trf-dlg-sub" id="trf-aviso-sub">' + (obligatorio
          ? 'Tienes ' + filas.length + (filas.length === 1 ? ' venta completada' : ' ventas completadas') + ' de transferencias sin la cantidad de líneas. '
          : 'Esta venta completada no tiene la cantidad de líneas. ') +
          'Se paga $' + PAGO_POR_VENTA.toFixed(2) + ' por línea al agente que transfirió: indica las líneas de cada cliente para recalcularlo.</p>' +
        '<ul class="trf-aviso-lista">' + filas.map(function (f) {
          return '<li class="trf-aviso-fila">' +
            '<div class="trf-aviso-cli"><b>' + esc(f.nombre_cliente) + '</b>' +
              '<small>' + esc(fmtTel(f.telefono)) + ' · ' + esc(fmtFecha(f.created_at)) + '</small>' +
              '<small>Transferida por ' + esc(f.created_by_nombre || '') +
                (f.agente_destino_nombre ? ' a ' + esc(f.agente_destino_nombre) : '') + '</small>' +
              (f.captura_url ? '<a class="trf-res-cap" href="' + esc(f.captura_url) + '" target="_blank" rel="noopener"><i class="fas fa-image"></i> Ver captura</a>' : '') +
            '</div>' +
            '<select data-trf-lineas="' + esc(f.id) + '" aria-label="Cantidad de líneas de ' + esc(f.nombre_cliente) + '">' + opciones + '</select>' +
          '</li>';
        }).join('') + '</ul>' +
        '<div class="trf-msg" role="status" aria-live="polite"></div>' +
        '<div class="trf-dlg-acc">' +
          (obligatorio ? '' : '<button type="button" class="trf-btn-sec" data-trf-cerrar>Cancelar</button>') +
          '<button type="submit" class="trf-btn"><i class="fas fa-floppy-disk"></i> Guardar líneas</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(fondo);
    if (obligatorio) {
      // Sin Cancelar ni cierre con Esc o clic fuera: es obligatorio.
      fondo.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopPropagation(); }, true);
    } else {
      fondo.querySelector('[data-trf-cerrar]').addEventListener('click', () => fondo.remove());
      fondo.addEventListener('click', (e) => { if (e.target === fondo) fondo.remove(); });
      fondo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fondo.remove(); });
    }
    const msg = fondo.querySelector('.trf-msg');
    fondo.querySelector('select').focus();

    fondo.querySelector('form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const sels = Array.prototype.slice.call(fondo.querySelectorAll('[data-trf-lineas]'));
      const vacio = sels.find((x) => !x.value);
      if (vacio) {
        msg.className = 'trf-msg err';
        msg.textContent = 'Indica la cantidad de líneas de todos los clientes';
        vacio.focus();
        return;
      }
      const btn = fondo.querySelector('button[type="submit"]');
      btn.disabled = true;
      msg.className = 'trf-msg';
      try {
        for (const sel of sels) {
          const r = await fetch('/api/transferencias/' + encodeURIComponent(sel.getAttribute('data-trf-lineas')) + '/lineas', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineas: parseInt(sel.value, 10) }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudieron guardar las líneas');
          sel.closest('li').remove();   // guardada: si falla otra, no se reenvía
        }
        fondo.remove();
        cargarHistorial();
      } catch (e) {
        msg.className = 'trf-msg err';
        msg.textContent = e.message;
        btn.disabled = false;
      }
    });
  }

  function mensaje(tipo, texto) {
    const el = q('.trf-msg');
    el.className = 'trf-msg ' + tipo;
    el.textContent = texto;
  }

  async function cargarDestinos() {
    const sel = q('#trf-team');
    if (!sel) return;   // con cola no se elige destino
    try {
      const r = await fetch('/api/transferencias/destinos?origen=' + ORIGEN);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      destinos = j.teams || [];
    } catch (e) {
      destinos = null;   // se reintenta la próxima vez que se abra la pestaña
      sel.innerHTML = '<option value="">No se pudieron cargar los teams</option>';
      return;
    }
    sel.innerHTML = '<option value="">Selecciona un team</option>' +
      destinos.map((t) => '<option value="' + esc(t.team) + '">' + esc(t.team) + '</option>').join('');
  }

  function onTeamChange() {
    const sel = q('#trf-agente');
    if (!sel) return;
    const t = (destinos || []).find((x) => x.team === q('#trf-team').value);
    if (!t) {
      sel.innerHTML = '<option value="">Primero elige un team</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML = '<option value="">Selecciona el agente</option>' +
      t.agentes.map((a) => '<option value="' + a.id + '">' + esc(a.nombre) + '</option>').join('');
    sel.disabled = false;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const tel = q('#trf-telefono').value.replace(/\D/g, '');
    if (tel.length < 7 || tel.length > 15) {
      mensaje('err', 'Número de teléfono inválido');
      q('#trf-telefono').focus();
      return;
    }
    const body = {
      origen: ORIGEN,
      telefono: tel,
      motivo: q('#trf-motivo').value.trim(),
      nombre_cliente: q('#trf-nombre').value.trim(),
      direccion: q('#trf-direccion').value.trim(),
      team_destino: COLA ? '' : q('#trf-team').value,
      agente_destino_id: COLA ? 0 : parseInt(q('#trf-agente').value, 10) || 0,
    };
    if (!body.motivo || !body.nombre_cliente || !body.direccion || (!COLA && (!body.team_destino || !body.agente_destino_id))) {
      mensaje('err', 'Completa todos los campos');
      return;
    }
    const btn = q('.trf-btn');
    btn.disabled = true;
    try {
      const r = await fetch('/api/transferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo guardar');
      q('form').reset();
      onTeamChange();
      mensaje('ok', COLA && j.agente
        ? 'Transferencia registrada y asignada a ' + j.agente + ' (' + String(j.team || '').replace(/^TEAM\s+/i, '') + ').'
        : 'Transferencia registrada');
      cargarHistorial();
      if (COLA) cargarCola();
    } catch (e) {
      mensaje('err', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ── Cola de Líneas ─────────────────────────────────────────────
  // Lista vertical: el primero recibe la próxima transferencia y, al recibirla, baja al
  // final. Cada fila se identifica por el id del agente, así al cambiar el orden las filas
  // se deslizan a su nuevo lugar (técnica FLIP) en vez de redibujarse de golpe.
  let colaTimer = null;
  let colaOrdenar = false;   // admin/BO: puede poner a un agente primero (una vez)
  let colaPedido = 0;
  const sinAnimar = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function haceCuanto(iso) {
    if (!iso) return 'Sin transferencias aún';
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'Recibió hace un momento';
    if (min < 60) return 'Recibió hace ' + min + ' min';
    const h = Math.floor(min / 60);
    if (h < 24) return 'Recibió hace ' + h + ' h';
    return 'Recibió hace ' + Math.floor(h / 24) + ' d';
  }

  async function cargarCola() {
    const lista = q('#trf-cola-lista');
    if (!lista) return;
    const pedido = ++colaPedido;
    let agentes;
    try {
      const r = await fetch('/api/transferencias/cola');
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      agentes = j.agentes || [];
      colaOrdenar = !!j.puede_ordenar;
    } catch (e) {
      if (pedido === colaPedido && !lista.children.length) {
        lista.innerHTML = '<li class="trf-cola-vacia">No se pudo cargar la cola.</li>';
      }
      return;
    }
    if (pedido !== colaPedido) return;
    pintarCola(lista, agentes);
  }

  function pintarCola(lista, agentes) {
    const asigna = q('#trf-asigna');
    const btn = q('.trf-btn');
    // Solo los conectados: un agente desconectado no puede recibir transferencias.
    agentes = agentes.filter((a) => a.conectado !== false);
    if (!agentes.length) {
      lista.innerHTML = '<li class="trf-cola-vacia">Ningún agente de Líneas está conectado.</li>';
      if (asigna) asigna.innerHTML = '<i class="ph ph-warning" aria-hidden="true"></i> No hay agentes de Líneas conectados: no se puede transferir ahora.';
      if (btn) btn.disabled = true;
      return;
    }
    if (btn) btn.disabled = false;
    const sig = agentes[0];
    if (asigna) {
      asigna.innerHTML = '<span>Se asignará a</span> <b>' + esc(sig.nombre) + '</b> <small>' +
        esc(String(sig.team).replace(/^TEAM\s+/i, '')) + '</small>';
    }
    // FLIP: posición antes del cambio, por id de agente.
    const antes = {};
    lista.querySelectorAll('li[data-id]').forEach((li) => { antes[li.dataset.id] = li.getBoundingClientRect().top; });
    const previos = {};
    lista.querySelectorAll('li[data-id]').forEach((li) => { previos[li.dataset.id] = li; });
    lista.innerHTML = '';
    agentes.forEach(function (a, i) {
      const li = previos[a.id] || document.createElement('li');
      li.dataset.id = a.id;
      li.className = 'trf-cola-fila' + (i === 0 ? ' sig' : '');
      li.innerHTML = '<span class="trf-cola-pos">' + (i + 1) + '</span>' +
        '<span class="trf-cola-nom"><b>' + esc(a.nombre) + '</b><small>' +
          esc(String(a.team).replace(/^TEAM\s+/i, '')) + ' · ' + esc(haceCuanto(a.ultima)) + '</small></span>' +
        (i === 0 ? '<span class="trf-cola-tag">Siguiente</span>'
          : colaOrdenar ? '<button type="button" class="trf-cola-subir" data-primero="' + a.id + '" title="Que ' + esc(a.nombre) +
              ' reciba la próxima transferencia (una sola vez)">Poner primero</button>' : '');
      lista.appendChild(li);
    });
    lista.querySelectorAll('[data-primero]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        const r = await fetch('/api/transferencias/cola/primero', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: parseInt(b.dataset.primero, 10) }) });
        if (!r.ok) { b.disabled = false; mensaje('err', 'No se pudo cambiar el orden de la cola'); return; }
        cargarCola();
      });
    });
    if (sinAnimar) return;
    lista.querySelectorAll('li[data-id]').forEach(function (li) {
      const y0 = antes[li.dataset.id];
      const dy = y0 === undefined ? 0 : y0 - li.getBoundingClientRect().top;
      if (y0 === undefined) {
        li.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
      } else if (dy) {
        li.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
  }

  function vigilarCola() {
    if (!COLA) return;
    cargarCola();
    clearInterval(colaTimer);
    colaTimer = setInterval(function () { if (!document.hidden) cargarCola(); }, COLA_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) cargarCola(); });
  }

  // ── Pestañas ───────────────────────────────────────────────────
  let actual = null;
  let salidaTimer = null;

  function sinMovimiento() {
    return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ocultar(p, si) {
    p.classList.toggle(p.hasAttribute('data-trf-reserve') ? 'trf-invisible' : 'trf-oculto', si);
  }

  /** Desplaza la píldora de fondo bajo la pestaña activa. */
  function moverPildora(animar) {
    document.querySelectorAll('.trf-tabs').forEach(function (tabs) {
      const on = tabs.querySelector('.trf-tab-on');
      let pill = tabs.querySelector('.trf-pill');
      if (!on) return;
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'trf-pill';
        pill.setAttribute('aria-hidden', 'true');
        tabs.insertBefore(pill, tabs.firstChild);
        tabs.classList.add('trf-tabs-pill');
      }
      pill.classList.toggle('trf-pill-anim', !!animar);
      pill.style.width = on.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + (on.offsetLeft - pill.offsetLeft) + 'px)';
    });
  }

  function activar(tab, animar) {
    if (tab === actual) return;
    actual = tab;
    animar = animar && !sinMovimiento();

    document.querySelectorAll('[data-trf-tab]').forEach(function (b) {
      const on = b.getAttribute('data-trf-tab') === tab;
      b.classList.toggle('trf-tab-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    moverPildora(animar);

    const paneles = Array.prototype.slice.call(document.querySelectorAll('[data-trf-panel]'));
    const entran = paneles.filter((p) => p.getAttribute('data-trf-panel') === tab);
    const salen = paneles.filter((p) => p.getAttribute('data-trf-panel') !== tab);

    function mostrarEntrantes() {
      salen.forEach(function (p) { p.classList.remove('trf-sale'); ocultar(p, true); });
      entran.forEach(function (p) {
        ocultar(p, false);
        if (!animar) return;
        p.classList.remove('trf-entra');
        void p.offsetWidth;   // reinicia la animación si se cambia rápido de pestaña
        p.classList.add('trf-entra');
      });
    }

    clearTimeout(salidaTimer);
    entran.forEach(function (p) { p.classList.remove('trf-sale'); });
    if (animar) {
      salen.forEach(function (p) { p.classList.remove('trf-entra'); p.classList.add('trf-sale'); });
      salidaTimer = setTimeout(mostrarEntrantes, SALIDA_MS);
    } else {
      mostrarEntrantes();
    }

    if (tab === 'transferencia') {
      if (!destinos) cargarDestinos();
      cargarHistorial();   // cada vez: pudieron transferirte llamadas mientras tanto
    }
    const hash = tab === 'transferencia' ? '#transferencia' : '';
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  }

  document.addEventListener('DOMContentLoaded', function () {
    panel = document.getElementById('trf-panel');
    if (!panel) return;
    render();
    // Página propia (sin pestañas): el formulario se ve directamente.
    if (!document.querySelector('[data-trf-tab]')) {
      panel.classList.remove('trf-oculto');
      cargarDestinos();
      cargarHistorial();
      if (window.CRMNotificaciones) window.CRMNotificaciones.on('transferencias_libres', cargarHistorial);
      vigilarCola();
      if (ORIGEN === 'lineas') avisoLineasPendientes();
      return;
    }
    if (ORIGEN === 'lineas') avisoLineasPendientes();
    document.querySelectorAll('[data-trf-tab]').forEach(function (b) {
      b.addEventListener('click', function () { activar(b.getAttribute('data-trf-tab'), true); });
    });
    document.querySelectorAll('[data-trf-panel]').forEach(function (p) {
      p.addEventListener('animationend', function () { p.classList.remove('trf-entra'); });
    });
    activar(location.hash === '#transferencia' ? 'transferencia' : 'lead', false);
    // La fuente de iconos puede cambiar el ancho de las pestañas al terminar de cargar.
    window.addEventListener('load', function () { moverPildora(false); });
    window.addEventListener('resize', function () { moverPildora(false); });
  });
})();
