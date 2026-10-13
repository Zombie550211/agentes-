/**
 * Inicio del portal de facturación (portal/inicio.html) — resumen general del mes.
 *
 * Lee lo mismo que la página de Facturación y reparte con sus mismas reglas
 * (residencial/facturacion.html):
 *   · Residencial = Alexis + Alexis 2 + Tito, y Garay desde octubre de 2026.
 *   · Líneas móviles = Tito Líneas (+ Garay hasta septiembre de 2026) + la tabla de
 *     Líneas (Garay / Connecting).
 * campos de /api/facturacion: [0,1] Alexis monto/ventas · [3,4] Garay · [6,7] Tito Líneas ·
 *   [9,10] Tito · [15] puntos · [17,18] Alexis 2.
 * campos de /api/facturacion-lineas-pub: [0,1,2] Garay ventas/líneas/monto ·
 *   [3,4,5] Connecting ventas/líneas/monto.
 */
(function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { return parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0; };
  var dinero = function (n) {
    return '$' + (Math.trunc((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var entero = function (n) { return Math.round(n || 0).toLocaleString('en-US'); };
  var costo = function (m, v) { return v > 0 ? m / v : 0; };
  var json = function (url) { return fetch(url, { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }); };
  function garayEsResidencial(mes, ano) { return ano * 12 + mes >= 2026 * 12 + 10; }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) n.append(arguments[i]);
    return n;
  }

  // Lista de días: «12 y 13 oct», «3, 7 y 12 oct».
  function listaDias(dias, mes) {
    if (dias.length === 1) return dias[0] + ' ' + CORTOS[mes - 1];
    return dias.slice(0, -1).join(', ') + ' y ' + dias[dias.length - 1] + ' ' + CORTOS[mes - 1];
  }

  // ── Selector de mes: los últimos 12 meses ──
  var hoy = new Date();
  (function () {
    var sel = $('pt-mes');
    for (var i = 0; i < 12; i++) {
      var d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      sel.append(el('option', { value: d.getFullYear() + '-' + (d.getMonth() + 1), text: MESES[d.getMonth()] + ' ' + d.getFullYear() }));
    }
    sel.addEventListener('change', cargar);
  })();

  window.__sesion.then(function (s) {
    if (s.user) $('pt-hola').textContent = 'Hola, ' + s.user.name.split(' ')[0];
  });

  async function cargar() {
    var p = $('pt-mes').value.split('-'), ano = +p[0], mes = +p[1], mm = String(mes).padStart(2, '0');
    var r = await Promise.all([json('/api/facturacion/' + ano + '/' + mm), json('/api/facturacion-lineas-pub/' + ano + '/' + mm)]);
    var garayRes = garayEsResidencial(mes, ano);
    var nombreGaray = garayRes ? 'Garay Residencial' : 'Garay Líneas';

    // Por día (clave = número de día)
    var dias = {};
    function dia(fecha) {
      var d = parseInt(String(fecha).split('/')[0], 10);
      return dias[d] || (dias[d] = { resM: 0, resV: 0, linM: 0, linV: 0, lineas: 0 });
    }
    var pub = { 'Alexis': 0, 'Alexis 2': 0, 'Tito': 0, 'Tito Líneas': 0, 'Líneas Garay': 0, 'Líneas Connecting': 0 };
    pub[nombreGaray] = 0;
    var puntos = 0;

    ((r[0] && r[0].data) || []).forEach(function (f) {
      var c = f.campos || [], d = dia(f.fecha);
      d.resM += num(c[0]) + num(c[17]) + num(c[9]);
      d.resV += num(c[1]) + num(c[18]) + num(c[10]);
      d.linM += num(c[6]);
      d.linV += num(c[7]);
      if (garayRes) { d.resM += num(c[3]); d.resV += num(c[4]); } else { d.linM += num(c[3]); d.linV += num(c[4]); }
      pub['Alexis'] += num(c[0]); pub['Alexis 2'] += num(c[17]); pub['Tito'] += num(c[9]);
      pub['Tito Líneas'] += num(c[6]); pub[nombreGaray] += num(c[3]);
      puntos += num(c[15]);
    });
    ((r[1] && r[1].data) || []).forEach(function (f) {
      var c = f.campos || [], d = dia(f.fecha);
      d.linM += num(c[2]) + num(c[5]);
      d.linV += num(c[0]) + num(c[3]);
      d.lineas += num(c[1]) + num(c[4]);
      pub['Líneas Garay'] += num(c[2]); pub['Líneas Connecting'] += num(c[5]);
    });

    var conDatos = Object.keys(dias).map(Number).filter(function (n) {
      var d = dias[n];
      return d.resM || d.resV || d.linM || d.linV;
    }).sort(function (a, b) { return a - b; });
    var T = { resM: 0, resV: 0, linM: 0, linV: 0, lineas: 0 };
    conDatos.forEach(function (n) { Object.keys(T).forEach(function (k) { T[k] += dias[n][k]; }); });
    var inversion = T.resM + T.linM, ventas = T.resV + T.linV;

    // Encabezado y KPIs
    $('pt-rango').textContent = conDatos.length
      ? 'Datos registrados: ' + String(conDatos[0]).padStart(2, '0') + ' – ' + conDatos[conDatos.length - 1] + ' ' + CORTOS[mes - 1]
      : 'Sin datos registrados en el mes';
    $('k-inversion').textContent = dinero(inversion);
    $('k-ventas').textContent = entero(ventas);
    $('k-costo').textContent = dinero(costo(inversion, ventas));
    $('k-dias').textContent = String(conDatos.length);

    // Resumen por servicio
    $('s-res-ventas').textContent = entero(T.resV) + ' ventas';
    $('s-res-inv').textContent = dinero(T.resM);
    $('s-res-costo').innerHTML = '';
    $('s-res-costo').append(dinero(costo(T.resM, T.resV)), el('small', { text: ' por venta' }));
    $('s-lin-ventas').textContent = entero(T.linV) + ' ventas';
    $('s-lin-inv').textContent = dinero(T.linM);
    $('s-lin-costo').innerHTML = '';
    $('s-lin-costo').append(dinero(costo(T.linM, T.linV)), el('small', { text: ' por venta' }));
    var pRes = inversion > 0 ? Math.round(T.resM / inversion * 100) : 0, pLin = inversion > 0 ? 100 - pRes : 0;
    $('c-res').style.width = pRes + '%'; $('c-res').textContent = pRes >= 8 ? pRes + '%' : '';
    $('c-lin').style.width = pLin + '%'; $('c-lin').textContent = pLin >= 8 ? pLin + '%' : '';
    $('c-barra').setAttribute('aria-label', 'Residencial ' + pRes + '%, Líneas móviles ' + pLin + '%');
    $('c-res-lbl').textContent = 'Residencial ' + pRes + '%';
    $('c-lin-lbl').textContent = 'Líneas móviles ' + pLin + '%';

    // Inversión por publicista
    var lista = Object.keys(pub).map(function (k) { return { nombre: k, monto: pub[k] }; })
      .filter(function (x) { return x.monto > 0; }).sort(function (a, b) { return b.monto - a.monto; });
    var suma = lista.reduce(function (s, x) { return s + x.monto; }, 0) || 1;   // la barra = parte del total
    $('r-publicistas').replaceChildren.apply($('r-publicistas'), lista.length ? lista.map(function (x, i) {
      var barra = el('span', { class: 'pt-rank-barra' }, el('i', { style: 'width:' + Math.max(2, x.monto / suma * 100) + '%' }));
      return el('li', {}, el('span', { class: 'pt-rank-n', text: String(i + 1) }),
        el('div', { class: 'pt-rank-main' }, el('b', { text: x.nombre }), barra),
        el('span', { class: 'pt-rank-val', text: dinero(x.monto) }));
    }) : [el('li', { class: 'pt-vacio', text: 'Sin inversión registrada este mes' })]);

    // Último día registrado
    var ultimo = conDatos[conDatos.length - 1];
    $('t-ultimo').textContent = 'Último día registrado' + (ultimo ? ' · ' + ultimo + ' ' + CORTOS[mes - 1] : '');
    var du = ultimo ? dias[ultimo] : { resM: 0, resV: 0, linM: 0, linV: 0 };
    $('u-inv').textContent = dinero(du.resM + du.linM);
    $('u-ventas').textContent = entero(du.resV + du.linV);
    $('u-costo').textContent = dinero(costo(du.resM + du.linM, du.resV + du.linV));

    // Revisión de datos
    var esteMes = ano === hoy.getFullYear() && mes === hoy.getMonth() + 1;
    var hasta = esteMes ? hoy.getDate() : new Date(ano, mes, 0).getDate();
    var faltan = [];
    for (var n = 1; n <= hasta; n++) if (conDatos.indexOf(n) < 0) faltan.push(n);
    var avisos = [];
    if (faltan.length) avisos.push([faltan.length > 6 ? faltan.length + ' días' : listaDias(faltan, mes), ': sin registros']);
    if (ventas > 0 && !puntos) avisos.push(['CPA por puntos', ': sin datos']);
    if (T.linV > 0 && !T.lineas) avisos.push(['Líneas móviles', ': conteo de líneas en 0']);
    $('v-lista').replaceChildren.apply($('v-lista'), avisos.length ? avisos.map(function (a) {
      return el('li', {}, el('i', { class: 'ph ph-warning-circle', 'aria-hidden': 'true' }), el('span', {}, el('b', { text: a[0] }), a[1]));
    }) : [el('li', { class: 'pt-ok' }, el('i', { class: 'ph ph-check-circle', 'aria-hidden': 'true' }), el('span', { text: 'Todo en orden: no hay nada por revisar.' }))]);

    $('a-exportar').href = '/api/recibos-google/exportar?desde=' + ano + '-' + mm + '-01&hasta=' + ano + '-' + mm + '-' + String(new Date(ano, mes, 0).getDate()).padStart(2, '0');
    var a = new Date();
    $('pt-actualizado').textContent = 'Última actualización: ' + a.toLocaleDateString('es-SV') + ' ' +
      a.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }

  cargar();
})();
