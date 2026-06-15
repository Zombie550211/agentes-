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

  function connect(channel, onChange, opts) {
    opts = opts || {};
    var showBadge = opts.indicator !== false;
    var debounceTimer = null;
    var es = null;
    var backoff = 2000;
    var closed = false;

    console.info(LOG, 'conectando canal', channel);

    function fireChange() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        console.info(LOG, 'refrescando datos (canal ' + channel + ')');
        try { onChange(); } catch (e) { console.warn(LOG, 'onChange error:', e); }
      }, DEBOUNCE_MS);
    }

    function open() {
      if (closed) return;
      try {
        es = new EventSource('/api/stream?channel=' + encodeURIComponent(channel));
      } catch (e) {
        console.warn(LOG, 'no se pudo crear EventSource:', e);
        scheduleReconnect();
        return;
      }

      es.onopen = function () {
        backoff = 2000;
        console.info(LOG, 'conectado ✓ (canal ' + channel + ')');
        if (showBadge) setBadge('live');
      };

      es.onmessage = function (ev) {
        try {
          var data = JSON.parse(ev.data || '{}');
          if (data && data.type === 'connected') {
            console.info(LOG, 'stream listo (canal ' + channel + ')');
            if (showBadge) setBadge('live');
            return;
          }
        } catch (_) { /* payload no-JSON → tratar como cambio */ }
        console.info(LOG, 'evento recibido →', ev.data);
        if (showBadge) setBadge('live');
        fireChange();
      };

      es.onerror = function () {
        console.warn(LOG, 'conexión perdida (canal ' + channel + '), comprobando sesión…');
        if (showBadge) setBadge('off');
        try { es.close(); } catch (_) {}
        // Comprobar sesión antes de reintentar: renueva la cookie (sliding
        // session) y evita reconectar en bucle si el usuario ya no tiene sesión.
        fetch('/api/auth/me', { credentials: 'include' })
          .then(function (r) {
            if (r.status === 401) { closed = true; console.warn(LOG, 'sesión expirada, no se reintenta'); return; }
            scheduleReconnect();
          })
          .catch(function () { scheduleReconnect(); });
      };
    }

    function scheduleReconnect() {
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }

    // Al volver a la pestaña: refresca de inmediato y asegura conexión viva.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      fireChange();
      if (es && es.readyState === 2 /* CLOSED */ && !closed) open();
    });

    open();

    return {
      close: function () { closed = true; if (es) { try { es.close(); } catch (_) {} } },
      refreshNow: fireChange,
    };
  }

  global.CRMRealtime = { connect: connect };
  console.info(LOG, 'realtime.js cargado');
})(window);
