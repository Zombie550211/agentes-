/* notificaciones.js — centro de notificaciones del CRM (lado de cada pestaña).
 *
 * Todas las páginas reciben sus avisos de aquí, por una sola conexión en vivo por
 * navegador: el SharedWorker js/core/notificaciones.worker.js la mantiene y la reparte a
 * todas las pestañas. El servidor publica en el canal del usuario o en el de su rol
 * (routers/stream.py → /api/stream/notificaciones), así que cada uno recibe lo suyo.
 *
 * Uso desde un módulo:
 *   CRMNotificaciones.on('faltas', fn)     // fn(evento) cuando llega un evento de ese tipo
 *   CRMNotificaciones.onEstado(fn)         // fn(enVivo) al conectar o perder la conexión
 *   CRMNotificaciones.enVivo()             // ¿llegan los eventos al instante ahora mismo?
 * Sin conexión en vivo (navegador sin SharedWorker, red caída) enVivo() es false y cada
 * módulo vuelve a consultar por su cuenta cada cierto tiempo.
 *
 * Lo cargan js/layout/topbar-acciones.js y js/layout/sidebar.js en todas las páginas.
 */
(function () {
  'use strict';
  if (window.CRMNotificaciones || window.PORTAL) return;

  var oyentes = {};
  var oyentesEstado = [];
  var vivo = false;
  var puerto = null;

  function emitir(lista, arg) {
    (lista || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.warn('[notificaciones]', e); } });
  }

  window.CRMNotificaciones = {
    on: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    onEstado: function (fn) { oyentesEstado.push(fn); },
    enVivo: function () { return vivo; },
  };

  if (typeof SharedWorker === 'undefined') return;

  try {
    var w = new SharedWorker('/js/core/notificaciones.worker.js?v=20261026a', { name: 'crm-notificaciones' });
    puerto = w.port;
  } catch (e) {
    console.warn('[notificaciones] sin SharedWorker:', e);
    return;
  }

  puerto.onmessage = function (m) {
    var d = m.data || {};
    if (d.tipo === 'estado') {
      if (d.enVivo !== vivo) { vivo = d.enVivo; emitir(oyentesEstado, vivo); }
    } else if (d.tipo === 'evento' && d.evento) {
      emitir(oyentes[d.evento.type], d.evento);
    }
  };
  puerto.start();

  // Se presenta con su usuario: si en este navegador inició sesión otra cuenta, el
  // worker cambia la conexión a la nueva.
  var sesion = window.__sesion || fetch('/api/auth/verify-server', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  var yo = null;
  function saludar() { if (yo) puerto.postMessage({ tipo: 'hola', usuario: yo }); }
  Promise.resolve(sesion).then(function (s) {
    var u = s && s.user;
    if (u) { yo = u.id || u._id; saludar(); }
  });

  window.addEventListener('pagehide', function () { try { puerto.postMessage({ tipo: 'adios' }); } catch (_) { } });
  // Al volver del historial (bfcache) la pestaña se vuelve a apuntar.
  window.addEventListener('pageshow', function (e) { if (e.persisted) saludar(); });
})();
