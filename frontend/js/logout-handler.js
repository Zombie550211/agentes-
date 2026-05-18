/**
 * Logout Handler - Maneja el cierre de sesión con modal estilizado
 */

(function() {
  'use strict';

  // ── MODAL DE CONFIRMACIÓN ──────────────────────────────────────────────────
  function injectModal() {
    if (document.getElementById('logout-modal')) return;

    const style = document.createElement('style');
    style.textContent = `
      #logout-modal-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(10, 14, 42, 0.60);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.22s ease;
        pointer-events: none;
      }
      #logout-modal-overlay.open {
        opacity: 1; pointer-events: all;
      }
      #logout-modal {
        background: #fff;
        border-radius: 18px;
        padding: 36px 40px 28px;
        max-width: 380px; width: 90%;
        box-shadow: 0 24px 60px rgba(0,0,0,0.22);
        text-align: center;
        transform: translateY(12px) scale(0.97);
        transition: transform 0.22s ease;
        font-family: 'Exo 2', 'Segoe UI', sans-serif;
      }
      #logout-modal-overlay.open #logout-modal {
        transform: translateY(0) scale(1);
      }
      #logout-modal .lm-icon {
        width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg, #fee2e2, #fecaca);
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 18px;
        font-size: 1.5rem; color: #dc2626;
      }
      #logout-modal h3 {
        margin: 0 0 8px;
        font-size: 1.25rem; font-weight: 800;
        color: #0f172a;
        font-family: 'Rajdhani', 'Segoe UI', sans-serif;
        letter-spacing: 0.03em;
      }
      #logout-modal p {
        margin: 0 0 28px;
        font-size: 0.92rem; color: #64748b; line-height: 1.55;
      }
      #logout-modal .lm-btns {
        display: flex; gap: 12px; justify-content: center;
      }
      #logout-modal .lm-cancel {
        flex: 1; padding: 11px 0;
        background: #f1f5f9; border: none; border-radius: 10px;
        color: #475569; font-weight: 700; font-size: 0.9rem;
        cursor: pointer; transition: background 0.17s;
        font-family: inherit;
      }
      #logout-modal .lm-cancel:hover { background: #e2e8f0; }
      #logout-modal .lm-confirm {
        flex: 1; padding: 11px 0;
        background: linear-gradient(135deg, #dc2626, #b91c1c);
        border: none; border-radius: 10px;
        color: #fff; font-weight: 800; font-size: 0.9rem;
        cursor: pointer; transition: opacity 0.17s, transform 0.17s;
        box-shadow: 0 4px 14px rgba(220,38,38,0.35);
        font-family: inherit;
      }
      #logout-modal .lm-confirm:hover { opacity: 0.88; transform: translateY(-1px); }
      body.dark-theme #logout-modal {
        background: #1e293b; color: #e2e8f0;
      }
      body.dark-theme #logout-modal h3 { color: #f1f5f9; }
      body.dark-theme #logout-modal p  { color: #94a3b8; }
      body.dark-theme #logout-modal .lm-cancel { background: #334155; color: #cbd5e1; }
      body.dark-theme #logout-modal .lm-cancel:hover { background: #475569; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'logout-modal-overlay';
    overlay.innerHTML = `
      <div id="logout-modal">
        <div class="lm-icon"><i class="fas fa-sign-out-alt"></i></div>
        <h3>Cerrar Sesión</h3>
        <p>¿Estás seguro de que deseas cerrar sesión?</p>
        <div class="lm-btns">
          <button class="lm-cancel" id="logout-cancel">Cancelar</button>
          <button class="lm-confirm" id="logout-confirm">Sí, cerrar sesión</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('logout-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  function openModal(onConfirm) {
    injectModal();
    const overlay = document.getElementById('logout-modal-overlay');
    const confirmBtn = document.getElementById('logout-confirm');
    // Limpiar listener anterior
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', function() {
      closeModal();
      onConfirm();
    });
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeModal() {
    const overlay = document.getElementById('logout-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  // ── LÓGICA DE LOGOUT ───────────────────────────────────────────────────────
  function doLogout() {
    let savedAvatars = null;
    try {
      const raw = localStorage.getItem('sidebarUserPhotos');
      if (raw) savedAvatars = JSON.parse(raw);
    } catch (_) {}

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    localStorage.removeItem('userId');
    localStorage.removeItem('userRole');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('allPagesData');
    sessionStorage.removeItem('costumerCacheUserId');
    sessionStorage.clear();

    if (savedAvatars) {
      try { localStorage.setItem('sidebarUserPhotos', JSON.stringify(savedAvatars)); } catch (_) {}
    }

    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        try { window.history.replaceState({}, document.title, '/'); } catch (_) {}
        window.location.replace('/login.html');
      });
  }

  function handleLogout(event) {
    event.preventDefault();
    event.stopPropagation();
    openModal(doLogout);
    return false;
  }

  // ── API PÚBLICA ────────────────────────────────────────────────────────────
  // window.confirmAsync(title, message) → Promise<boolean>
  window.confirmAsync = function(title, message) {
    return new Promise(function(resolve) {
      injectModal();
      const overlay = document.getElementById('logout-modal-overlay');
      const confirmBtn = document.getElementById('logout-confirm');
      const cancelBtn  = document.getElementById('logout-cancel');
      const h3 = overlay.querySelector('h3');
      const p  = overlay.querySelector('p');
      const icon = overlay.querySelector('.lm-icon i');

      // Personalizar texto
      if (h3) h3.textContent = title;
      if (p)  p.textContent  = message;
      if (icon) { icon.className = 'fas fa-exclamation-triangle'; icon.parentElement.style.background = 'linear-gradient(135deg,#fef9c3,#fde68a)'; icon.style.color = '#d97706'; }

      const newConfirm = confirmBtn.cloneNode(true);
      const newCancel  = cancelBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
      cancelBtn.parentNode.replaceChild(newCancel,  cancelBtn);

      newConfirm.style.background = 'linear-gradient(135deg,#7c3aed,#4f46e5)';
      newConfirm.style.boxShadow  = '0 4px 14px rgba(79,70,229,0.35)';
      newConfirm.textContent = 'Confirmar';

      newConfirm.addEventListener('click', function() { closeModal(); resetModal(); resolve(true); });
      newCancel.addEventListener('click',  function() { closeModal(); resetModal(); resolve(false); });
      requestAnimationFrame(() => overlay.classList.add('open'));
    });
  };

  function resetModal() {
    const overlay = document.getElementById('logout-modal-overlay');
    if (!overlay) return;
    const h3 = overlay.querySelector('h3');
    const p  = overlay.querySelector('p');
    const icon = overlay.querySelector('.lm-icon i');
    if (h3) h3.textContent = 'Cerrar Sesión';
    if (p)  p.textContent  = '¿Estás seguro de que deseas cerrar sesión?';
    if (icon) { icon.className = 'fas fa-sign-out-alt'; icon.parentElement.style.background = 'linear-gradient(135deg,#fee2e2,#fecaca)'; icon.style.color = '#dc2626'; }
    const btns = overlay.querySelectorAll('.lm-confirm');
    btns.forEach(b => { b.style.background = 'linear-gradient(135deg,#dc2626,#b91c1c)'; b.style.boxShadow = '0 4px 14px rgba(220,38,38,0.35)'; b.textContent = 'Sí, cerrar sesión'; });
  }

  // ── INICIALIZACIÓN ─────────────────────────────────────────────────────────
  let retryCount = 0;
  const MAX_RETRIES = 10;
  const RETRY_DELAY_MS = 300;

  function initLogoutHandler() {
    const logoutButtons = document.querySelectorAll('[data-logout-button], .btn-logout');
    if (logoutButtons.length === 0) {
      if (retryCount < MAX_RETRIES) { retryCount++; setTimeout(initLogoutHandler, RETRY_DELAY_MS); }
      return;
    }
    retryCount = 0;
    logoutButtons.forEach(btn => {
      btn.removeEventListener('click', handleLogout);
      btn.addEventListener('click', handleLogout, true);
    });
  }

  document.addEventListener('sidebar:loaded', initLogoutHandler);
  document.addEventListener('click', function(e) {
    try {
      const btn = e.target && e.target.closest && e.target.closest('[data-logout-button], .btn-logout');
      if (btn) return handleLogout(e);
    } catch (_) {}
  }, true);

  setTimeout(initLogoutHandler, 1000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogoutHandler);
  } else {
    initLogoutHandler();
  }

})();
