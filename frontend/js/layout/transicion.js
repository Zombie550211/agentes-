/**
 * Transición entre páginas del CRM: los contenedores se juntan al entrar y se separan
 * al salir.
 *
 *  - Entrada: cada contenedor (.in-glass de primer nivel, la cabecera y lo marcado con
 *    [data-pieza]) aparece desplazado un poco HACIA FUERA, en la dirección que va del
 *    centro de la pantalla a él, y llega a su sitio. Todos convergen hacia el centro, en
 *    cascada de arriba abajo.
 *  - Salida (clic en un enlace interno): el movimiento contrario, más corto, y luego navega.
 *
 * Coste: sólo transform y opacity (no recalcula la maquetación) con la Web Animations
 * API; nada de librerías. Con «reducir movimiento» del sistema no hay desplazamiento,
 * sólo un fundido breve. Si algo falla, los contenedores se muestran igual: nunca se
 * queda una página en blanco.
 *
 * Se carga en el <head> SIN defer: así marca <html class="tr-js"> antes de pintar y los
 * contenedores no parpadean antes de animarse (ver css/componentes/transicion.css).
 */
(function () {
  'use strict';

  var raiz = document.documentElement;
  if (!raiz.animate) return;                     // navegador sin Web Animations: sin transición
  raiz.classList.add('tr-js');

  var REDUCIDO = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CURVA = 'cubic-bezier(.22, 1, .36, 1)';    // salida suave, sin rebote
  // Ritmo pausado a propósito, para que el movimiento se aprecie sin hacerse lento.
  var ENTRADA_MS = 950, PASO_MS = 70, MAX_RETRASO_MS = 600;
  var SALIDA_MS = 360;
  var ALCANCE = 0.09;                            // cuánto «se separan»: 9 % de la distancia al centro

  function piezas() {
    var todas = document.querySelectorAll('.in-head, .in-glass, [data-pieza]');
    return Array.prototype.filter.call(todas, function (el) {
      // Sólo las de primer nivel: una tarjeta dentro de otra se mueve con su madre.
      return !el.parentElement.closest('.in-glass, [data-pieza]') && !el.closest('.trf-oculto');
    });
  }
  function vector(el) {
    var r = el.getBoundingClientRect();
    return {
      dx: (r.left + r.width / 2 - innerWidth / 2) * ALCANCE,
      dy: (r.top + r.height / 2 - innerHeight / 2) * ALCANCE,
      top: r.top, left: r.left,
      visible: r.bottom > 0 && r.top < innerHeight,
    };
  }

  function entrar() {
    var lista = piezas().map(function (el) { return { el: el, v: vector(el) }; })
      .filter(function (p) { return p.v.visible; })
      .sort(function (a, b) { return (a.v.top - b.v.top) || (a.v.left - b.v.left); });
    lista.forEach(function (p, i) {
      var desde = REDUCIDO
        ? { opacity: 0 }
        : { opacity: 0, transform: 'translate(' + p.v.dx.toFixed(1) + 'px,' + p.v.dy.toFixed(1) + 'px) scale(.96)' };
      p.el.animate([desde, { opacity: 1, transform: 'none' }], {
        duration: REDUCIDO ? 200 : ENTRADA_MS,
        delay: REDUCIDO ? 0 : Math.min(i * PASO_MS, MAX_RETRASO_MS),
        easing: CURVA,
        fill: 'backwards',
      });
    });
    raiz.classList.add('tr-listo');              // las animaciones ya tienen su estado inicial
  }

  function salir(destino) {
    var lista = piezas().map(function (el) { return { el: el, v: vector(el) }; })
      .filter(function (p) { return p.v.visible; });
    lista.forEach(function (p) {
      var hasta = REDUCIDO
        ? { opacity: 0 }
        : { opacity: 0, transform: 'translate(' + (p.v.dx * 0.6).toFixed(1) + 'px,' + (p.v.dy * 0.6).toFixed(1) + 'px) scale(.98)' };
      p.el.animate([{ opacity: 1, transform: 'none' }, hasta], {
        duration: REDUCIDO ? 120 : SALIDA_MS, easing: 'cubic-bezier(.45, 0, .55, 1)', fill: 'forwards',
      });
    });
    setTimeout(function () { location.href = destino; }, REDUCIDO ? 120 : SALIDA_MS - 40);
  }

  // Enlaces internos normales → salida animada. Se respeta todo lo que el navegador hace
  // distinto: nueva pestaña, Ctrl/⌘/Mayús, descargas, anclas de la misma página, otros sitios.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.hasAttribute('data-sin-transicion')) return;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
    if (url.pathname === location.pathname && url.search === location.search) return;   // ancla o la misma página
    e.preventDefault();
    salir(url.href);
  });

  // Volver con «atrás» (la página sale de la caché del navegador tal como se dejó):
  // quitar el estado de salida y volver a entrar.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    piezas().forEach(function (el) { el.getAnimations().forEach(function (an) { an.cancel(); }); });
    entrar();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', entrar);
  else entrar();
  // Red de seguridad: pase lo que pase, a los 2 s todo visible.
  setTimeout(function () { raiz.classList.add('tr-listo'); }, 2000);
})();
