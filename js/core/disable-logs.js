/* Desactiva logs del navegador en producción (fuera de localhost) */
(function () {
  try {
    var host = (typeof location !== 'undefined' && location.hostname) ? location.hostname : '';
    var isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    var isFile = (typeof location !== 'undefined' && location.protocol === 'file:');
    var allowLogs = isLocal || isFile;
    if (!allowLogs && typeof console !== 'undefined') {
      var no = function () {};
      ['log', 'info', 'debug', 'trace'].forEach(function (k) {
        try { console[k] = no; } catch (e) {}
      });
      if (typeof console.group === 'function') {
        try { console.group = no; console.groupCollapsed = no; console.groupEnd = no; } catch (e) {}
      }
    }
  } catch (e) {
    // no-op
  }
})();
