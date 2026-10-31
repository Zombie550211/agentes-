/**
 * Inactivity Manager - cierre de sesión por inactividad (5 min sin acción en el CRM).
 *
 * Lo cargan sidebar.js y topbar-acciones.js en todas las páginas del CRM (antes solo
 * lo traían 10 páginas: en el resto la sesión vencía en el servidor a los 30 min sin
 * peticiones aunque la persona estuviera escribiendo, y se cerraba "de imprevisto").
 *
 * - La última actividad se comparte entre pestañas (localStorage): trabajar en una
 *   pestaña mantiene viva la sesión aunque otra lleve rato quieta.
 * - Se comprueba cada pocos segundos contra el reloj, no con un setTimeout largo, para
 *   que funcione bien con pestañas en segundo plano y tras suspender el PC.
 * - Mientras haya actividad se renueva el token en el servidor (sliding session).
 * - El aviso previo es un banner, no un alert(): un alert congela la página.
 */

(function() {
  'use strict';
  if (window.PORTAL || window.__crmInactividad) return;
  var publicas = ['/login.html', '/index.html', '/register.html', '/reset-password.html', '/crear-cuenta.html'];
  if (location.pathname === '/' || publicas.some(function (p) { return location.pathname.endsWith(p); })) return;
  window.__crmInactividad = true;

  var CFG = window.CRM_CONFIG || {};
  if (CFG.ENABLE_INACTIVITY === false) return;
  var TIMEOUT = CFG.INACTIVITY_TIMEOUT || 5 * 60 * 1000;
  var AVISO   = CFG.WARNING_TIMEOUT || TIMEOUT - 60 * 1000;   // aviso 1 min antes

  // Misma clave en login.js: el login la pone al día para que una marca vieja no
  // cierre la sesión recién abierta.
  var CLAVE = 'crm_ultima_actividad';
  var KEEPALIVE_INTERVAL = 2 * 60 * 1000;
  var events = ['mousedown', 'mousemove', 'keydown', 'input', 'scroll', 'wheel', 'touchstart', 'click'];

  var ultimaLocal = Date.now();
  var ultimaEscrita = 0;
  var lastKeepalive = 0;
  var saliendo = false;
  var banner = null;

  function leerCompartida() {
    try { return parseInt(localStorage.getItem(CLAVE), 10) || 0; } catch (_) { return 0; }
  }

  function ultimaActividad() {
    return Math.max(ultimaLocal, leerCompartida());
  }

  function keepalive() {
    var now = Date.now();
    if (now - lastKeepalive < KEEPALIVE_INTERVAL) return;
    lastKeepalive = now;
    try {
      fetch('/api/auth/verify-server', { credentials: 'include' }).catch(function () {});
    } catch (_) {}
  }

  function actividad() {
    if (saliendo) return;
    var now = Date.now();
    ultimaLocal = now;
    // mousemove dispara cientos de veces: se escribe como mucho cada 5 s.
    if (now - ultimaEscrita > 5000) {
      ultimaEscrita = now;
      try { localStorage.setItem(CLAVE, String(now)); } catch (_) {}
    }
    if (banner) ocultarAviso();
    keepalive();
  }

  function logout() {
    if (saliendo) return;
    saliendo = true;
    try {
      localStorage.removeItem('user');
      localStorage.removeItem('username');
      localStorage.removeItem('role');
      localStorage.removeItem(CLAVE);
      sessionStorage.removeItem('user');
      localStorage.setItem('crm_show_update_for_all', '1');
    } catch (_) {}
    var destino = '/login.html?message=' + encodeURIComponent('Tu sesión se cerró por inactividad (más de ' + Math.round(TIMEOUT / 60000) + ' min sin uso). Inicia sesión de nuevo.');
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(function () {})
      .finally(function () { window.location.replace(destino); });
  }

  function mostrarAviso(restanteMs) {
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;' +
        'background:#1e293b;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:12px;' +
        'padding:12px 18px;box-shadow:0 10px 30px rgba(0,0,0,.35);font:600 .85rem \'Outfit\',\'Segoe UI\',sans-serif;' +
        'display:flex;align-items:center;gap:14px;max-width:calc(100vw - 32px);flex-wrap:wrap;';
      var txt = document.createElement('span');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Seguir conectado';
      btn.style.cssText = 'background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer;';
      btn.addEventListener('click', actividad);
      banner.appendChild(txt);
      banner.appendChild(btn);
      document.body.appendChild(banner);
    }
    var seg = Math.max(0, Math.ceil(restanteMs / 1000));
    banner.firstChild.textContent = 'Tu sesión se cerrará por inactividad en ' + seg + ' s.';
  }

  function ocultarAviso() {
    if (banner) { banner.remove(); banner = null; }
  }

  function revisar() {
    if (saliendo) return;
    var inactivo = Date.now() - ultimaActividad();
    if (inactivo >= TIMEOUT) return logout();
    if (inactivo >= AVISO) mostrarAviso(TIMEOUT - inactivo);
    else ocultarAviso();
  }

  function init() {
    // Volver a una pestaña (o reabrir el navegador) tras más de TIMEOUT sin uso
    // también cierra la sesión, aunque el token del servidor siga vigente.
    var previa = leerCompartida();
    if (previa && Date.now() - previa >= TIMEOUT) { ultimaLocal = previa; return logout(); }

    events.forEach(function (event) {
      document.addEventListener(event, actividad, { capture: true, passive: true });
    });
    // Al volver a la pestaña se revisa al momento, sin esperar al siguiente tic.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) revisar(); });
    actividad();
    setInterval(revisar, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
