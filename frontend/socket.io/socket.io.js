/**
 * Socket.IO stub — evita el 404 del cliente.
 * No establece conexión real; crm-notifications.js maneja
 * la ausencia de socket gracefully.
 */
(function (global) {
  function noop() {}
  function Socket() {
    this._events = {};
  }
  Socket.prototype.on = function (ev, fn) { (this._events[ev] = this._events[ev] || []).push(fn); return this; };
  Socket.prototype.off = function () { return this; };
  Socket.prototype.emit = function () { return this; };
  Socket.prototype.connect = function () { return this; };
  Socket.prototype.disconnect = function () { return this; };

  function io() { return new Socket(); }
  io.connect = io;

  global.io = io;
})(typeof window !== 'undefined' ? window : this);
