/* theme-init.js — aplica el tema guardado, antes de que se pinte la página.
   ─────────────────────────────────────────────────────────────────────────
   Hasta el 21-09-2026 este archivo forzaba `light` y borraba la clase
   .dark-theme en cada carga. No era un capricho: el modo oscuro estaba
   escrito como 468 overrides con !important contra colores fijados a mano,
   y no se sostenía. Se apagó desde aquí porque era el único sitio donde se
   podía apagar entero.

   Ahora el color neutro del CRM sale de css/base/tokens.css, así que el
   tema es redefinir variables y este archivo vuelve a su trabajo real:
   leer la preferencia y aplicarla.

   IMPORTANTE: este script va SIN `defer` y lo antes posible en el <head>.
   Si se ejecutara después de pintar, se vería un fogonazo blanco antes de
   que entrara el tema oscuro. Por eso toca documentElement y no body: body
   todavía no existe cuando esto corre.

   La preferencia se guarda en localStorage bajo 'theme'. Se admite también
   la clave antigua 'crm_theme', que usaban estadisticas.html y
   ranking-agente.html con su propia lógica. */
(function () {
  var TEMAS = { light: 1, dark: 1 };

  function guardado() {
    try {
      var t = localStorage.getItem('theme') || localStorage.getItem('crm_theme');
      return TEMAS[t] ? t : null;
    } catch (_) { return null; }       // modo privado: localStorage puede lanzar
  }

  // Sin preferencia explícita: CLARO, a propósito.
  //
  // Lo natural aquí sería seguir a `prefers-color-scheme` del sistema. NO se
  // hace todavía: la conversión a tokens va por las hojas compartidas y las
  // 27 hojas de página siguen con el color escrito a mano. Seguir al sistema
  // significaría que a todo el que tenga el portátil en oscuro se le abre un
  // CRM a medio pintar, sin haber pedido nada.
  //
  // El oscuro se activa sólo si alguien lo elige. Cuando las hojas de página
  // estén convertidas, esto pasa a `guardado() || delSistema()`.
  var tema = guardado() || 'light';

  function aplicar(t) {
    // En <html> y no en <body>: este script corre antes de que body exista.
    // La clase se copia a body en cuanto esté, porque las hojas del CRM
    // llevan años escribiendo `body.dark-theme`.
    var raiz = document.documentElement;
    raiz.classList.toggle('dark-theme', t === 'dark');
    if (document.body) document.body.classList.toggle('dark-theme', t === 'dark');
  }

  aplicar(tema);

  document.addEventListener('DOMContentLoaded', function () {
    aplicar(document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light');
  });

  // API mínima para el interruptor de la interfaz. Emite 'themeChanged',
  // que ranking-agente.html ya escuchaba.
  window.CRMTema = {
    actual: function () {
      return document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light';
    },
    poner: function (t) {
      if (!TEMAS[t]) return;
      try { localStorage.setItem('theme', t); } catch (_) {}
      aplicar(t);
      document.dispatchEvent(new CustomEvent('themeChanged', { detail: { tema: t } }));
    },
    alternar: function () {
      this.poner(this.actual() === 'dark' ? 'light' : 'dark');
    }
  };

})();
