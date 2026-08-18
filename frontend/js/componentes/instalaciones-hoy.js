'use strict';
// ─────────────────────────────────────────────────────────────
//  instalaciones-hoy.js
//  Alerta de instalaciones programadas para HOY.
//  Se carga en todas las páginas vía sidebar-loader.js, pero solo
//  se muestra al ENTRAR al CRM (inicio/index) o a las listas de
//  clientes (costumer de Líneas y de Residencial).
//  Dirigida a agentes, supervisores y administradores: el backend
//  limita el alcance (agente → sus clientes, supervisor → su
//  equipo, admin → todos).
// ─────────────────────────────────────────────────────────────

(function () {
  if (window.__CRM_INSTALL_ALERT__) return;
  window.__CRM_INSTALL_ALERT__ = true;

  function getUser() {
    try { return JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}'); }
    catch (_) { return {}; }
  }
  function escH(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Solo en páginas de entrada al CRM o listas de clientes
  var path = (window.location.pathname || '').toLowerCase();
  var isEntryPage =
    /\/inicio\.html$/.test(path) ||
    /\/index\.html$/.test(path) ||
    path === '/' || path === '/frontend/' ||
    /\/costumer\.html$/.test(path);
  if (!isEntryPage) return;

  // Dirigido a agentes, supervisores y administradores (backoffice queda fuera).
  // Admin ve TODAS las instalaciones del día (el backend no le acota el alcance).
  var user = getUser();
  var role = String(user.role || '').toLowerCase();
  if (!role) return;
  if (/backoffice|back_office/.test(role)) return;
  var isSupervisor = role.indexOf('supervisor') !== -1 || /admin/.test(role);

  var STATUS_COLORS = {
    pending:     '#f59e0b',
    rescheduled: '#a855f7',
    completed:   '#10b981',
    repro:       '#a855f7'
  };
  function statusColor(st) {
    var v = String(st || '').toLowerCase();
    for (var k in STATUS_COLORS) { if (v.indexOf(k) !== -1) return STATUS_COLORS[k]; }
    return '#3b82f6';
  }

  function rowHTML(c, seccion) {
    var color = statusColor(c.status);
    return [
      '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);">',
        '<div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1rem;background:rgba(59,130,246,0.15);">',
          (seccion === 'lineas' ? '📱' : '🏠'),
        '</div>',
        '<div style="flex:1;min-width:0;">',
          '<div style="font-weight:700;font-size:.85rem;color:#f3f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escH(c.nombre || '(sin nombre)') + '</div>',
          '<div style="font-size:.75rem;color:#9ca3af;margin-top:2px;">',
            (c.telefono ? '📞 ' + escH(c.telefono) : ''),
            (c.direccion ? ' &nbsp;·&nbsp; 📍 ' + escH(c.direccion) : ''),
          '</div>',
          (isSupervisor && c.agente ? '<div style="font-size:.72rem;color:#60a5fa;margin-top:2px;">👤 ' + escH(c.agente) + '</div>' : ''),
        '</div>',
        '<span style="flex-shrink:0;font-size:.68rem;font-weight:700;text-transform:uppercase;color:' + color + ';background:' + color + '22;padding:3px 8px;border-radius:6px;">' + escH(c.status || 'pending') + '</span>',
      '</div>'
    ].join('');
  }

  function sectionHTML(titulo, icono, items, seccion, href) {
    if (!items || !items.length) return '';
    return [
      '<div style="margin-bottom:14px;">',
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">',
          '<span style="font-size:.78rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#93c5fd;">' + icono + ' ' + titulo + ' (' + items.length + ')</span>',
          '<a href="' + href + '" style="font-size:.72rem;font-weight:700;color:#60a5fa;text-decoration:none;">Ver lista →</a>',
        '</div>',
        '<div style="display:flex;flex-direction:column;gap:8px;">',
          items.map(function (c) { return rowHTML(c, seccion); }).join(''),
        '</div>',
      '</div>'
    ].join('');
  }

  function showModal(data) {
    if (document.getElementById('crm-install-alert')) return;

    var overlay = document.createElement('div');
    overlay.id = 'crm-install-alert';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .3s;';

    var fechaTxt = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

    var modal = document.createElement('div');
    modal.style.cssText = 'width:min(560px,100%);max-height:82vh;display:flex;flex-direction:column;background:rgba(17,24,39,0.97);border:1px solid rgba(255,255,255,0.12);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;font-family:system-ui,sans-serif;color:#fff;transform:translateY(16px);transition:transform .3s cubic-bezier(.16,1,.3,1);';
    modal.innerHTML = [
      '<div style="height:4px;background:linear-gradient(90deg,#3b82f6,#8b5cf6);"></div>',
      '<div style="padding:18px 20px 12px;display:flex;align-items:flex-start;gap:12px;">',
        '<div style="width:44px;height:44px;border-radius:12px;background:rgba(59,130,246,0.18);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">🛠️</div>',
        '<div style="flex:1;">',
          '<div style="font-size:1.02rem;font-weight:800;">Instalaciones para HOY</div>',
          '<div style="font-size:.76rem;color:#9ca3af;text-transform:capitalize;margin-top:2px;">' + escH(fechaTxt) + ' · ' + data.total + (data.total === 1 ? ' cliente' : ' clientes') + '</div>',
        '</div>',
        '<button id="crm-install-close" style="background:rgba(255,255,255,0.08);border:none;color:#e5e7eb;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:1rem;line-height:1;">✕</button>',
      '</div>',
      '<div style="padding:4px 20px 16px;overflow-y:auto;">',
        sectionHTML('Residencial', '🏠', data.residencial, 'residencial', '/residencial/costumer.html'),
        sectionHTML('Líneas', '📱', data.lineas, 'lineas', '/lineas/costumer.html'),
      '</div>',
      '<div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;">',
        '<button id="crm-install-ok" style="background:linear-gradient(90deg,#3b82f6,#6366f1);border:none;color:#fff;font-weight:700;font-size:.82rem;padding:9px 22px;border-radius:9px;cursor:pointer;">Entendido</button>',
      '</div>'
    ].join('');

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
      modal.style.transform = 'translateY(0)';
    });

    function close() {
      overlay.style.opacity = '0';
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    modal.querySelector('#crm-install-close').addEventListener('click', close);
    modal.querySelector('#crm-install-ok').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }

  function init() {
    fetch('/api/instalaciones/hoy?fecha=' + todayLocal(), { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.success && data.total > 0) showModal(data);
      })
      .catch(function () { /* silencioso: la alerta nunca debe romper la página */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
