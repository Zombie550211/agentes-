/**
 * Rendimiento de usuarios: mide cuánto tarda en cargar esta pantalla EN ESTA PC y lo
 * envía al servidor (POST /api/rendimiento). Lo ve administración en Permisos →
 * «Rendimiento de usuarios». Lo inyecta js/layout/topnav.js en todas las pantallas.
 *
 * - Usa los tiempos que el navegador ya registra (Navigation/Resource Timing), así que
 *   no frena nada. Si algo falla al medir, simplemente no envía.
 * - «Congelado» = tiempo en que el navegador estuvo ocupado más de 50 ms seguidos
 *   (tareas largas): señal de PC saturada.
 */
(function () {
  'use strict';
  if (window.__rendimientoCRM || !window.performance || !navigator.sendBeacon) return;
  window.__rendimientoCRM = true;

  var congelado = 0, nCongelados = 0;
  try {
    new PerformanceObserver(function (lista) {
      lista.getEntries().forEach(function (e) { congelado += e.duration; nCongelados++; });
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) { /* navegador sin longtask */ }

  function ms(x) { return (typeof x === 'number' && isFinite(x) && x >= 0) ? Math.round(x) : null; }

  function enviar() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (!nav || !nav.loadEventEnd) return;
      // Peticiones al servidor más lentas de esta pantalla (sin la conexión en vivo).
      var lentas = performance.getEntriesByType('resource')
        .filter(function (r) { return r.name.indexOf('/api/') >= 0 && r.name.indexOf('/api/stream') < 0; })
        .sort(function (a, b) { return b.duration - a.duration; })
        .slice(0, 3)
        .map(function (r) { var u = new URL(r.name); return { url: u.pathname, ms: ms(r.duration) }; });
      var con = navigator.connection || {};
      var datos = {
        pagina: location.pathname,
        total_ms: ms(nav.loadEventEnd),
        servidor_ms: ms(nav.responseStart - nav.requestStart),
        descarga_ms: ms(nav.responseEnd - nav.responseStart),
        dom_ms: ms(nav.domContentLoadedEventEnd - nav.responseEnd),
        congelado_ms: ms(congelado),
        n_congelados: nCongelados,
        cores: navigator.hardwareConcurrency || null,
        memoria_gb: navigator.deviceMemory || null,
        conexion: con.effectiveType || null,
        lentas: lentas,
      };
      navigator.sendBeacon('/api/rendimiento', new Blob([JSON.stringify(datos)], { type: 'application/json' }));
    } catch (_) { /* medir nunca debe romper la página */ }
  }

  // Unos segundos después de cargar: así entran las peticiones que la pantalla hace al
  // arrancar (tablas, estadísticas) y las tareas largas de pintarlas.
  function programar() { setTimeout(enviar, 6000); }
  if (document.readyState === 'complete') programar();
  else window.addEventListener('load', programar, { once: true });
})();
