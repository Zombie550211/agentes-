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

  // ── Barra superior: el menú lo pinta js/layout/topnav.js ──
  function pintarUsuario(s) {
    var u = (s && s.user) || {};                       // /api/auth/verify-server → { user: {...} }
    var nombre = String(u.name || u.username || '').trim();
    if (!nombre) return;
    $('in-avatar').textContent = nombre.charAt(0).toUpperCase();
    $('in-avatar').title = nombre;
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
  function tarjeta(icon, valor, label, chico) {
    return '<div style="position:relative;overflow:hidden;background:var(--color-neutral-100);border-radius:var(--radius-lg);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-4)">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<span style="width:30px;height:30px;border-radius:var(--radius-lg);background:var(--color-accent-2-500);color:var(--color-neutral-100);display:grid;place-items:center;font-size:17px"><i class="ph-duotone ' + icon + '"></i></span>' +
        '<i class="ph-duotone ph-dots-three" style="font-size:16px;color:var(--color-neutral-600)"></i>' +
      '</div>' +
      '<div style="position:relative;z-index:1;min-width:0"><div style="font-size:' + (chico ? '16px' : '22px') + ';font-weight:700;line-height:1.1;overflow-wrap:anywhere">' + esc(valor) + '</div>' +
      '<div style="font-size:10px;color:var(--color-neutral-700);margin-top:4px">' + esc(label) + '</div></div>' +
      '<div style="position:absolute;right:-18px;bottom:14px;width:56px;height:44px;border-radius:50%;background:var(--color-accent-100)"></div>' +
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

  // ── Promoción destacada (la que sale en grande en Promociones activas) ──
  function monto(n) { n = Number(n) || 0; return '$' + (n % 1 ? n.toFixed(2) : String(n)); }
  function pintarPromo() {
    fetch('/api/promociones', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var lista = Array.isArray(j.data) ? j.data : [];
        var p = lista.find(function (x) { return x.destacada; }) || lista[0];
        if (!p) { $('in-promo-titulo').textContent = 'No hay promociones activas'; return; }
        $('in-promo-titulo').textContent = p.titulo;
        $('in-promo-montos').innerHTML = (p.items || []).map(function (it) {
          return '<div style="display:flex;align-items:baseline;gap:6px">' +
            '<span style="font-size:18px;font-weight:700;color:var(--color-accent-2-600);line-height:1.2">' + esc(monto(it.amount)) + '</span>' +
            '<span style="font-size:10px;color:var(--color-neutral-700)">' + esc(it.label || '') + '</span></div>';
        }).join('');
      })
      .catch(function () { $('in-promo-titulo').textContent = 'No se pudo cargar la promoción'; });
  }

  // ── Agenda: calendario del mes (fecha real) y eventos del día ──
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var HOY = new Date();
  var mesVista = new Date(HOY.getFullYear(), HOY.getMonth(), 1);
  var diaSel = new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate());
  var EVENTOS = [
    ['9:00 a. m.', '9:30 a. m.', 'Reunión de la mañana', 'Todos los equipos'],
    ['10:00 a. m.', '11:00 a. m.', 'Revisión de proyecto', 'Desarrollo de producto'],
    ['11:30 a. m.', '12:30 p. m.', 'Sesión de estrategia de marketing', 'Marketing'],
    ['12:45 p. m.', '1:30 p. m.', 'Almuerzo de aprendizaje', 'Todos los equipos'],
    ['1:30 p. m.', '2:30 p. m.', 'Grupo de discusión', 'Desarrollo de producto'],
    ['3:00 p. m.', '4:00 p. m.', 'Capacitación de cumplimiento', 'Recursos Humanos'],
  ];
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
    var d = diaSel.getDate(), sh = (d * 7) % 6;
    var evs = mismoDia(diaSel, HOY) ? EVENTOS : EVENTOS.slice(sh).concat(EVENTOS.slice(0, sh)).slice(0, 3 + (d % 4));
    $('in-eventos').innerHTML = evs.map(function (ev) {
      var tag = ev[3] === 'Todos los equipos' || ev[3] === 'Recursos Humanos' ? 'tag-accent' : 'tag-accent-2';
      return '<div style="display:grid;grid-template-columns:52px 1px minmax(0,1fr);gap:var(--space-2)">' +
        '<div style="font-size:8px;line-height:1.4;color:var(--color-neutral-600)">' + esc(ev[0]) + ' a<br>' + esc(ev[1]) + '</div>' +
        '<div style="background:var(--color-neutral-200)"></div>' +
        '<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">' +
          '<div style="font-size:10px">' + esc(ev[2]) + '</div>' +
          '<span class="tag ' + tag + '" style="padding:0 5px;font-size:8px">' + esc(ev[3]) + '</span>' +
        '</div></div>';
    }).join('');
  }
  function pintarFecha() {
    var f = HOY.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('in-fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
  }

  // ── Tareas ──
  var TAREAS = [
    ['Actualizar el manual del empleado', 'Políticas internas', '15 jun 2027', 45],
    ['Cerrar la revisión del presupuesto trimestral', 'Análisis financiero', '30 may 2027', 68],
    ['Lanzar la nueva línea de producto', 'Lanzamiento', '1 jul 2027', 0],
    ['Mejorar la infraestructura de servidores', 'Infraestructura técnica', '20 ago 2027', 12],
  ];
  function pintarTareas() {
    $('in-tareas').insertAdjacentHTML('beforeend', TAREAS.map(function (t) {
      return '<div style="background:var(--color-neutral-200);border-radius:var(--radius-lg);padding:var(--space-3);display:flex;align-items:center;gap:var(--space-2)">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:11px;font-weight:600">' + esc(t[0]) + '</div>' +
          '<div style="font-size:9px;color:var(--color-neutral-700);margin-top:3px">' + esc(t[1]) + ' • ' + esc(t[2]) + '</div>' +
        '</div>' +
        '<svg viewBox="0 0 40 40" width="28" height="28">' +
          '<circle cx="20" cy="20" r="16" fill="var(--color-neutral-100)" stroke="var(--color-accent-2-100)" stroke-width="3"></circle>' +
          '<circle cx="20" cy="20" r="16" fill="none" stroke="var(--color-accent-2-500)" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (2 * Math.PI * 16 * t[3] / 100) + ' 200" transform="rotate(-90 20 20)"></circle>' +
          '<text x="20" y="23" font-size="9" text-anchor="middle" fill="var(--color-accent-2-700)">' + t[3] + '%</text>' +
        '</svg></div>';
    }).join(''));
  }

  // ── Satisfacción del personal ──
  var SATIS = [['Ambiente laboral', 70, 85], ['Salario y beneficios', 65, 75], ['Desarrollo profesional', 65, 80], ['Equilibrio vida-trabajo', 55, 70], ['Gestión y liderazgo', 50, 65]];
  function pintarSatisfaccion() {
    $('in-gauge').insertAdjacentHTML('beforeend', [0, 20, 40, 60, 80, 100].map(function (v) {
      var a = Math.PI * (1 - v / 100);
      return '<text x="' + (90 + 82 * Math.cos(a)) + '" y="' + (92 - 82 * Math.sin(a)) + '" font-size="6" text-anchor="middle" fill="var(--color-neutral-500)">' + v + '</text>';
    }).join(''));
    $('in-satis').innerHTML = SATIS.map(function (s) {
      return '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--space-2);align-items:center">' +
        '<div><div style="font-size:9px">' + esc(s[0]) + '</div><div style="font-size:7px;color:var(--color-neutral-500)">' + s[1] + '-' + s[2] + '</div></div>' +
        '<div style="position:relative;height:6px">' +
          '<div style="position:absolute;top:2px;left:0;right:0;height:1px;background:var(--color-neutral-200)"></div>' +
          '<div style="position:absolute;top:0;bottom:0;left:' + s[1] + '%;width:' + (s[2] - s[1]) + '%;background:var(--color-accent-300);border-radius:1px"></div>' +
        '</div></div>';
    }).join('') +
      '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--space-2)"><span></span><div style="display:flex;justify-content:space-between;font-size:6px;color:var(--color-neutral-500)"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div></div>';
  }

  // ── Situación laboral (dona) ──
  var DONA = [['Permanente', 584, 47, 'var(--color-accent-2-500)', 22], ['Por contrato', 323, 26, 'var(--color-accent-2-100)', 14], ['En prueba', 211, 17, 'var(--color-accent-300)', 14], ['Pasantía', 124, 10, 'var(--color-accent-100)', 14]];
  function pintarDona() {
    var C = 2 * Math.PI * 74, acc = 0;
    $('in-donut').innerHTML = DONA.map(function (d) {
      var len = C * d[2] / 100 - 4;
      var html = '<circle cx="90" cy="90" r="74" fill="none" stroke="' + d[3] + '" stroke-width="' + d[4] + '" stroke-dasharray="' + len + ' ' + C + '" stroke-dashoffset="' + (-acc) + '"></circle>';
      acc += C * d[2] / 100;
      return html;
    }).join('');
    $('in-donut-ley').innerHTML = DONA.map(function (d) {
      return '<div style="display:flex;align-items:center;gap:6px;font-size:10px">' +
        '<span style="width:5px;height:5px;background:' + d[3] + '"></span><span>' + esc(d[0]) + '</span>' +
        '<span style="color:var(--color-neutral-600);font-size:8px">(' + d[2] + '%)</span>' +
        '<span style="margin-left:auto">' + d[1] + '</span></div>';
    }).join('');
  }

  // ── Empleados (tabla con búsqueda y filtro) ──
  var EMPS = [
    ['John Doe', 'john.doe@company.com', 'Desarrollador de software sénior', 'Sénior', 'TI', 'Presente'],
    ['Sarah Smith', 'sarah.smith@company.com', 'Gerente de marketing', 'Gerente', 'Marketing', 'En remoto'],
    ['Angela Brown', 'angela.brown@company.com', 'Especialista de RR. HH.', 'Intermedio', 'Recursos Humanos', 'Presente'],
    ['Clara Jasmine', 'clara.jasmine@company.com', 'Analista financiera', 'Inicial', 'Finanzas', 'De permiso'],
    ['Alex Gray', 'alex.gray@company.com', 'Director de operaciones', 'Directivo', 'Operaciones', 'Presente'],
  ];
  var NIVEL = { 'Sénior': 'var(--color-accent-2-200)', Gerente: 'var(--color-accent-2-500)', Intermedio: 'var(--color-neutral-300)', Inicial: 'var(--color-accent-300)', Directivo: 'var(--color-neutral-800)' };
  var TODOS = 'Todos los departamentos';
  var DEPTS = [TODOS, 'TI', 'Marketing', 'Recursos Humanos', 'Finanzas', 'Operaciones'];
  function pintarCabeceraEmpleados() {
    $('in-cols').innerHTML = ['Nombre', 'Correo', 'Puesto', 'Nivel', 'Departamento', 'Estado'].map(function (c) {
      return '<th style="font-weight:400;font-size:9px;padding:7px 10px">' + c + ' <i class="ph-duotone ph-caret-up-down"></i></th>';
    }).join('');
    $('in-dept').innerHTML = DEPTS.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('');
  }
  function pintarEmpleados() {
    var q = $('in-q').value.trim().toLowerCase(), dept = $('in-dept').value;
    var lista = EMPS.filter(function (e) {
      return (dept === TODOS || e[4] === dept) && (!q || e.join(' ').toLowerCase().indexOf(q) >= 0);
    });
    $('in-emps').innerHTML = lista.map(function (e) {
      var ini = e[0].split(' ').map(function (w) { return w.charAt(0); }).join('');
      return '<tr style="border-bottom:1px solid var(--color-neutral-200)">' +
        '<td style="padding:10px"><div style="display:flex;align-items:center;gap:8px"><span style="width:22px;height:22px;border-radius:50%;background:var(--color-accent-200);color:var(--color-accent-800);display:grid;place-items:center;font-size:8px;font-weight:700">' + esc(ini) + '</span>' + esc(e[0]) + '</div></td>' +
        '<td style="padding:10px">' + esc(e[1]) + '</td>' +
        '<td style="padding:10px">' + esc(e[2]) + '</td>' +
        '<td style="padding:10px"><span style="display:flex;align-items:center;gap:6px"><span style="width:5px;height:5px;border-radius:50%;background:' + NIVEL[e[3]] + '"></span>' + esc(e[3]) + '</span></td>' +
        '<td style="padding:10px">' + esc(e[4]) + '</td>' +
        '<td style="padding:10px"><span class="tag ' + (e[5] === 'Presente' ? 'tag-accent' : 'tag-accent-2') + '" style="font-size:8px;padding:1px 8px;border-radius:999px">' + esc(e[5]) + '</span></td>' +
      '</tr>';
    }).join('');
    $('in-vacio').hidden = lista.length > 0;
  }

  // ── Actividad reciente ──
  var ACTIVIDAD = [
    ['AB', 'Angela Brown', 'subió la política de teletrabajo revisada', '02:15 p. m.'],
    ['RH', 'Equipo de RR. HH.', 'completó la incorporación de un empleado nuevo', '09:30 a. m.'],
    ['AL', 'Andrew Lee', 'programó una evaluación de desempeño', '11:00 a. m.'],
    ['DF', 'Departamento de Finanzas', 'procesó la nómina del mes', '08:00 a. m.'],
    ['JM', 'Jessica Morales', 'aprobó el permiso de Bob White', '03:30 p. m.'],
  ];
  function pintarActividad() {
    $('in-actividad').insertAdjacentHTML('beforeend', ACTIVIDAD.map(function (a) {
      return '<div style="display:flex;gap:var(--space-2)">' +
        '<span style="flex:none;width:22px;height:22px;border-radius:50%;background:var(--color-accent-200);color:var(--color-accent-800);display:grid;place-items:center;font-size:8px;font-weight:700">' + esc(a[0]) + '</span>' +
        '<div><div style="font-size:9px;line-height:1.4;color:var(--color-neutral-700)"><strong style="color:var(--color-text)">' + esc(a[1]) + '</strong> ' + esc(a[2]) + '</div>' +
        '<div style="font-size:7px;color:var(--color-neutral-500);margin-top:3px">' + esc(a[3]) + '</div></div></div>';
    }).join(''));
  }

  document.addEventListener('DOMContentLoaded', function () {
    pintarStats(null);
    cargarDatos().then(function (d) {
      pintarStats(d);
      pintarMensual(d);
      pintarDiario(d);
    }).catch(function () {
      $('in-kpi-valor').textContent = 'Sin datos';
      $('in-diario-res').textContent = 'No se pudieron cargar las ventas.';
    });
    pintarFecha();
    pintarPromo();
    pintarCalendario();
    pintarTareas();
    pintarSatisfaccion();
    pintarDona();
    pintarCabeceraEmpleados();
    pintarEmpleados();
    pintarActividad();

    $('in-kpi').addEventListener('mousemove', moverKpi);
    $('in-cal').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dia]');
      if (b) { diaSel = new Date(mesVista.getFullYear(), mesVista.getMonth(), +b.dataset.dia); pintarCalendario(); }
    });
    $('in-mes-ant').addEventListener('click', function () { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() - 1, 1); pintarCalendario(); });
    $('in-mes-sig').addEventListener('click', function () { mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() + 1, 1); pintarCalendario(); });
    $('in-q').addEventListener('input', pintarEmpleados);
    $('in-dept').addEventListener('change', pintarEmpleados);
    if (window.__sesion) window.__sesion.then(pintarUsuario);
  });
})();
