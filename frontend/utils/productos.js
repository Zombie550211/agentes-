/**
 * utils/productos.js
 * Catálogo de servicios/puntajes desde el backend (/api/productos) — fuente única.
 * NO hay servicios ni puntajes hardcodeados en el frontend.
 *
 *   window.Productos.load()                          -> Promise
 *   window.Productos.list()                          -> [{servicio,categoria,tipo,sistema,score_*}]
 *   window.Productos.metaFor(servicio)               -> objeto o null
 *   window.Productos.scoreFor(servicio,riesgo,tipo)  -> Promise<number>  (usa /api/productos/score)
 *   window.Productos.fillSelect(sel, valorActual, placeholder) -> Promise (llena un <select>)
 *   window.Productos.tipos() / sistemas()            -> valores distintos
 *   window.Productos.fillEnum(sel, values, cur, ph)  -> Promise
 */
(function() {
  'use strict';

  var _items = [];
  var _loading = null;
  var _byName = {};

  // Auth por Bearer token (como el resto de la app)
  function _opts() {
    var t = '';
    try { t = localStorage.getItem('token') || sessionStorage.getItem('token') || ''; } catch (e) {}
    var o = { credentials: 'include' };
    if (t) o.headers = { 'Authorization': 'Bearer ' + t };
    return o;
  }

  function _index() {
    _byName = {};
    _items.forEach(function(p) { _byName[String(p.servicio || '').toUpperCase()] = p; });
  }

  function _fetch() {
    if (_loading) return _loading;
    _loading = fetch('/api/productos', _opts())
      .then(function(r) { return r.ok ? r.json() : { productos: [] }; })
      .then(function(d) { _items = Array.isArray(d.productos) ? d.productos : []; _index(); return _items; })
      .catch(function() { return []; });
    return _loading;
  }

  function _addOption(parent, value, label) {
    var o = document.createElement('option');
    o.value = value; o.textContent = label;
    parent.appendChild(o);
  }

  function _distinct(key) {
    var seen = {}, out = [];
    _items.forEach(function(p) { var v = p[key]; if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort();
  }

  window.Productos = {
    load: _fetch,
    list: function() { return _items.slice(); },
    metaFor: function(servicio) { return _byName[String(servicio || '').toUpperCase()] || null; },
    tipos: function() { return _distinct('tipo'); },
    sistemas: function() { return _distinct('sistema'); },

    // Tipos derivados de productos + modalidades extra del catálogo (ej. DOUBLE PLAY).
    // Requiere que window.Catalogos ya esté cargado (usar tras Catalogos.load()).
    tiposConExtra: function() {
      var base = _distinct('tipo');
      var extra = (window.Catalogos && window.Catalogos.items)
        ? window.Catalogos.items('tipo_extra').map(function(x) { return x.valor; })
        : [];
      extra.forEach(function(v) { if (v && base.indexOf(v) < 0) base.push(v); });
      return base;
    },

    scoreFor: function(servicio, riesgo, tipoServicio) {
      var q = '/api/productos/score?servicio=' + encodeURIComponent(servicio || '') +
        '&riesgo=' + encodeURIComponent(riesgo || '') + '&tipoServicio=' + encodeURIComponent(tipoServicio || '');
      return fetch(q, _opts())
        .then(function(r) { return r.ok ? r.json() : { score: 0 }; })
        .then(function(d) { return (d && d.score) || 0; })
        .catch(function() { return 0; });
    },

    fillSelect: function(sel, valorActual, placeholder) {
      if (!sel) return _fetch();
      return _fetch().then(function() {
        var cur = valorActual != null ? valorActual : sel.value;
        sel.innerHTML = '';
        if (placeholder !== false) _addOption(sel, '', placeholder || 'Elige');
        var lastCat = null, group = null;
        _items.forEach(function(p) {
          if (p.categoria !== lastCat) {
            group = document.createElement('optgroup');
            group.label = p.categoria || 'OTROS';
            sel.appendChild(group);
            lastCat = p.categoria;
          }
          _addOption(group || sel, p.servicio, p.servicio);
        });
        if (cur) {
          var exists = Array.from(sel.options).some(function(o) { return o.value === cur; });
          if (!exists) _addOption(sel, cur, cur + ' (actual)');
          sel.value = cur;
        }
      });
    },

    fillEnum: function(sel, values, current, placeholder) {
      if (!sel) return _fetch();
      return _fetch().then(function() {
        var cur = current != null ? current : sel.value;
        sel.innerHTML = '';
        if (placeholder !== false) _addOption(sel, '', placeholder || 'Elige');
        values.forEach(function(v) { _addOption(sel, v, v); });
        if (cur) {
          var exists = Array.from(sel.options).some(function(o) { return o.value === cur; });
          if (!exists) _addOption(sel, cur, cur);
          sel.value = cur;
        }
      });
    },
  };

  _fetch();
})();
