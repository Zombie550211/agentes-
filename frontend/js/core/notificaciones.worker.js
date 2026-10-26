/* notificaciones.worker.js — SharedWorker del centro de notificaciones.
 *
 * Uno por navegador, compartido por todas las pestañas del CRM (lo arranca
 * js/core/notificaciones.js). Mantiene UNA conexión SSE a /api/stream/notificaciones y
 * reparte cada evento a todas las pestañas. Antes cada pestaña abría la suya o preguntaba
 * por su cuenta cada 20 s; con HTTP/1.1 el navegador solo admite 6 conexiones por
 * servidor y varias pestañas abiertas llegaron a colgar el CRM.
 *
 * Mensajes de la pestaña:  {tipo:'hola', usuario:'<id>'} · {tipo:'adios'}
 * Mensajes a la pestaña:   {tipo:'estado', enVivo:bool} · {tipo:'evento', evento:{...}}
 */
'use strict';

var URL_STREAM = '/api/stream/notificaciones';
var MAX_ESPERA_MS = 60000;

var puertos = [];
var es = null;
var enVivo = false;
var usuarioConexion = null;   // id que dio el servidor al conectar
var usuarioEsperado = null;   // id de la sesión de la última pestaña que saludó
var espera = 2000;
var tReintento = null;

function enviar(msg) {
  puertos.forEach(function (p) { try { p.postMessage(msg); } catch (_) { /* pestaña cerrada */ } });
}

function fijarEstado(v) {
  if (v === enVivo) return;
  enVivo = v;
  enviar({ tipo: 'estado', enVivo: v });
}

function cerrar() {
  clearTimeout(tReintento);
  if (es) { es.close(); es = null; }
  usuarioConexion = null;
  fijarEstado(false);
}

function conectar() {
  cerrar();
  if (!puertos.length) return;
  es = new EventSource(URL_STREAM);
  es.onmessage = function (e) {
    var ev;
    try { ev = JSON.parse(e.data); } catch (_) { return; }
    if (ev.type === 'connected') {
      usuarioConexion = String(ev.user_id || '');
      espera = 2000;
      // Otra cuenta inició sesión en este navegador: la conexión vieja no le sirve.
      if (usuarioEsperado && usuarioConexion !== usuarioEsperado) { conectar(); return; }
      fijarEstado(true);
      return;
    }
    enviar({ tipo: 'evento', evento: ev });
  };
  es.onerror = function () {
    fijarEstado(false);
    // Un corte de red lo reintenta EventSource solo; un 401/500 lo deja cerrado.
    if (es && es.readyState === EventSource.CLOSED) {
      es = null;
      tReintento = setTimeout(conectar, espera);
      espera = Math.min(espera * 2, MAX_ESPERA_MS);
    }
  };
}

self.onconnect = function (e) {
  var puerto = e.ports[0];
  puertos.push(puerto);
  puerto.onmessage = function (m) {
    var d = m.data || {};
    if (d.tipo === 'hola') {
      // Una pestaña que vuelve del historial (bfcache) ya se había despedido.
      if (puertos.indexOf(puerto) < 0) puertos.push(puerto);
      usuarioEsperado = d.usuario ? String(d.usuario) : null;
      if (!es) conectar();
      else if (usuarioConexion && usuarioEsperado && usuarioConexion !== usuarioEsperado) conectar();
      puerto.postMessage({ tipo: 'estado', enVivo: enVivo });
    } else if (d.tipo === 'adios') {
      puertos = puertos.filter(function (p) { return p !== puerto; });
      if (!puertos.length) cerrar();
    }
  };
  puerto.start();
};
