(function () {
  'use strict';

  // No activar en táctil ni en login/register
  if ('ontouchstart' in window) return;
  const path = window.location.pathname;
  if (/login|register|reset-password/.test(path)) return;

  /* ── Inyectar estilos ── */
  const css = `
    body { cursor: none !important; }
    a, button, [role="button"], input, select, textarea, label,
    .nav-item, .btn-sidebar, .footer-action, .btn { cursor: none !important; }

    .crm-smooth-cursor {
      pointer-events: none;
      position: fixed;
      z-index: 99999;
      top: 0; left: 0;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      mix-blend-mode: difference;
      transition: opacity .2s ease;
      will-change: transform;
    }

    .crm-smooth-cursor__dot {
      width: 10px; height: 10px;
      background: #fff;
      border-radius: 50%;
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      transition: transform .15s ease, background .2s ease;
    }

    .crm-smooth-cursor__ring {
      width: 36px; height: 36px;
      border: 2px solid rgba(255,255,255,.55);
      border-radius: 50%;
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      transition: transform .25s ease, border-color .2s ease, width .25s ease, height .25s ease;
    }

    body.crm-cursor-hover .crm-smooth-cursor__dot {
      transform: translate(-50%, -50%) scale(0.4);
    }
    body.crm-cursor-hover .crm-smooth-cursor__ring {
      width: 50px; height: 50px;
      border-color: rgba(99,102,241,.8);
    }

    body.crm-cursor-click .crm-smooth-cursor__dot {
      transform: translate(-50%, -50%) scale(1.6);
    }
    body.crm-cursor-click .crm-smooth-cursor__ring {
      width: 24px; height: 24px;
      border-color: rgba(255,255,255,.9);
    }
  `;
  const style = document.createElement('style');
  style.id = 'crm-smooth-cursor-styles';
  style.textContent = css;
  document.head.appendChild(style);

  /* ── Crear elemento ── */
  const cursor = document.createElement('div');
  cursor.className = 'crm-smooth-cursor';
  cursor.innerHTML = '<div class="crm-smooth-cursor__ring"></div><div class="crm-smooth-cursor__dot"></div>';
  document.body.appendChild(cursor);

  /* ── Spring state ── */
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let cx = mx, cy = my;
  const LERP = 0.12;

  document.addEventListener('mousemove', function (e) {
    mx = e.clientX;
    my = e.clientY;
  }, { passive: true });

  /* ── Hover / click detection ── */
  const HOVER_SEL = 'a,button,input,select,textarea,label,[role="button"],.nav-item,.btn-sidebar,.footer-action,.btn,.clickable,.avatar-edit-btn,.avatar-remove-btn';

  document.addEventListener('mouseover', function (e) {
    if (e.target && e.target.closest && e.target.closest(HOVER_SEL)) {
      document.body.classList.add('crm-cursor-hover');
    }
  }, { passive: true });

  document.addEventListener('mouseout', function (e) {
    if (e.target && e.target.closest && e.target.closest(HOVER_SEL)) {
      document.body.classList.remove('crm-cursor-hover');
    }
  }, { passive: true });

  document.addEventListener('mousedown', function () {
    document.body.classList.add('crm-cursor-click');
  }, { passive: true });

  document.addEventListener('mouseup', function () {
    document.body.classList.remove('crm-cursor-click');
  }, { passive: true });

  /* ── RAF loop ── */
  function tick() {
    cx += (mx - cx) * LERP;
    cy += (my - cy) * LERP;
    cursor.style.transform = 'translate(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px) translate(-50%,-50%)';
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
