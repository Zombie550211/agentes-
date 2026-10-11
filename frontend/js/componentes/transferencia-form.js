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
 * consulta lo que envió y lo que recibió sin salir del formulario.
 *
 * Resultado: quien RECIBIÓ la transferencia (o el supervisor de su team) la cierra desde su fila de "Mis
 * transferencias" con Venta completada / Fraude / Balance / Pago full / No
 * interesado y la captura de la venta (obligatoria para "completada"). Si la venta
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
  const SALIDA_MS = 160;   // = duración de trfSale en transferencia-form.css

  let destinos = null;   // [{team, agentes:[{id,nombre,username}]}] — se carga al abrir la pestaña
  let panel = null;
  let historial = [];    // última carga de "Mis transferencias"
  let filtroTipo = '';   // '' | 'enviada' | 'recibida'
  let periodo = 0;       // días hacia atrás: 0 = hoy, 7, 30
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
    seguimiento:   { label: 'Cliente en seguimiento', ic: 'fa-clock',              cls: 'seg', antiguo: true },
    no_realizada:  { label: 'Venta no realizada',     ic: 'fa-circle-xmark',       cls: 'no',  antiguo: true },
  };
  const VIGENTES = Object.keys(RESULTADOS).filter((k) => !RESULTADOS[k].antiguo);

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  const q = (sel) => panel.querySelector(sel);

  function render() {
    panel.innerHTML =
      // Resumen arriba del todo: KPIs con los filtros de periodo (Hoy por defecto) y tipo.
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
      // Ranking: transferencias hechas por cada agente de la sección en el periodo.
      '<section class="trf-card trf-rank" aria-labelledby="trf-rank-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="ph ph-trophy"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-rank-title">Transferencias por agente</h2>' +
            '<p class="trf-sub" id="trf-rank-sub">Quién lleva más y quién lleva menos hoy.</p>' +
          '</div>' +
        '</div>' +
        '<div class="trf-rank-body" id="trf-rank-body" aria-live="polite"></div>' +
      '</section>' +
      '<section class="trf-card" aria-labelledby="trf-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="fas fa-phone-volume"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-title">Transferencia de llamada</h2>' +
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
            '<div class="trf-field">' +
              '<label for="trf-team">Team de ' + esc(DESTINO_LABEL) + ' <span class="trf-req">*</span></label>' +
              '<select id="trf-team"><option value="">Cargando…</option></select>' +
            '</div>' +
            '<div class="trf-field">' +
              '<label for="trf-agente">Agente <span class="trf-req">*</span></label>' +
              '<select id="trf-agente" disabled><option value="">Primero elige un team</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="trf-msg" role="status" aria-live="polite"></div>' +
          '<button type="submit" class="trf-btn"><i class="fas fa-share"></i> Registrar transferencia</button>' +
        '</form>' +
      '</section>' +
      '<section class="trf-card trf-hist" aria-labelledby="trf-hist-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="fas fa-clock-rotate-left"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-hist-title">Mis transferencias</h2>' +
            '<p class="trf-sub" id="trf-hist-sub">Las de hoy, según los filtros del resumen.</p>' +
          '</div>' +
        '</div>' +
        '<div class="trf-hist-body" id="trf-hist-body"></div>' +
      '</section>';

    q('#trf-team').addEventListener('change', onTeamChange);
    q('form').addEventListener('submit', onSubmit);
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
            q('#trf-rank-sub').textContent = 'Quién lleva más y quién lleva menos ' + (periodo ? 'en los últimos ' + periodo + ' días' : 'hoy') + '.';
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
  function pintarRanking() {
    const box = q('#trf-rank-body');
    const filas = rankDatos.map(function (a) {
      const env = filtroTipo !== 'recibida', rec = filtroTipo !== 'enviada';
      return { nombre: a.nombre, team: a.team,
        total: (env ? a.enviadas : 0) + (rec ? a.recibidas : 0),
        cerradas: (env ? a.enviadas_cerradas : 0) + (rec ? a.recibidas_cerradas : 0) };
    }).sort(function (x, y) { return y.total - x.total || y.cerradas - x.cerradas || x.nombre.localeCompare(y.nombre); });
    const que = filtroTipo === 'enviada' ? 'hechas' : filtroTipo === 'recibida' ? 'recibidas' : 'hechas y recibidas';
    q('#trf-rank-title').textContent = 'Transferencias por agente · ' + que;
    if (!filas.length) { box.innerHTML = '<div class="trf-vacio">Sin agentes en esta sección</div>'; return; }
    const max = filas.reduce((m, f) => Math.max(m, f.total), 0);
    const min = filas.reduce((m, f) => Math.min(m, f.total), Infinity);
    // Si el mínimo lo comparten muchos, se resume en una nota en vez de etiquetar cada fila.
    const enMin = filas.filter((f) => f.total === min).length;
    const marcarMin = max > min && enMin <= 3;
    const nota = !max ? '<div class="trf-rank-nota">Sin transferencias ' + que + ' en este periodo.</div>'
      : (max > min && !marcarMin ? '<div class="trf-rank-nota">' + enMin + ' agentes empatan con lo mínimo: ' + min + '.</div>' : '');
    box.innerHTML = nota + '<ol class="trf-rank-lista">' + filas.map(function (f, i) {
      const tags = [];
      if (max && f.total === max) tags.push('<span class="trf-rank-tag mas"><i class="ph ph-caret-up"></i> Más</span>');
      if (marcarMin && f.total === min) tags.push('<span class="trf-rank-tag menos"><i class="ph ph-caret-down"></i> Menos</span>');
      const ancho = max ? Math.round(f.total * 100 / max) : 0;
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

  async function cargarHistorial() {
    cargarRanking();
    const box = q('#trf-hist-body');
    const qs = new URLSearchParams({ seccion: ORIGEN, desde: fechaISO(periodo), hasta: fechaISO(0) });
    box.innerHTML = '<div class="trf-vacio">Cargando…</div>';
    try {
      const r = await fetch('/api/transferencias?' + qs);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      historial = j.transferencias || [];
    } catch (e) {
      q('#trf-kpis').innerHTML = '';
      box.innerHTML = '<div class="trf-vacio">No se pudieron cargar tus transferencias</div>';
      return;
    }
    pintarHistorial();
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
    const tarjetas = [
      { cls: 'tot',  ic: 'fa-phone-volume',   label: 'Transferidas',   v: n.total,        sub: filtroTipo === 'enviada' ? 'Enviadas' : filtroTipo === 'recibida' ? 'Recibidas' : 'Enviadas y recibidas' },
      { cls: 'ok',   ic: RESULTADOS.completada.ic,   label: 'Cerradas',       v: n.completada,   sub: pct(n.completada) },
    ].concat(VIGENTES.filter((k) => k !== 'completada').map(function (k) {
      const r = RESULTADOS[k];
      return { cls: r.cls, ic: r.ic, label: r.label, v: n[k], sub: pct(n[k]) };
    })).concat([
      { cls: 'pend', ic: 'fa-hourglass-half', label: 'Pendientes',     v: n.pendiente,    sub: 'Sin resultado' },
      { cls: 'mon',  ic: 'ph-coins',         label: 'Monedero',       v: dinero,
        sub: vendidas + (conLineas ? (vendidas === 1 ? ' línea/venta' : ' líneas/ventas') : (vendidas === 1 ? ' venta' : ' ventas')) +
          ' × $' + PAGO_POR_VENTA.toFixed(2) },
    ]);
    q('#trf-kpis').innerHTML = tarjetas.map(function (t) {
      return '<div class="trf-kpi ' + t.cls + '">' +
        '<div class="trf-kpi-head"><span class="trf-kpi-label">' + esc(t.label) + '</span>' +
          '<span class="trf-kpi-ic"><i class="' + (t.ic.indexOf('ph-') === 0 ? 'ph ' : 'fas ') + t.ic + '"></i></span></div>' +
        '<div class="trf-kpi-num">' + t.v + '</div>' +
        '<div class="trf-kpi-sub">' + esc(t.sub) + '</div>' +
      '</div>';
    }).join('');
  }

  function pintarHistorial() {
    const box = q('#trf-hist-body');
    const filas = filtroTipo ? historial.filter((f) => f.direccion_tipo === filtroTipo) : historial;
    pintarKpis(filas);
    if (!filas.length) {
      box.innerHTML = '<div class="trf-vacio">Sin transferencias en este periodo</div>';
      return;
    }
    box.innerHTML = '<div class="trf-tabla-wrap"><table class="trf-tabla"><thead><tr>' +
      '<th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Teléfono</th><th>Motivo</th><th>De</th><th>Para</th><th>Resultado</th>' +
      '</tr></thead><tbody>' +
      filas.map((f) => {
        const env = f.direccion_tipo === 'enviada';
        return '<tr>' +
          '<td class="trf-nw">' + esc(fmtFecha(f.created_at)) + '</td>' +
          '<td><span class="trf-chip ' + (env ? 'env' : 'rec') + '">' + (env ? 'Enviada' : 'Recibida') + '</span></td>' +
          '<td>' + esc(f.nombre_cliente) + '<small>' + esc(f.direccion) + '</small></td>' +
          '<td class="trf-nw">' + esc(fmtTel(f.telefono)) + '</td>' +
          // Motivo largo: caja de alto fijo con scroll propio, para que la fila no crezca.
          '<td class="trf-motivo"><div class="trf-motivo-txt" tabindex="0" aria-label="Motivo de la llamada">' + esc(f.motivo) + '</div></td>' +
          '<td>' + esc(f.created_by_nombre || f.created_by) + '<small>' + esc(f.created_by_team || '') + '</small></td>' +
          '<td>' + esc(f.agente_destino_nombre) + '<small>' + esc(f.team_destino) + '</small></td>' +
          '<td class="trf-res-cel">' + celdaResultado(f) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
    box.querySelectorAll('[data-trf-res]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = historial.find((x) => String(x.id) === b.getAttribute('data-trf-res'));
        if (f) abrirResultado(f);
      });
    });
    box.querySelectorAll('[data-trf-lin]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = historial.find((x) => String(x.id) === b.getAttribute('data-trf-lin'));
        if (f) dialogoLineas([f], false);
      });
    });
  }

  function celdaResultado(f) {
    const r = RESULTADOS[f.resultado];
    let html = r
      ? '<span class="trf-res ' + r.cls + '"><i class="fas ' + r.ic + '"></i> ' + esc(r.label) + '</span>'
      : '<span class="trf-res pend"><i class="fas fa-hourglass-half"></i> Pendiente</span>';
    if (f.lineas) html += '<small>' + f.lineas + (f.lineas === 1 ? ' línea' : ' líneas') + '</small>';
    else if (faltanLineas(f)) html += '<small class="trf-falta"><i class="fas fa-triangle-exclamation"></i> Faltan las líneas</small>';
    if (f.captura_url) {
      html += '<a class="trf-res-cap" href="' + esc(f.captura_url) + '" target="_blank" rel="noopener">' +
        '<i class="fas fa-image"></i> Ver captura</a>';
    }
    if (f.resultado_nota) html += '<small>' + esc(f.resultado_nota) + '</small>';
    if (f.resultado_por) html += '<small>' + esc(f.resultado_por) + ' · ' + esc(fmtFecha(f.resultado_at)) + '</small>';
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
      team_destino: q('#trf-team').value,
      agente_destino_id: parseInt(q('#trf-agente').value, 10) || 0,
    };
    if (!body.motivo || !body.nombre_cliente || !body.direccion || !body.team_destino || !body.agente_destino_id) {
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
      mensaje('ok', 'Transferencia registrada');
      cargarHistorial();
    } catch (e) {
      mensaje('err', e.message);
    } finally {
      btn.disabled = false;
    }
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
