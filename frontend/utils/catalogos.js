/**
 * utils/catalogos.js
 * Catálogos del formulario desde el backend (/api/catalogos) — fuente única.
 * Reemplaza los datos hardcodeados: mercado, motivo, riesgo, status, autopago.
 *
 *   window.Catalogos.load()                       -> Promise
 *   window.Catalogos.items(tipo)                  -> [{id,tipo,valor,label,orden,activo}]
 *   window.Catalogos.fillSelect(sel, tipo, cur, placeholder) -> Promise
 */
(function() {
  'use strict';

  var _byTipo = {};
  var _loading = null;

  function _opts() {
    var t = '';
    try { t = localStorage.getItem('token') || sessionStorage.getItem('token') || ''; } catch (e) {}
    var o = { credentials: 'include' };
    if (t) o.headers = { 'Authorization': 'Bearer ' + t };
    return o;
  }

  function _fetch() {
    if (_loading) return _loading;
    _loading = fetch('/api/catalogos', _opts())
      .then(function(r) { return r.ok ? r.json() : { catalogos: {} }; })
      .then(function(d) { _byTipo = (d && d.catalogos) || {}; return _byTipo; })
      .catch(function() { return {}; });
    return _loading;
  }

  function _items(tipo) {
    return (_byTipo[tipo] || []).filter(function(x) { return x.activo === undefined || x.activo; });
  }

  window.Catalogos = {
    load: _fetch,
    items: _items,

    fillSelect: function(sel, tipo, current, placeholder) {
      if (!sel) return _fetch();
      return _fetch().then(function() {
        var cur = current != null ? current : sel.value;
        sel.innerHTML = '';
        if (placeholder !== false) {
          var ph = document.createElement('option');
          ph.value = ''; ph.textContent = placeholder || 'Elige';
          sel.appendChild(ph);
        }
        _items(tipo).forEach(function(it) {
          var o = document.createElement('option');
          o.value = it.valor; o.textContent = it.label || it.valor;
          sel.appendChild(o);
        });
        if (cur) {
          var exists = Array.from(sel.options).some(function(o) { return o.value === cur; });
          if (!exists) { var e = document.createElement('option'); e.value = cur; e.textContent = cur; sel.appendChild(e); }
          sel.value = cur;
        }
      });
    },
  };

  _fetch();
})();
