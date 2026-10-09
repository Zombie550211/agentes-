/**
 * Página de inicio (residencial/inicio.html y lineas/inicio.html: misma página).
 *
 * Es el diseño "HR Mate" convertido a JS sin dependencias: el original venía empaquetado
 * con un motor de plantillas ({{ … }}, <sc-for>) que se arrancaba desde blob: y React de
 * unpkg, y la CSP del CRM (script-src 'self') lo bloquea con razón.
 *
 * Fase 1: los datos son los de ejemplo del diseño (mismo aspecto que la maqueta). Cada
 * bloque tiene su función de pintado para conectarle después los datos reales del CRM.
 * Todo texto entra por esc(): cuando lleguen datos de usuarios no puede inyectar HTML.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Barra superior: el menú lo pinta js/layout/topnav.js y los iconos js/layout/topbar-acciones.js ──
  function pintarUsuario(s) {
    var u = (s && s.user) || {};                       // /api/auth/verify-server → { user: {...} }
    var nombre = String(u.name || u.username || '').trim();
    if (!nombre) return;
    $('in-hola').textContent = '¡Hola, ' + nombre.split(/\s+/)[0] + '!';
  }

  // ── Datos reales: /api/dashboard/home (todo residencial, mes en curso) ──
  var MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var fmtN = function (n, dec) { return Number(n || 0).toLocaleString('es-SV', { maximumFractionDigits: dec || 0 }); };
  function cargarDatos() {
    return fetch('/api/dashboard/home', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ── Tarjetas: ventas, puntos y mejor vendedor del mes ──
  // Tarjeta de indicador, estilo sobrio: rótulo arriba, icono de línea en un marco fino
  // y la cifra debajo. Sin rellenos de color ni adornos.
  function tarjeta(icon, valor, label, chico) {
    return '<div class="in-glass in-glass-card in-kpi-card">' +
      '<div class="in-kpi-head"><span>' + esc(label) + '</span><span class="in-kpi-ico" aria-hidden="true"><i class="ph ' + icon + '"></i></span></div>' +
      '<div class="in-kpi-num' + (chico ? ' in-kpi-num-txt' : '') + '">' + esc(valor) + '</div>' +
    '</div>';
  }
  function pintarStats(d) {
    var hero = $('in-hero');
    hero.querySelectorAll('.in-stat').forEach(function (n) { n.remove(); });
    var k = (d && d.kpis) || {}, mes = d && d.hoy ? MES_LARGO[d.hoy.mes - 1] : 'mes';
    var mejor = k.mejor_vendedor && k.mejor_vendedor !== '—' ? k.mejor_vendedor : 'Sin ventas aún';
    var html = d
      ? tarjeta('ph-shopping-cart', fmtN(k.ventas_totales), 'Ventas totales de ' + mes) +
        tarjeta('ph-star', fmtN(k.puntos_totales, 1), 'Puntos totales de ' + mes) +
        tarjeta('ph-trophy', mejor, 'Mejor vendedor de ' + mes, true)
      : tarjeta('ph-shopping-cart', '—', 'Ventas totales') + tarjeta('ph-star', '—', 'Puntos totales') + tarjeta('ph-trophy', '—', 'Mejor vendedor');
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    Array.prototype.slice.call(tmp.children).forEach(function (c) { c.classList.add('in-stat'); hero.appendChild(c); });
  }

  // ── Ventas mensuales (línea con punto que sigue al ratón) ──
  var W = 560, X0 = 40, TOP = 10, BOT = 150;
  var mensual = [], mesActual = 0, kpiIdx = 0;
  function px(i) { return X0 + i * ((W - X0 - 10) / 11); }
  function techo(max) {                                    // escala «redonda» para el eje
    if (max <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
    var pasos = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];   // 56 → 60, 912 → 1.000
    for (var i = 0; i < pasos.length; i++) if (f <= pasos[i]) return pasos[i] * p;
    return 10 * p;
  }
  function pintarKpi() {
    var vals = mensual.slice(0, mesActual + 1);             // hasta el mes en curso
    var top = techo(Math.max.apply(null, vals.concat([1])));
    var py = function (v) { return BOT - (v / top) * (BOT - TOP); };
    var pts = vals.map(function (v, i) { return [px(i), py(v)]; });
    var d = 'M ' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1], mx = (ax + bx) / 2;
      d += ' C ' + mx + ' ' + ay + ', ' + mx + ' ' + by + ', ' + bx + ' ' + by;
    }
    var hp = pts[Math.min(kpiIdx, pts.length - 1)];
    $('in-kpi').innerHTML = '<defs><linearGradient id="kpiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--color-accent-200)"></stop><stop offset="1" stop-color="var(--color-accent-100)" stop-opacity="0"></stop></linearGradient></defs>' +
      [1, 0.75, 0.5, 0.25, 0].map(function (f) {
        var y = py(top * f);
        return '<line x1="30" x2="560" y1="' + y + '" y2="' + y + '" stroke="var(--color-neutral-200)"></line>' +
          '<text x="0" y="' + (y + 3) + '" font-size="9" fill="var(--color-neutral-500)">' + fmtN(top * f) + '</text>';
      }).join('') +
      '<path d="' + d + ' L ' + pts[pts.length - 1][0] + ' ' + BOT + ' L ' + pts[0][0] + ' ' + BOT + ' Z" fill="url(#kpiFill)"></path>' +
      '<path d="' + d + '" fill="none" stroke="var(--color-accent-2-500)" stroke-width="2"></path>' +
      '<line x1="' + hp[0] + '" x2="' + hp[0] + '" y1="' + hp[1] + '" y2="150" stroke="var(--color-text)" stroke-width="1"></line>' +
      '<circle cx="' + hp[0] + '" cy="' + hp[1] + '" r="4" fill="var(--color-accent-2-600)" stroke="var(--color-neutral-100)" stroke-width="2"></circle>' +
      MES_CORTO.map(function (m, i) {
        return '<text x="' + px(i) + '" y="166" font-size="9" text-anchor="middle" fill="' + (i > mesActual ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)') + '">' + m + '</text>';
      }).join('');
    var tip = $('in-kpi-tip');
    tip.style.left = (hp[0] / W * 100) + '%';
    tip.style.top = (hp[1] / 170 * 100) + '%';
    var v = vals[Math.min(kpiIdx, vals.length - 1)];
    tip.textContent = MES_CORTO[kpiIdx] + ': ' + fmtN(v) + (v === 1 ? ' venta' : ' ventas');
  }
  function moverKpi(e) {
    if (!mensual.length) return;
    var r = e.currentTarget.getBoundingClientRect();
    var i = Math.max(0, Math.min(mesActual, Math.round(((e.clientX - r.left) / r.width * W - X0) / ((W - X0 - 10) / 11))));
    if (i !== kpiIdx) { kpiIdx = i; pintarKpi(); }
  }
  function pintarMensual(d) {
    mensual = (d.chart_ventas_mensuales || []).map(function (x) { return +x.ventas || 0; });
    while (mensual.length < 12) mensual.push(0);
    mesActual = kpiIdx = (d.hoy ? d.hoy.mes : new Date().getMonth() + 1) - 1;
    var act = mensual[mesActual], ant = mesActual > 0 ? mensual[mesActual - 1] : null;
    $('in-kpi-anio').textContent = d.hoy ? d.hoy.anio : new Date().getFullYear();
    $('in-kpi-valor').textContent = fmtN(act) + (act === 1 ? ' venta' : ' ventas');
    // Sin % de variación: el mes en curso va a medias y compararlo con el anterior completo
    // marcaría siempre una caída a principio de mes.
    $('in-kpi-ant').textContent = ant === null ? 'En ' + MES_LARGO[mesActual] : 'En ' + MES_LARGO[mesActual] + ' · mes anterior: ' + fmtN(ant);
    pintarKpi();
  }

  // ── Ventas diarias: los últimos 7 días, una barra por día con su cifra encima ──
  function pintarDiario(d) {
    var dias = d.chart_ventas_7dias || [];
    if (!dias.length) return;
    var corto = function (x) { return x.dia + ' ' + MES_CORTO[x.mes - 1].toLowerCase(); };
    $('in-diario-mes').textContent = corto(dias[0]) + ' – ' + corto(dias[dias.length - 1]);
    var vals = dias.map(function (x) { return +x.ventas || 0; });
    var top = techo(Math.max.apply(null, vals.concat([1])));
    var total = vals.reduce(function (a, b) { return a + b; }, 0);
    $('in-diario-res').textContent = fmtN(total) + ' ventas en 7 días';
    $('in-asist').innerHTML =
      '<div style="display:flex;flex-direction:column;justify-content:space-between;font-size:9px;line-height:1;color:var(--color-neutral-500);padding:14px 0 18px;margin-bottom:-4px;text-align:right">' +
        [1, 0.75, 0.5, 0.25, 0].map(function (f) { return '<span>' + fmtN(top * f) + '</span>'; }).join('') + '</div>' +
      dias.map(function (x, i) {
        var v = vals[i], esHoy = i === dias.length - 1;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0" title="' +
            esc(corto(x)) + ': ' + v + (v === 1 ? ' venta' : ' ventas') + '">' +
          // Columna: fondo claro y la barra abajo; la cifra va justo encima de la barra.
          '<div style="flex:1;width:22px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;background:var(--color-accent-2-100);border-radius:3px">' +
            '<span style="font-size:9px;font-weight:700;color:var(--color-text);margin-bottom:3px">' + fmtN(v) + '</span>' +
            '<div style="width:100%;height:calc((100% - 14px) * ' + (v / top).toFixed(4) + ');background:var(--color-accent-2-500);border-radius:3px"></div>' +
          '</div>' +
          '<div style="font-size:9px;white-space:nowrap;color:' + (esHoy ? 'var(--color-accent-2-600)' : 'var(--color-neutral-500)') +
            ';font-weight:' + (esHoy ? 700 : 400) + '">' + (esHoy ? 'Hoy' : esc(corto(x))) + '</div>' +
        '</div>';
      }).join('');
  }

  // ── Video promocional (GET/POST/DELETE /api/promo-video) ──
  // Al subirlo el servidor lo recomprime en segundo plano: mientras tanto se consulta
  // el estado cada pocos segundos y, al terminar, se carga el video nuevo.
  var promoUrl = null, promoEspera = null;
  function promoMensaje(txt) {
    $('in-promo-msg').textContent = txt;
    $('in-promo-vacio').hidden = false;
  }
  function pintarPromo(j) {
    var video = $('in-promo-video');
    // El video se gestiona desde Promociones activas (residencial/promociones-validas.html):
    // aquí sólo se ve, sin botones encima.
    $('in-promo-barra').hidden = true;
    $('in-promo-subir').querySelector('span').textContent = j.url ? 'Cambiar video' : 'Subir video';
    $('in-promo-subir').setAttribute('aria-disabled', j.procesando ? 'true' : 'false');
    $('in-promo-quitar').hidden = !j.puede_editar || !j.url || j.procesando;
    if (j.url !== promoUrl) {
      promoUrl = j.url;
      if (j.url) { video.src = j.url; video.hidden = false; video.play().catch(function () {}); }
      else { video.removeAttribute('src'); video.load(); video.hidden = true; }
    }
    if (j.procesando) promoMensaje('Comprimiendo el video… puede tardar un par de minutos.');
    else if (j.error) promoMensaje(j.error);
    else if (!j.url) promoMensaje(j.puede_editar ? 'Aún no hay video promocional. Súbelo desde Promociones activas.' : 'Pronto habrá un video promocional aquí.');
    else $('in-promo-vacio').hidden = true;
    clearTimeout(promoEspera);
    if (j.procesando) promoEspera = setTimeout(cargarPromo, 4000);
  }
  function cargarPromo() {
    return fetch('/api/promo-video', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(pintarPromo)
      .catch(function () { promoMensaje('No se pudo cargar el video promocional.'); });
  }
  function errorDe(xhr) {
    try { return JSON.parse(xhr.responseText).detail || ''; } catch (e) { return ''; }
  }
  function subirPromo(archivo) {
    if (!archivo) return;
    if (archivo.size > 300 * 1024 * 1024) { promoMensaje('El video pesa más de 300 MB.'); return; }
    var fd = new FormData();
    fd.append('file', archivo);
    // XHR y no fetch: fetch no informa del progreso de subida.
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/promo-video');
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) promoMensaje('Subiendo el video… ' + Math.round(e.loaded / e.total * 100) + ' %');
    };
    xhr.onload = function () {
      if (xhr.status === 202 || xhr.status === 200) { cargarPromo(); return; }
      promoMensaje(errorDe(xhr) || 'No se pudo subir el video (HTTP ' + xhr.status + ').');
      $('in-promo-subir').setAttribute('aria-disabled', 'false');
    };
    xhr.onerror = function () { promoMensaje('Se cortó la subida. Inténtalo de nuevo.'); $('in-promo-subir').setAttribute('aria-disabled', 'false'); };
    $('in-promo-subir').setAttribute('aria-disabled', 'true');
    promoMensaje('Subiendo el video… 0 %');
    xhr.send(fd);
  }
  function quitarPromo() {
    if (!confirm('¿Quitar el video promocional de la página de inicio?')) return;
    fetch('/api/promo-video', { method: 'DELETE', credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .then(cargarPromo)
      .catch(function () { promoMensaje('No se pudo quitar el video.'); });
  }

  // ── Calendario de ventas: calendario del mes (fecha real) y eventos del día ──
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var HOY = new Date();
  var mesVista = new Date(HOY.getFullYear(), HOY.getMonth(), 1);
  var diaSel = new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate());
  function mismoDia(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function pintarCalendario() {
    var y = mesVista.getFullYear(), m = mesVista.getMonth();
    var primero = new Date(y, m, 1).getDay();            // 0 = domingo
    var dias = new Date(y, m + 1, 0).getDate(), diasAnt = new Date(y, m, 0).getDate();
    var celdas = [];
    for (var i = primero - 1; i >= 0; i--) celdas.push({ n: diasAnt - i, fuera: true });
    for (var n = 1; n <= dias; n++) celdas.push({ n: n });
    for (var k = 1; celdas.length % 7; k++) celdas.push({ n: k, fuera: true });
    $('in-mes').textContent = MESES_LARGOS[m].charAt(0).toUpperCase() + MESES_LARGOS[m].slice(1) + ' ' + y;
    $('in-cal').innerHTML = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(function (w) {
      return '<div style="font-size:9px;color:var(--color-neutral-500);padding:4px 0">' + w + '</div>';
    }).join('') + celdas.map(function (c) {
      var fecha = new Date(y, m, c.n), sel = !c.fuera && mismoDia(fecha, diaSel), hoy = !c.fuera && mismoDia(fecha, HOY);
      return '<button type="button"' + (c.fuera ? ' disabled' : ' data-dia="' + c.n + '"') +
        (sel ? ' aria-pressed="true"' : '') + (hoy ? ' aria-current="date"' : '') +
        ' style="border:0;background:transparent;font:inherit;font-size:11px;cursor:' + (c.fuera ? 'default' : 'pointer') +
        ';padding:5px 0;color:' + (sel ? 'var(--color-accent-2-600)' : c.fuera ? 'var(--color-neutral-400)' : 'var(--color-text)') +
        ';font-weight:' + (sel || hoy ? 700 : 400) + (hoy && !sel ? ';text-decoration:underline' : '') + '">' + c.n + '</button>';
    }).join('');
    $('in-dia').textContent = diaSel.getDate() + ' de ' + MESES_LARGOS[diaSel.getMonth()] + ' de ' + diaSel.getFullYear();
    cargarVentasDia();
  }

  // Ventas del día seleccionado (GET /api/dashboard/ventas-dia), con la hora a la que se subieron.
  var ventasPedido = 0;
  function hora12(hhmm) {                                  // '14:05' → '2:05 p. m.'
    var p = String(hhmm || '').split(':'), h = +p[0];
    if (!p[1]) return '';
    return (h % 12 || 12) + ':' + p[1] + (h < 12 ? ' a. m.' : ' p. m.');
  }
  function cargarVentasDia() {
    var f = diaSel, iso = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    var pedido = ++ventasPedido;                           // si se cambia de día rápido, gana el último
    $('in-eventos').innerHTML = '<div style="font-size:10px;color:var(--color-neutral-600)">Cargando ventas…</div>';
    fetch('/api/dashboard/ventas-dia?fecha=' + iso, { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (pedido !== ventasPedido) return;
        var vs = j.ventas || [];
        $('in-dia').textContent = f.getDate() + ' de ' + MESES_LARGOS[f.getMonth()] + ' de ' + f.getFullYear() +
          ' · ' + vs.length + (vs.length === 1 ? ' venta' : ' ventas');
        if (!vs.length) {
          $('in-eventos').innerHTML = '<div style="font-size:10px;font-style:italic;color:var(--color-neutral-600)">Sin ventas este día.</div>';
          return;
        }
        $('in-eventos').innerHTML = vs.map(function (v) {
          return '<div style="display:grid;grid-template-columns:52px 1px minmax(0,1fr);gap:var(--space-2)">' +
            '<div style="font-size:8px;line-height:1.4;color:var(--color-neutral-600)">' + esc(hora12(v.hora)) + '</div>' +
            '<div style="background:var(--color-neutral-200)"></div>' +
            '<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;min-width:0">' +
              '<div style="font-size:10px">' + esc(v.cliente) + '</div>' +
              '<span class="tag tag-accent" style="padding:0 5px;font-size:8px">' + esc(v.agente) + '</span>' +
            '</div></div>';
        }).join('');
      })
      .catch(function () {
        if (pedido === ventasPedido) $('in-eventos').innerHTML = '<div style="font-size:10px;color:var(--color-neutral-600)">No se pudieron cargar las ventas.</div>';
      });
  }
  function pintarFecha() {
    var f = HOY.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('in-fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
  }

  // ── Casos pendientes (los del Semáforo sin solventar; GET /api/casos/semaforo ya
  //    filtra por rol: el agente ve los suyos, el supervisor su team, el resto todos) ──
  var HORAS_VENCE = 144;                                 // = casos.HORAS_ROJO en el backend
  var COLOR_CASO = { verde: 'var(--color-sem-verde)', amarillo: 'var(--color-sem-amarillo)', rojo: 'var(--color-sem-rojo)', negro: 'var(--color-sem-negro)' };
  function fechaCorta(iso) {
    var f = new Date(iso);
    return isNaN(f) ? '' : f.getDate() + ' ' + MES_CORTO[f.getMonth()].toLowerCase() + ' · ' + hora12(String(f.getHours()) + ':' + String(f.getMinutes()).padStart(2, '0'));
  }
  function casosMensaje(txt) {
    $('in-casos').innerHTML = '<div style="font-size:10px;font-style:italic;color:var(--color-neutral-600)">' + esc(txt) + '</div>';
  }
  function cargarCasos() {
    fetch('/api/casos/semaforo', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var lista = (j.data || []).filter(function (c) { return c.caso_estado === 'pendiente' && !c.solventado; })
          .sort(function (a, b) { return (b.horas_transcurridas || 0) - (a.horas_transcurridas || 0); });  // más urgentes primero
        $('in-casos-total').textContent = lista.length ? '(' + fmtN(lista.length) + ')' : '';
        if (!lista.length) { casosMensaje('No hay casos pendientes. ¡Todo al día!'); return; }
        $('in-casos').innerHTML = lista.map(function (c) {      // todos: la lista hace scroll dentro de la tarjeta
          var h = Math.min(HORAS_VENCE, Math.max(0, c.horas_transcurridas || 0));
          var resta = Math.max(0, Math.round(HORAS_VENCE - h)), color = COLOR_CASO[c.color] || COLOR_CASO.verde;
          // Vencimiento del caso en hora local (vence_at llega en UTC sin zona).
          var vence = c.vence_at ? fechaCorta(c.vence_at + 'Z') : '';
          return '<a href="/residencial/semaforo.html" title="' + esc(c.caso_solventar || 'Ver en El Semáforo') + '" style="color:inherit;text-decoration:none;background:var(--color-neutral-200);border-radius:var(--radius-lg);padding:var(--space-3);display:flex;align-items:center;gap:var(--space-2);flex:none">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.nombre_cliente || 'Cliente sin nombre') + '</div>' +
              '<div style="font-size:9px;color:var(--color-neutral-700);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.agente || '—') + (vence ? ' • vence ' + esc(vence) : '') + '</div>' +
            '</div>' +
            '<svg viewBox="0 0 40 40" width="30" height="30" style="flex:none" aria-label="' + resta + ' horas para vencer">' +
              '<circle cx="20" cy="20" r="16" fill="var(--color-neutral-100)" stroke="var(--color-neutral-300)" stroke-width="3"></circle>' +
              '<circle cx="20" cy="20" r="16" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (2 * Math.PI * 16 * h / HORAS_VENCE).toFixed(2) + ' 200" transform="rotate(-90 20 20)"></circle>' +
              '<text x="20" y="23" font-size="9" text-anchor="middle" fill="var(--color-text)">' + resta + 'h</text>' +
            '</svg></a>';
        }).join('');
      })
      .catch(function () { casosMensaje('No se pudieron cargar los casos.'); });
  }

  // ── Semáforo del mes (diseño de medidor + barras) ──
  // Color de cada team por sus puntos del mes (la regla del inicio anterior). Los cortes
  // se tocan aquí; se evalúan de arriba abajo. El medidor va de 0 a GAUGE_MAX puntos.
  var SEMAFORO = [
    { color: 'verde', desde: 100.01 },
    { color: 'amarillo', desde: 50 },
    { color: 'rojo', desde: 0 },
  ];
  var GAUGE_MAX = 150;
  function colorTeam(pts) {
    for (var i = 0; i < SEMAFORO.length; i++) if (pts >= SEMAFORO[i].desde) return SEMAFORO[i].color;
    return 'rojo';
  }
  function pintarSemaforo(d) {
    // Sólo los teams de la sección de esta página (residencial/inicio.html o lineas/inicio.html).
    var seccion = location.pathname.indexOf('/lineas/') === 0 ? 'lineas' : 'residencial';
    var teams = (d.semaforo || []).filter(function (t) { return (t.seccion || 'residencial') === seccion; })
      .sort(function (a, b) { return (b.puntos || 0) - (a.puntos || 0); });
    var ventas = teams.reduce(function (a, t) { return a + (t.ventas || 0); }, 0);
    var prom = teams.length ? teams.reduce(function (a, t) { return a + (+t.puntos || 0); }, 0) / teams.length : 0;
    // Medidor: fondo, el arco hasta el promedio (con el color que le toca) y la escala.
    var LARGO = Math.PI * 65, arco = 'M 25 90 A 65 65 0 0 1 155 90';
    var marcas = [0, 25, 50, 75, 100, 125, 150];
    $('in-gauge').innerHTML =
      '<path d="' + arco + '" fill="none" stroke="var(--color-accent-2-100)" stroke-width="16"></path>' +
      '<path d="' + arco + '" fill="none" stroke="' + (teams.length ? COLOR_CASO[colorTeam(prom)] : 'transparent') + '" stroke-width="16" stroke-dasharray="' +
        (LARGO * Math.min(prom, GAUGE_MAX) / GAUGE_MAX).toFixed(1) + ' 300"></path>' +
      marcas.map(function (v) {
        var ang = Math.PI * (1 - v / GAUGE_MAX);
        return '<text x="' + (90 + 82 * Math.cos(ang)).toFixed(1) + '" y="' + (92 - 82 * Math.sin(ang)).toFixed(1) + '" font-size="6" text-anchor="middle" fill="var(--color-neutral-500)">' + v + '</text>';
      }).join('');
    $('in-gauge-valor').textContent = teams.length ? fmtN(prom, 1) : '—';
    $('in-gauge-sub').textContent = fmtN(teams.length) + (teams.length === 1 ? ' team · ' : ' teams · ') + fmtN(ventas) + ' ventas';
    // Filas: nombre del team, ventas y puntos, y su barra (0 → puntos) sobre la escala del medidor.
    var tope = Math.max(GAUGE_MAX, techo(Math.max.apply(null, teams.map(function (t) { return +t.puntos || 0; }).concat([1]))));
    var grid = 'display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--space-2)';
    $('in-satis').innerHTML = teams.length ? teams.map(function (t) {
      var pts = +t.puntos || 0;
      return '<div style="' + grid + ';align-items:center" title="' + esc(t.team) + ': ' + fmtN(pts, 1) + ' pts">' +
        '<div style="min-width:0"><div style="font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.team) + '</div>' +
          '<div style="font-size:7px;color:var(--color-neutral-500)">' + fmtN(t.ventas) + ' ventas · ' + fmtN(pts, 1) + ' pts</div></div>' +
        '<div style="position:relative;height:6px">' +
          '<div style="position:absolute;top:2px;left:0;right:0;height:1px;background:var(--color-neutral-200)"></div>' +
          '<div style="position:absolute;top:0;bottom:0;left:0;width:' + (pts / tope * 100).toFixed(1) + '%;background:' + COLOR_CASO[colorTeam(pts)] + ';border-radius:1px"></div>' +
        '</div></div>';
    }).join('') : '<div style="font-size:10px;font-style:italic;color:var(--color-neutral-600)">Sin ventas de equipo este mes aún.</div>';
    $('in-satis-eje').innerHTML = teams.length
      ? '<div style="' + grid + '"><span></span><div style="display:flex;justify-content:space-between;font-size:6px;color:var(--color-neutral-500)">' +
          [0, 0.25, 0.5, 0.75, 1].map(function (f) { return '<span>' + fmtN(tope * f) + '</span>'; }).join('') + '</div></div>'
      : '';
  }

  // ── Top productos (diseño de dona + leyenda): los 4 primeros y el resto en «Otros» ──
  var TOP_COLORES = ['var(--color-accent-2-500)', 'var(--color-accent-500)', 'var(--color-accent-300)', 'var(--color-accent-2-200)', 'var(--color-accent-100)'];
  var TOP_GROSOR = [22, 14, 14, 14, 14];
  function pintarTopProductos(d) {
    var prods = d.top_productos || [];
    $('in-top-mes').textContent = d.hoy ? MES_LARGO[d.hoy.mes - 1].charAt(0).toUpperCase() + MES_LARGO[d.hoy.mes - 1].slice(1) : 'Este mes';
    var total = prods.reduce(function (a, p) { return a + (p.count || 0); }, 0);
    $('in-donut-total').textContent = fmtN(total);
    if (!total) {
      $('in-donut').innerHTML = '<circle cx="90" cy="90" r="74" fill="none" stroke="var(--color-neutral-200)" stroke-width="14"></circle>';
      $('in-donut-ley').innerHTML = '<div style="font-size:10px;font-style:italic;color:var(--color-neutral-600)">Sin productos vendidos este mes aún.</div>';
      return;
    }
    var filas = prods.slice(0, 4).map(function (p) { return [p.servicio, p.count]; });
    var resto = prods.slice(4).reduce(function (a, p) { return a + (p.count || 0); }, 0);
    if (resto) filas.push(['Otros (' + (prods.length - 4) + ')', resto]);
    var C = 2 * Math.PI * 74, acc = 0;
    $('in-donut').innerHTML = filas.map(function (f, i) {
      var parte = C * f[1] / total, len = Math.max(0, parte - (filas.length > 1 ? 4 : 0));
      var html = '<circle cx="90" cy="90" r="74" fill="none" stroke="' + TOP_COLORES[i] + '" stroke-width="' + TOP_GROSOR[i] + '" stroke-dasharray="' + len.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"></circle>';
      acc += parte;
      return html;
    }).join('');
    $('in-donut-ley').innerHTML = filas.map(function (f, i) {
      return '<div style="display:flex;align-items:center;gap:6px;font-size:10px">' +
        '<span style="flex:none;width:5px;height:5px;background:' + TOP_COLORES[i] + '"></span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f[0]) + '</span>' +
        '<span style="flex:none;color:var(--color-neutral-600);font-size:8px">(' + Math.round(f[1] / total * 100) + '%)</span>' +
        '<span style="margin-left:auto">' + fmtN(f[1]) + '</span></div>';
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    pintarStats(null);
    cargarDatos().then(function (d) {
      pintarStats(d);
      pintarMensual(d);
      pintarDiario(d);
      pintarSemaforo(d);
      pintarTopProductos(d);
    }).catch(function () {
      $('in-kpi-valor').textContent = 'Sin datos';
      $('in-satis').innerHTML = $('in-donut-ley').innerHTML = '<div style="font-size:10px;color:var(--color-neutral-600)">No se pudieron cargar los datos.</div>';
      $('in-diario-res').textContent = 'No se pudieron cargar las ventas.';
    });
    pintarFecha();
    cargarPromo();
    pintarCalendario();
    cargarCasos();

    $('in-kpi').addEventListener('mousemove', moverKpi);
    $('in-promo-archivo').addEventListener('change', function () { subirPromo(this.files[0]); this.value = ''; });
    $('in-promo-quitar').addEventListener('click', quitarPromo);
    $('in-cal').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dia]');
      if (b) { diaSel = new Date(mesVista.getFullYear(), mesVista.getMonth(), +b.dataset.dia); pintarCalendario(); }
    });
    $('in-mes-ant').addEventListener('click', function () { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() - 1, 1); pintarCalendario(); });
    $('in-mes-sig').addEventListener('click', function () { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() + 1, 1); pintarCalendario(); });
    if (window.__sesion) window.__sesion.then(pintarUsuario);
  });
})();
