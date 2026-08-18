/**
 * User Info - Actualiza info del usuario en el sidebar.
 * Ruta rápida: lee window.__homeData (set por residencial/inicio.html).
 * Fallback: verify-server + leads para páginas que no usan dashboard/home.
 */

(function() {
  'use strict';

  const _roleMap = {
    admin: 'Administrador', administrador: 'Administrador', administradora: 'Administrador',
    supervisor: 'Supervisor', agente: 'Agente', agent: 'Agente',
    backoffice: 'Backoffice', bo: 'Backoffice'
  };

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _applyUser(user, stats) {
    const displayName = (user.name || user.username || '').trim() || 'Usuario';
    const roleLabel   = _roleMap[(user.role || '').toLowerCase()] || (user.role || 'Rol');

    // Solo actualizar elementos fuera del sidebar (topbar, etc.)
    _setText('topbar-user-name', displayName);
    _setText('topbar-user-role', roleLabel);

    // Ocultar user-info del sidebar si aún existe
    document.querySelectorAll('.sidebar .user-info, .sidebar .user-details, .sidebar .user-name, .sidebar .user-role, .sidebar .avatar-wrapper').forEach(el => {
      el.style.setProperty('display', 'none', 'important');
    });

    if (stats) {
      if (stats.ventas !== undefined) _setText('sidebar-user-sales',  stats.ventas);
      if (stats.puntos !== undefined) _setText('sidebar-user-points', stats.puntos);
    }
  }

  function _fromHomeData() {
    const hd = window.__homeData;
    if (!hd) return false;
    _applyUser(hd.user || {}, hd.user_stats || {});
    return true;
  }

  // Solo para páginas que no tienen dashboard/home — solo necesitamos nombre y rol
  let _fallbackDone = false;
  async function _fallback() {
    if (_fallbackDone || window.__homeData) return;
    _fallbackDone = true;
    try {
      const r = await fetch('/api/auth/verify-server', { credentials: 'include' });
      if (!r.ok) return;
      const j    = await r.json();
      if (!j.authenticated) return;
      const user = j.user || j;
      _applyUser(user, null);
    } catch (e) {
      console.error('[user-info] error:', e);
    }
  }

  function init() {
    if (_fromHomeData()) return;
    document.addEventListener('crm:data-ready', () => _fromHomeData(), { once: true });
    // Si tras 350ms no hay __homeData, estamos en otra página — usar la API
    setTimeout(() => { if (!window.__homeData) _fallback(); }, 350);
  }

  document.addEventListener('sidebar:loaded',   () => setTimeout(init, 50));
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 150));

  window.loadUserStats = init;
})();
