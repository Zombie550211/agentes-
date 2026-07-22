/**
 * Sidebar — tarjeta de usuario (avatar + nombre + rol) con edición de foto.
 */
(function () {
  'use strict';

  const ROLE_LABELS = {
    admin: 'Administrador', administrador: 'Administrador', administradora: 'Administrador',
    administrator: 'Administrador', supervisor: 'Supervisor', agente: 'Agente', agent: 'Agente',
    backoffice: 'Backoffice', 'back office': 'Backoffice', back_office: 'Backoffice', bo: 'Backoffice',
    rol_icon: 'Icon', rol_bamo: 'Bamo',
  };

  const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0][0] || '';
    const last = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + last).toUpperCase();
  }

  function roleLabel(role) {
    const key = String(role || '').trim().toLowerCase();
    return ROLE_LABELS[key] || (role ? String(role) : 'Usuario');
  }

  function setAvatar(url) {
    const img = document.getElementById('sb-user-avatar-img');
    const span = document.getElementById('sb-user-initials');
    if (!img || !span) return;
    if (url) {
      img.src = url;
      img.hidden = false;
      span.hidden = true;
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      span.hidden = false;
    }
  }

  function applyUser(user) {
    if (!user) return;
    const nameEl = document.getElementById('sb-user-name');
    const roleEl = document.getElementById('sb-user-role');
    const initialsEl = document.getElementById('sb-user-initials');
    const displayName = (user.name || user.username || '').trim() || 'Usuario';
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = roleLabel(user.role);
    if (initialsEl) initialsEl.textContent = initials(displayName);
    const avatarUrl = user.avatarUrl || user.avatar_url || '';
    if (avatarUrl) setAvatar(avatarUrl);
  }

  function fromLocalUser() {
    try {
      const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && (parsed.username || parsed.name) ? parsed : null;
    } catch (_) { return null; }
  }

  async function fromServer() {
    try {
      const res = await fetch('/api/auth/verify-server', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.authenticated || !data.user) return null;
      return data.user;
    } catch (_) { return null; }
  }

  function persistLocalAvatar(url) {
    try {
      const store = localStorage.getItem('user') ? localStorage : (sessionStorage.getItem('user') ? sessionStorage : null);
      if (!store) return;
      const parsed = JSON.parse(store.getItem('user'));
      parsed.avatarUrl = url;
      store.setItem('user', JSON.stringify(parsed));
    } catch (_) {}
  }

  function setupEdit() {
    const btn = document.getElementById('sb-user-edit-btn');
    const input = document.getElementById('sb-user-avatar-input');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        alert('El archivo debe ser una imagen.');
        return;
      }
      if (file.size > MAX_AVATAR_BYTES) {
        alert('La imagen no puede superar 4 MB.');
        return;
      }

      btn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('avatar', file);
        const res = await fetch('/api/users/me/avatar', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.success) {
          throw new Error((data && data.message) || 'No se pudo actualizar la foto');
        }
        const url = data.data && data.data.url;
        if (url) {
          setAvatar(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
          persistLocalAvatar(url);
        }
      } catch (e) {
        console.error('[sidebar-user] error al subir avatar:', e);
        alert('No se pudo actualizar la foto de perfil. Intenta de nuevo.');
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function init() {
    const local = fromLocalUser();
    if (local) applyUser(local);

    const server = await fromServer();
    if (server) applyUser(server);

    setupEdit();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
