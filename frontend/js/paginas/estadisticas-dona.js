/* estadisticas-dona.js — Gráficas de pastel (donas) del «Desglose por servicio» en Estadísticas
 * (residencial/estadisticas.html). Vuelve la dona que había antes del rediseño del 20-nov-2026,
 * junto a la tabla día por día (estadisticas-servicios.js), que se mantiene.
 *
 * Dos donas del mismo periodo (pestañas Mes / Hoy):
 *  - Por servicio: top 5 + «Otros»; la lista al lado va en orden alfabético, una columna.
 *  - Por mercado: ICON vs BAMO (y «Sin mercado» si alguna venta no lo tiene).
 * El total del centro coincide con Ventas (mismas reglas: sin canceladas, repro ni excluidas).
 * Se refresca solo cuando cambian ventas (CRMRealtime 'residencial').
 * API: CRM_PYTHON/routers/estadisticas.py → GET /api/estadisticas/servicios (la misma de la tabla).
 */
(function () {
  'use strict';

  var TOP = 5;
  // Tonos del azul de marca (del más fuerte al más claro); el gris es siempre «Otros».
  var PAL = ['#005f82', '#2f86a8', '#5fa9c6', '#93c6db', '#c3e0ec'];
  var GRIS = '#a3afb7';
  var MERCADOS = [['icon', 'ICON', '#005f82'], ['bamo', 'BAMO', '#5fa9c6'], ['otro', 'Sin mercado', GRIS]];

  var $ = function (id) { return document.getElementById(id); };
  var periodo = 'mes';   // 'mes' | 'hoy'
  var datos = null;
  var graficas = {};     // id del canvas → Chart
  var pidiendo = 0;

  function esc(s) { return window.ESTeam ? window.ESTeam.esc(s) : String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function cargar() {
    var yo = ++pidiendo;
    return fetch('/api/estadisticas/servicios', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { if (yo === pidiendo) { datos = d; pintar(); } })
      .catch(function () {
        if (yo !== pidiendo) return;
        var msg = '<div class="es-estado">No se pudo cargar la gráfica. Recarga la página.</div>';
        $('es-dona-leg').innerHTML = msg;
        $('es-dona-merc-leg').innerHTML = '';
      });
  }

  // Ventas del periodo elegido por servicio (todos los mercados) y por mercado.
  function contar() {
    var hoyDia = String(+datos.hoy.slice(8, 10));
    var porSvc = {}, porMerc = { icon: 0, bamo: 0, otro: 0 };
    datos.servicios.forEach(function (s) {
      var n = 0;
      Object.keys(s.dias).forEach(function (dia) {
        if (periodo === 'hoy' && dia !== hoyDia) return;
        var c = s.dias[dia];
        porMerc.icon += c.icon || 0; porMerc.bamo += c.bamo || 0; porMerc.otro += c.otro || 0;
        n += (c.icon || 0) + (c.bamo || 0) + (c.otro || 0);
      });
      if (n > 0) porSvc[s.servicio] = n;
    });
    return { porSvc: porSvc, porMerc: porMerc };
  }

  function pct(n, total) { return total > 0 ? (n / total * 100).toFixed(1) : '0.0'; }
  function fila(nombre, color, n, total) {
    return '<div class="es-leg-row"><span class="es-leg-dot" style="background:' + color + '"></span>' +
      '<span class="es-leg-nom" title="' + esc(nombre) + '">' + esc(nombre) + '</span>' +
      '<span class="es-leg-n">' + n + '</span>' +
      '<span class="es-leg-p">' + pct(n, total) + '%</span></div>';
  }
  function vacio() {
    return '<div class="es-vacio">' + (periodo === 'hoy' ? 'Sin ventas hoy todavía.' : 'Sin ventas este mes todavía.') + '</div>';
  }

  function pintar() {
    var c = contar(), porSvc = c.porSvc, porMerc = c.porMerc;
    var nombres = Object.keys(porSvc).sort(function (a, b) { return (porSvc[b] - porSvc[a]) || a.localeCompare(b); });
    var total = nombres.reduce(function (t, k) { return t + porSvc[k]; }, 0);

    var f = new Date(datos.hoy + 'T12:00:00');
    $('es-dona-sub').textContent = periodo === 'hoy'
      ? 'Ventas de hoy (' + f.toLocaleDateString('es-SV', { day: 'numeric', month: 'long' }) + ')'
      : 'Ventas del mes · ' + f.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });

    // ── Por servicio: top 5 + Otros ──
    var top = nombres.slice(0, TOP);
    var otros = nombres.slice(TOP).reduce(function (t, k) { return t + porSvc[k]; }, 0);
    var etiquetas = top.slice(), valores = top.map(function (k) { return porSvc[k]; });
    var colores = top.map(function (_, i) { return PAL[i]; });
    if (otros > 0) { etiquetas.push('Otros'); valores.push(otros); colores.push(GRIS); }
    $('es-dona-total').textContent = total;
    dibujar('es-dona-canvas', etiquetas, valores, colores, total);

    // Lista en orden alfabético; el color sigue al servicio (el top 5 conserva su azul).
    var colorDe = {};
    top.forEach(function (k, i) { colorDe[k] = PAL[i]; });
    var alfabetico = nombres.slice().sort(function (a, b) { return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true }); });
    $('es-dona-leg').innerHTML = alfabetico.length
      ? alfabetico.map(function (k) { return fila(k, colorDe[k] || GRIS, porSvc[k], total); }).join('')
      : vacio();

    // ── Por mercado: ICON vs BAMO (Sin mercado solo si hay) ──
    var merc = MERCADOS.filter(function (m) { return m[0] !== 'otro' || porMerc.otro > 0; });
    $('es-dona-merc-total').textContent = total;
    dibujar('es-dona-merc-canvas',
      merc.map(function (m) { return m[1]; }),
      merc.map(function (m) { return porMerc[m[0]]; }),
      merc.map(function (m) { return m[2]; }), total);
    $('es-dona-merc-leg').innerHTML = total
      ? merc.map(function (m) { return fila(m[1], m[2], porMerc[m[0]], total); }).join('')
      : vacio();

    $('es-dona-estado').textContent = nombres.length + (nombres.length === 1 ? ' servicio' : ' servicios') + ' · actualizado ' +
      new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }

  function dibujar(idCanvas, etiquetas, valores, colores, total) {
    var lienzo = $(idCanvas);
    if (!lienzo || !window.Chart) return;
    var sinDatos = total === 0;
    var data = {
      labels: sinDatos ? ['Sin ventas'] : etiquetas,
      datasets: [{ data: sinDatos ? [1] : valores, backgroundColor: sinDatos ? ['#edf1f4'] : colores,
                   borderWidth: 2, borderColor: '#fff', hoverBorderWidth: 0 }]
    };
    var g = graficas[idCanvas];
    if (g) { g.data = data; g.options.plugins.tooltip.enabled = !sinDatos; g.update(); return; }
    graficas[idCanvas] = new Chart(lienzo, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true, maintainAspectRatio: true, cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !sinDatos,
            backgroundColor: '#fff', titleColor: '#16232c', bodyColor: '#16232c',
            borderColor: '#e2e8ec', borderWidth: 1, cornerRadius: 4, padding: 10,
            titleFont: { family: 'IBM Plex Sans', size: 12, weight: '600' },
            bodyFont: { family: 'IBM Plex Sans', size: 12 },
            callbacks: {
              label: function (c) {
                var t = c.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                return ' ' + c.label + ': ' + c.raw + ' (' + pct(c.raw, t) + '%)';
              }
            }
          }
        }
      }
    });
  }

  var espera = null;
  function refrescar() { clearTimeout(espera); espera = setTimeout(function () { if (!document.hidden) cargar(); }, 800); }

  function iniciar() {
    if (!$('es-dona-canvas')) return;
    var botones = document.querySelectorAll('#es-dona-tabs .es-tab');
    function elegir(p, foco) {
      periodo = p;
      botones.forEach(function (b) {
        var on = b.dataset.periodo === p;
        b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
        if (on && foco) b.focus();
      });
      if (datos) pintar();
    }
    botones.forEach(function (b) { b.addEventListener('click', function () { elegir(b.dataset.periodo); }); });
    $('es-dona-tabs').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') elegir(periodo === 'mes' ? 'hoy' : 'mes', true);
    });
    if (window.CRMRealtime) window.CRMRealtime.connect('residencial', refrescar);
    setInterval(function () { if (!document.hidden) cargar(); }, 120000);
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
