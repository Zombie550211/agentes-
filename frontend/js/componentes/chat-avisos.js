/* chat-avisos.js — avisos de mensajes de chat en todas las páginas del CRM.
 *
 * Antes, fuera de chat.html nadie se enteraba de un mensaje nuevo:
 * crm-notifications.js escuchaba un socket.io que ya no existe (el backend usa
 * SSE) y, además, desde que el menú se genera en sidebar.js ninguna página lo
 * cargaba. Este módulo lo carga sidebar.js en todas las páginas con menú menos
 * chat.html (allí lo gestiona chat-page.js).
 *
 * - Globo con los no leídos en el botón «Chat» del menú y «(N)» en el título.
 * - Tarjeta con el remitente y el comienzo del mensaje; al pulsarla se abre esa
 *   conversación en chat.html.
 * - No abre una conexión en vivo propia: consulta el número de no leídos cada
 *   20 s (y al volver a la pestaña) y, si sube, pide los mensajes nuevos para la
 *   tarjeta. Producción va por HTTP/1.1, donde el navegador solo admite 6
 *   conexiones por servidor; un segundo EventSource por pestaña (además del de
 *   realtime.js) las agotaba con 3 pestañas abiertas y el CRM se quedaba colgado.
 * - Si algún día realtime.js reparte también el chat (evento crm:chat-evento),
 *   la tarjeta sale al instante; el sondeo sigue igual.
 *
 * Lo que escribe otro usuario se pinta siempre con textContent, nunca como HTML.
 */
