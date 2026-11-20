/* estadisticas-comun.js — piezas compartidas de las tablas de Estadísticas.
 * Cada team tiene su color (por orden de la lista), así se reconoce igual en Calis y en Ventas.
 */
(function () {
  'use strict';
  var COLORES = ['#007098', '#be185d', '#c2410c', '#15803d', '#7c3aed', '#b45309', '#4338ca', '#0f766e', '#9f1239'];
  var asignado = {};   // TEAM → color, por orden (Residencial y luego Líneas, alfabético)

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function corto(t) { return String(t || '').replace(/^TEAM\s+(L[IÍ]NEAS\s+)?/i, '').trim() || String(t || ''); }
  function nombre(t) {
    return corto(t).toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function iniciales(t) {
    return corto(t).split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '?';
  }
  // Las dos tablas llaman a registrar() con la misma lista de teams → mismos colores en ambas.
  function registrar(teams) {
    var lista = teams.map(function (t) { return { k: String(t.team || t).toUpperCase(), lin: t.seccion === 'lineas' }; })
      .sort(function (a, b) { return (a.lin - b.lin) || a.k.localeCompare(b.k); });
    asignado = {};
    lista.forEach(function (x, i) { asignado[x.k] = COLORES[i % COLORES.length]; });
  }
  function color(t) {
    if (asignado[String(t).toUpperCase()]) return asignado[String(t).toUpperCase()];
    var s = corto(t).toUpperCase(), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLORES[h % COLORES.length];
  }
  // Celda de encabezado de fila: solo el nombre (estilo sobrio, 20-nov: sin círculos de color).
  function celda(t) {
    return '<th scope="row" class="es-col-team" title="' + esc(t) + '"><span class="es-nom">' + esc(nombre(t)) + '</span></th>';
  }

  window.ESTeam = { registrar: registrar, esc: esc, nombre: nombre, iniciales: iniciales, color: color, celda: celda };
})();
