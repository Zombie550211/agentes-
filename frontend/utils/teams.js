/**
 * utils/teams.js
 * API global window.Teams — carga equipos desde el backend y provee helpers.
 */
(function () {
  'use strict';

  var _teams = [];
  var _loaded = false;
  var _loading = null;

  function norm(s) {
    try {
      return String(s || '').normalize('NFD').replace(/\p{Diacritic}+/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
    } catch (_) {
      return String(s || '').trim().toLowerCase();
    }
  }

  function _fetch() {
    if (_loading) return _loading;
    _loading = fetch('/api/teams', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { teams: [] }; })
      .then(function (data) {
        _teams = Array.isArray(data.teams) ? data.teams : [];
        _loaded = true;
        return _teams;
      })
      .catch(function () {
        _loaded = true;
        return [];
      });
    return _loading;
  }

  window.Teams = {
    /** Carga los teams desde la API (idempotente). */
    load: function () { return _fetch(); },

    /** Devuelve el array de teams cargados. */
    all: function () { return _teams.slice(); },

    /**
     * Devuelve el nombre del team al que pertenece un usuario.
     * @param {Object} user  objeto con {team, username, name, ...}
     */
    getTeamForUser: function (user) {
      if (!user) return '';
      // Primero usar el campo team del objeto usuario
      if (user.team) return user.team;
      // Buscar por username/name en la lista de teams cargada
      var candidates = [user.username, user.name, user.nombre, user.fullName]
        .map(norm).filter(Boolean);
      for (var i = 0; i < _teams.length; i++) {
        var t = _teams[i];
        var supNorm = norm(t.supervisor || '');
        var supNameNorm = norm(t.supervisorName || '');
        if (candidates.some(function (c) { return c === supNorm || c === supNameNorm; })) {
          return t.value;
        }
      }
      return '';
    },

    /**
     * Normaliza un nombre de team al valor canónico.
     * @param {string} raw
     */
    normalize: function (raw) {
      var r = norm(raw);
      for (var i = 0; i < _teams.length; i++) {
        var t = _teams[i];
        if (norm(t.value) === r || norm(t.label) === r) return t.value;
      }
      return raw;
    },
  };

  // Cargar en background tan pronto como el script cargue
  _fetch();
})();
