/* ─────────────────────────────────────────────────────────────────────────
 * CRMRealtime — cliente de tiempo real (SSE) para el dashboard.
 *
 * Uso:
 *   CRMRealtime.connect('lineas', () => loadDashboard());
 *
 * - Abre una conexión EventSource a /api/stream?channel=... (same-origin → la
 *   cookie httponly de sesión viaja automáticamente; EventSource no admite
 *   cabeceras Authorization).
 * - Cuando el servidor avisa de un cambio, llama al callback `onChange` con un
 *   debounce para agrupar ráfagas de eventos.
 * - Reconecta solo. Si detecta sesión caída (401) deja de reintentar.
 * - Muestra un pequeño indicador flotante de estado (🟢 En vivo / 🔴 Reconectando)
 *   para confirmar visualmente la conexión. Ocúltalo con opts.indicator=false.
 *
 * Nota de despliegue: el backend usa un broker en memoria (1 worker). Si se
 * escala a varios workers hará falta Redis pub/sub, pero este cliente no cambia.
 * ──────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var DEBOUNCE_MS = 400;
  var MAX_BACKOFF_MS = 30000;
  var LOG = '[realtime]';

  // Indicador flotante compartido (un solo badge aunque haya varias conexiones).
  function ensureBadge() {
    var el = document.getElementById('crm-rt-badge');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'crm-rt-badge';
    el.style.cssText =
      'position:fixed;bottom:14px;right:14px;z-index:99999;' +
      'font:600 12px/1 Outfit,system-ui,sans-serif;padding:6px 10px;border-radius:999px;' +
      'background:rgba(15,23,42,.85);color:#e2e8f0;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;gap:6px;cursor:default;user-select:none;transition:opacity .3s;';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function setBadge(state) {
    var el;
    try { el = ensureBadge(); } catch (_) { return; }
    if (state === 'live') {
      el.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e;display:inline-block"></span> En vivo';
      el.style.opacity = '1';
      // Se atenúa tras 2.5s para no molestar, sin desaparecer del todo.
      clearTimeout(el._fade);
      el._fade = setTimeout(function () { el.style.opacity = '0.35'; }, 2500);
    } else {
      el.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block"></span> Reconectando…';
      el.style.opacity = '1';
      clearTimeout(el._fade);
    }
  }

  // ── Una sola conexión por canal en cada página (21-nov-2026) ──────────────
  // Antes cada connect() abría su propio EventSource: Estadísticas llegaba a 4 al
  // canal 'residencial' + 1 a 'lineas', más el de notificaciones = 6, justo el tope
  // de conexiones por servidor de Chrome en HTTP/1.1 (el CRM local): la página
  // siguiente se quedaba «cargando» esperando una conexión libre. Ahora los que
  // piden el mismo canal comparten un EventSource; cada uno conserva su callback,
  // su debounce y su badge.
  var canales = {};   // channel → { es, subs: [], backoff, closed }

  function abrirCanal(channel) {
    var c = canales[channel];
    if (!c || c.closed) return;
    try {
      c.es = new EventSource('/api/stream?channel=' + encodeURIComponent(channel));
    } catch (e) {
      console.warn(LOG, 'no se pudo crear EventSource:', e);
      reintentarCanal(channel);
      return;
    }

    c.es.onopen = function () {
      c.backoff = 2000;
      c.subs.forEach(function (s) { s.live(); });
    };

    c.es.onmessage = function (ev) {
      try {
        var data = JSON.parse(ev.data || '{}');
        if (data && data.type === 'connected') {
          c.subs.forEach(function (s) { s.live(); });
          return;
        }
      } catch (_) { /* payload no-JSON → tratar como cambio */ }
      c.subs.forEach(function (s) { s.live(); s.fire(); });
    };

    c.es.onerror = function () {
      console.warn(LOG, 'conexión perdida (canal ' + channel + '), comprobando sesión…');
      c.subs.forEach(function (s) { s.off(); });
      try { c.es.close(); } catch (_) {}
      // Comprobar sesión antes de reintentar: renueva la cookie (sliding
      // session) y evita reconectar en bucle si el usuario ya no tiene sesión.
      fetch('/api/auth/me', { credentials: 'include' })
        .then(function (r) {
          if (r.status === 401) { c.closed = true; console.warn(LOG, 'sesión expirada, no se reintenta'); return; }
          reintentarCanal(channel);
        })
        .catch(function () { reintentarCanal(channel); });
    };
  }

  function reintentarCanal(channel) {
    var c = canales[channel];
    if (!c || c.closed) return;
    setTimeout(function () { abrirCanal(channel); }, c.backoff);
    c.backoff = Math.min(c.backoff * 2, MAX_BACKOFF_MS);
  }

  function connect(channel, onChange, opts) {
    opts = opts || {};
    var showBadge = opts.indicator !== false;
    var debounceTimer = null;
    var cerrado = false;

    function fireChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        try { onChange(); } catch (e) { console.warn(LOG, 'onChange error:', e); }
      }, DEBOUNCE_MS);
    }

    var sub = {
      fire: fireChange,
      live: function () { if (showBadge) setBadge('live'); },
      off: function () { if (showBadge) setBadge('off'); },
    };

    var c = canales[channel];
    var nuevo = !c || c.closed;
    if (nuevo) c = canales[channel] = { es: null, subs: [], backoff: 2000, closed: false };
    c.subs.push(sub);
    if (nuevo) abrirCanal(channel);
    else if (c.es && c.es.readyState === 1 /* OPEN */) sub.live();

    // Al volver a la pestaña: refresca de inmediato y asegura conexión viva.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || cerrado) return;
      fireChange();
      var cc = canales[channel];
      if (cc && !cc.closed && cc.es && cc.es.readyState === 2 /* CLOSED */) abrirCanal(channel);
    });

    return {
      // Se da de baja este suscriptor; la conexión se cierra cuando no queda ninguno.
      close: function () {
        if (cerrado) return;
        cerrado = true;
        var cc = canales[channel];
        if (!cc) return;
        cc.subs = cc.subs.filter(function (s) { return s !== sub; });
        if (!cc.subs.length) {
          cc.closed = true;
          if (cc.es) { try { cc.es.close(); } catch (_) {} }
          delete canales[channel];
        }
      },
      refreshNow: fireChange,
    };
  }

  global.CRMRealtime = { connect: connect };
})(window);