(function () {
  'use strict';
  if (window.__chatAvisos) return;
  window.__chatAvisos = true;
  if (/\/chat\.html$/i.test(location.pathname)) return;

  var VERSION_CSS = '20260919';
  var MAX_TARJETAS = 3;
  var DURACION_MS = 8000;
  var INTERVALO_MS = 20000;

  var yo = '';
  var noLeidos = -1;          // -1: aún sin el primer recuento
  var vistos = [];            // _id ya avisados (o que ya estaban al abrir la página)
  var tSondeo = null;
  var parado = false;         // sesión caída: no insistir

  function usuarioGuardado() {
    try { return JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || '{}') || {}; }
    catch (_) { return {}; }
  }

  function cargarCss() {
    if (document.querySelector('link[data-chat-avisos]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/componentes/chat-avisos.css?v=' + VERSION_CSS;
    l.setAttribute('data-chat-avisos', '');
    document.head.appendChild(l);
  }

  // ── Globo de no leídos ─────────────────────────────────────────────
  function pintarGlobo() {
    if (noLeidos < 0) return;
    var n = noLeidos > 99 ? '99+' : String(noLeidos);
    document.querySelectorAll('#app-sidebar a.sb-item[href="/chat.html"]').forEach(function (a) {
      var ic = a.querySelector('.sb-ic');
      if (!ic) return;
      var globo = ic.querySelector('.sb-chat-globo');
      var nombre = a.getAttribute('title') || 'Chat';
      if (!noLeidos) {
        if (globo) globo.remove();
        a.setAttribute('aria-label', nombre);
        return;
      }
      if (!globo) {
        globo = document.createElement('span');
        globo.className = 'sb-chat-globo';
        globo.setAttribute('aria-hidden', 'true');
        ic.appendChild(globo);
      }
      globo.textContent = n;
      a.setAttribute('aria-label', nombre + ', ' + noLeidos + (noLeidos === 1 ? ' mensaje sin leer' : ' mensajes sin leer'));
    });
    // Con el menú plegado (tablet, pantalla estrecha) solo se ve el botón ☰:
    // también lleva el número. Lo crea sidebar-ui.js.
    var boton = document.querySelector('.sb-mobile-toggle');
    if (boton) {
      var gb = boton.querySelector('.sb-chat-globo');
      if (!noLeidos) { if (gb) gb.remove(); }
      else {
        if (!gb) {
          gb = document.createElement('span');
          gb.className = 'sb-chat-globo';
          gb.setAttribute('aria-hidden', 'true');
          boton.appendChild(gb);
        }
        gb.textContent = n;
      }
    }
    // Se quita solo el prefijo propio: la página puede haber cambiado su título.
    var base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = noLeidos ? '(' + n + ') ' + base : base;
  }

  function marcarVisto(id) {
    if (!id || vistos.indexOf(id) !== -1) return false;
    vistos.push(id);
    if (vistos.length > 200) vistos.shift();
    return true;
  }

  // Mensajes sin leer. Al abrir la página solo se toman como «ya vistos» (no se
  // avisa de lo que ya estaba); después, los nuevos salen en tarjeta.
  function pedirNoLeidos(avisar) {
    return fetch('/api/chat/unread', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var lista = (d && d.messages) || [];
        var nuevos = [];
        for (var i = lista.length - 1; i >= 0; i--) {   // vienen del más reciente al más antiguo
          var m = lista[i];
          if (marcarVisto(String(m._id || m.id || '')) && m.from !== yo) nuevos.push(m);
        }
        if (avisar) nuevos.slice(-MAX_TARJETAS).forEach(mostrarTarjeta);
      })
      .catch(function () {});
  }

  function contarNoLeidos() {
    if (parado) return;
    fetch('/api/chat/unread-count', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { parado = true; clearTimeout(tSondeo); return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d) return;
        var antes = noLeidos;
        noLeidos = Math.max(0, Number(d.count) || 0);
        pintarGlobo();
        if (antes < 0) { if (noLeidos) pedirNoLeidos(false); }
        else if (noLeidos > antes) pedirNoLeidos(true);
      })
      .catch(function () {});
  }

  function programarSondeo() {
    clearTimeout(tSondeo);
    if (parado || document.hidden) return;   // oculta: se reanuda al volver
    tSondeo = setTimeout(function () { contarNoLeidos(); programarSondeo(); }, INTERVALO_MS);
  }

  // ── Tarjetas ───────────────────────────────────────────────────────
  function pila() {
    var p = document.getElementById('chat-avisos');
    if (!p) {
      p = document.createElement('div');
      p.id = 'chat-avisos';
      p.className = 'chat-avisos';
      p.setAttribute('role', 'status');
      p.setAttribute('aria-live', 'polite');
      document.body.appendChild(p);
    }
    return p;
  }

  // Los «correos» del chat llevan HTML. El texto se saca en un documento inerte:
  // DOMParser no ejecuta scripts ni carga imágenes.
  function textoPlano(html) {
    try {
      var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (_) { return String(html || ''); }
  }

  function iniciales(nombre) {
    return String(nombre || '').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
  }

  function span(clase, texto) {
    var s = document.createElement('span');
    s.className = clase;
    if (texto !== undefined) s.textContent = texto;
    return s;
  }

  function mostrarTarjeta(msg) {
    var p = pila();
    while (p.children.length >= MAX_TARJETAS) p.firstElementChild.remove();

    var nombre = msg.fromName || msg.from || 'Alguien';
    var texto = msg.subject ? 'Asunto: ' + msg.subject : textoPlano(msg.body);
    if (texto.length > 140) texto = texto.slice(0, 137) + '…';

    var tarjeta = document.createElement('div');
    tarjeta.className = 'chat-aviso';
    var enlace = document.createElement('a');
    enlace.className = 'chat-aviso-enlace';
    enlace.href = '/chat.html?con=' + encodeURIComponent(msg.from || '');
    var avatar = span('chat-aviso-avatar', iniciales(nombre));
    avatar.setAttribute('aria-hidden', 'true');
    var cuerpo = span('chat-aviso-cuerpo');
    cuerpo.append(
      span('chat-aviso-titulo', (msg.type === 'email' ? 'Correo de ' : 'Mensaje de ') + nombre),
      span('chat-aviso-texto', texto || '(sin texto)'),
      span('chat-aviso-ir', 'Abrir conversación')
    );
    enlace.append(avatar, cuerpo);

    var cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'chat-aviso-cerrar';
    cerrar.setAttribute('aria-label', 'Cerrar aviso');
    cerrar.textContent = '×';
    cerrar.addEventListener('click', function () { tarjeta.remove(); });

    tarjeta.append(enlace, cerrar);
    p.appendChild(tarjeta);

    // Se va sola, salvo mientras el ratón o el foco estén encima.
    var t = setTimeout(function () { tarjeta.remove(); }, DURACION_MS);
    tarjeta.addEventListener('mouseenter', function () { clearTimeout(t); });
    tarjeta.addEventListener('focusin', function () { clearTimeout(t); });
    tarjeta.addEventListener('mouseleave', function () {
      clearTimeout(t);
      t = setTimeout(function () { tarjeta.remove(); }, DURACION_MS / 2);
    });
  }

  function recibir(data) {
    if (!data || data.type !== 'chat:message' || !data.message) return;
    var m = data.message;
    // Lo que envío yo (desde otra pestaña) también llega por mi canal: no avisa.
    if (!yo || m.to !== yo || m.from === yo) return;
    if (!marcarVisto(String(m._id || m.id || ''))) return;
    noLeidos = Math.max(noLeidos, 0) + 1;
    pintarGlobo();
    mostrarTarjeta(m);
  }

  // ── Arranque ───────────────────────────────────────────────────────
  window.addEventListener('crm:chat-evento', function (e) { recibir(e.detail); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(tSondeo); return; }
    contarNoLeidos();            // lo que llegó mientras tanto, o lo que leyó en otra pestaña
    programarSondeo();
  });

  yo = usuarioGuardado().username || '';
  if (!yo) {
    fetch('/api/auth/verify-server', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { yo = (d && d.user && d.user.username) || ''; })
      .catch(function () {});
  }
  cargarCss();
  // Por si el botón ☰ se crea después del primer recuento.
  window.addEventListener('load', function () { if (noLeidos > 0) pintarGlobo(); });
  contarNoLeidos();
  programarSondeo();
})();
