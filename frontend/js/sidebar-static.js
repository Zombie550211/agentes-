/**
 * Sidebar estático — el HTML del menú ya está en la página (sin generación por JS).
 * Este script solo decide si mostrar las secciones marcadas [data-admin-only].
 */
(function () {
  'use strict';

  function normalizeRole(roleRaw) {
    const r = (roleRaw == null ? '' : String(roleRaw)).trim().toLowerCase();
    if (['admin', 'administrator', 'administrador', 'administradora'].includes(r)) return 'admin';
    if (['backoffice', 'back office', 'back_office', 'bo', 'rol_icon', 'rol_bamo'].includes(r)) return 'backoffice';
    return r;
  }

  function applyAdminVisibility(role) {
    const normalized = normalizeRole(role);
    const isAdmin = normalized === 'admin' || normalized === 'backoffice';
    document.body.classList.toggle('sb-is-admin', isAdmin);
  }

  async function getRole() {
    try {
      const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.role) return parsed.role;
      }
    } catch (_) {}

    try {
      if (window.__homeDataPromise) {
        const hd = await window.__homeDataPromise;
        if (hd && hd.user && hd.user.role) return hd.user.role;
      }
      if (window.__homeData && window.__homeData.user && window.__homeData.user.role) {
        return window.__homeData.user.role;
      }
    } catch (_) {}

    try {
      const response = await fetch('/api/auth/verify-server', { method: 'GET', credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data && data.authenticated && data.user) return data.user.role;
      }
    } catch (_) {}

    return null;
  }

  getRole().then(applyAdminVisibility);
})();
