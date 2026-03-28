'use strict';
// ─────────────────────────────────────────────────────────────
//  crm-notifications.js
//  Sistema global de notificaciones CRM.
//  Se carga en TODAS las páginas vía sidebar-loader.js.
//  - Conecta socket.io y registra al usuario con su rol
//  - Muestra notificaciones estilo card (in-page) en todas las páginas
//  - Emite notificaciones nativas del OS cuando la pestaña está en background
//  - Maneja force-logout emitido por el admin
// ─────────────────────────────────────────────────────────────

(function () {
  // No inicializar dos veces
  if (window.__CRM_NOTIF_LOADED__) return;
  window.__CRM_NOTIF_LOADED__ = true;

  // ── Helpers ────────────────────────────────────────────────
  function getUserData() {
    try { return JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}'); } catch (_) { return {}; }
  }
  function escH(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function redirectToLogin() {
    const base = window.location.pathname.includes('/frontend/') ? '/frontend/login.html' : '/login.html';
    window.location.href = base;
  }

  // ── Card notifications ─────────────────────────────────────
  var _container = null;
  function getContainer() {
    if (!_container || !document.body.contains(_container)) {
      _container = document.createElement('div');
      _container.id = 'crm-notif-stack';
      _container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
      document.body.appendChild(_container);
    }
    return _container;
  }

  var TYPE_CFG = {
    status:  { color: '#6C47FF', bg: '#f0ecff', icon: '🔄', label: 'Cambio de Status'  },
    edicion: { color: '#f59e0b', bg: '#fffbeb', icon: '✏️',  label: 'Lead Editado'      },
    nota:    { color: '#10b981', bg: '#ecfdf5', icon: '📝',  label: 'Nota Agregada'     },
    deleted: { color: '#ef4444', bg: '#fef2f2', icon: '🗑️',  label: 'Lead Eliminado'    },
    info:    { color: '#3b82f6', bg: '#eff6ff', icon: 'ℹ️',  label: 'Notificación'      },
    warn:    { color: '#f59e0b', bg: '#fffbeb', icon: '⚠️',  label: 'Aviso'             },
  };

  if (!document.getElementById('crm-notif-kf')) {
    var style = document.createElement('style');
    style.id = 'crm-notif-kf';
    style.textContent = '@keyframes crm-shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}';
    document.head.appendChild(style);
  }

  function dismissCard(card) {
    card.style.opacity = '0';
    card.style.transform = 'translateX(360px)';
    setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 380);
  }

  window.showCRMNotif = function (tipo, data) {
    var cfg = TYPE_CFG[tipo] || TYPE_CFG.info;
    var actor   = data.actor   || '';
    var cliente = data.cliente || '';
    var detalle = data.detalle || '';
    var extra   = data.extra   || '';
    var hora    = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    var card = document.createElement('div');
    card.className = 'crm-notif-card';
    card.style.cssText = [
      'pointer-events:all;width:320px;background:#fff;border-radius:14px;',
      'box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;display:flex;flex-direction:column;',
      'transform:translateX(360px);transition:transform .35s cubic-bezier(.16,1,.3,1),opacity .35s;opacity:0;',
      'font-family:system-ui,sans-serif;'
    ].join('');

    card.innerHTML = [
      '<div style="height:4px;background:' + cfg.color + '"></div>',
      '<div style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start;">',
        '<div style="width:38px;height:38px;border-radius:10px;background:' + cfg.bg + ';display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">' + cfg.icon + '</div>',
        '<div style="flex:1;min-width:0;">',
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">',
            '<span style="font-size:.72rem;font-weight:700;color:' + cfg.color + ';text-transform:uppercase;letter-spacing:.04em;">' + cfg.label + '</span>',
            '<span style="font-size:.68rem;color:#9ca3af;">' + hora + '</span>',
          '</div>',
          (cliente ? '<div style="font-size:.85rem;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;">' + escH(cliente) + '</div>' : ''),
          (actor ? [
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">',
              '<div style="width:20px;height:20px;border-radius:50%;background:' + cfg.color + ';color:#fff;font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + escH(actor.charAt(0).toUpperCase()) + '</div>',
              '<span style="font-size:.78rem;color:#374151;font-weight:600;">' + escH(actor) + '</span>',
            '</div>'
          ].join('') : ''),
          (detalle ? '<div style="font-size:.76rem;color:#6b7280;margin-top:2px;">' + escH(detalle) + '</div>' : ''),
          (extra ? '<div style="font-size:.74rem;color:' + cfg.color + ';font-weight:600;margin-top:4px;padding:3px 8px;background:' + cfg.bg + ';border-radius:6px;display:inline-block;">' + escH(extra) + '</div>' : ''),
        '</div>',
        '<button style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:1rem;padding:0;line-height:1;flex-shrink:0;" onclick="this.closest(\'.crm-notif-card\').remove()">✕</button>',
      '</div>',
      '<div style="height:3px;background:' + cfg.color + ';transform-origin:left;animation:crm-shrink 6s linear forwards;"></div>'
    ].join('');

    getContainer().appendChild(card);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        card.style.transform = 'translateX(0)';
        card.style.opacity = '1';
      });
    });

    var timer = setTimeout(function () { dismissCard(card); }, 6000);
    card.addEventListener('mouseenter', function () { clearTimeout(timer); });
    card.addEventListener('mouseleave', function () { timer = setTimeout(function () { dismissCard(card); }, 3000); });

    // Notificación nativa del OS (solo cuando la pestaña no está visible)
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(cfg.label + (cliente ? ' — ' + cliente : ''), { body: (actor ? actor + ': ' : '') + detalle, icon: '/favicon.ico' }); } catch (_) {}
    }
  };

  // Retrocompatibilidad
  window.showWinNotif = function (title, body) {
    window.showCRMNotif('info', { cliente: title, detalle: body, actor: '' });
  };

  // ── Permiso de notificaciones ──────────────────────────────
  function initNotifPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    var banner = document.createElement('div');
    banner.id = 'crm-notif-banner';
    banner.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99998;background:#1e1b4b;color:#fff;border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.3);font-size:.82rem;max-width:320px;font-family:system-ui,sans-serif;';
    banner.innerHTML = '<span style="font-size:1.3rem">🔔</span><span style="flex:1;line-height:1.4;">Activa las notificaciones para recibir alertas en tiempo real</span><button id="crm-notif-allow" style="background:#6C47FF;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap;">Activar</button><button id="crm-notif-dismiss" style="background:transparent;color:#aaa;border:none;cursor:pointer;font-size:1rem;padding:0 2px;">✕</button>';
    document.body.appendChild(banner);
    document.getElementById('crm-notif-allow').addEventListener('click', function () {
      Notification.requestPermission().then(function (p) {
        banner.remove();
        if (p === 'granted') showCRMNotif('info', { cliente: 'Notificaciones activadas', detalle: 'Recibirás alertas de cambios en tiempo real', actor: '' });
      });
    });
    document.getElementById('crm-notif-dismiss').addEventListener('click', function () { banner.remove(); });
  }

  // ── Popup anuncio único ────────────────────────────────────
  function initAnnouncement() {
    if (localStorage.getItem('crm_notif_announcement_v1')) return;
    setTimeout(function () {
      if (localStorage.getItem('crm_notif_announcement_v1')) return; // doble check
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);font-family:system-ui,sans-serif;';
      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.3);">',
          '<div style="background:linear-gradient(135deg,#6C47FF,#a855f7);padding:28px 28px 20px;color:#fff;text-align:center;">',
            '<div style="font-size:2.5rem;margin-bottom:8px;">🔔</div>',
            '<div style="font-size:1.2rem;font-weight:700;margin-bottom:4px;">Sistema de Notificaciones</div>',
            '<div style="font-size:.82rem;opacity:.85;">Ya está activo en el CRM — en todas las páginas</div>',
          '</div>',
          '<div style="padding:24px 28px;">',
            '<ul style="list-style:none;padding:0;margin:0 0 20px;display:flex;flex-direction:column;gap:12px;">',
              '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">🔄</span><div><strong style="display:block;font-size:.85rem;color:#111;">Cambio de status</strong><span style="font-size:.78rem;color:#6b7280;">Alerta cuando se modifica el status de un lead</span></div></li>',
              '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">✏️</span><div><strong style="display:block;font-size:.85rem;color:#111;">Edición de leads</strong><span style="font-size:.78rem;color:#6b7280;">Notificación cuando un agente edita información</span></div></li>',
              '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">📝</span><div><strong style="display:block;font-size:.85rem;color:#111;">Notas nuevas</strong><span style="font-size:.78rem;color:#6b7280;">Alerta cuando se agrega una nota a tu cliente</span></div></li>',
              '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">⚡</span><div><strong style="display:block;font-size:.85rem;color:#111;">Funciona en todas las páginas</strong><span style="font-size:.78rem;color:#6b7280;">No necesitas estar en Costumer para recibirlas</span></div></li>',
            '</ul>',
            '<button id="crm-ann-activate" style="width:100%;background:#6C47FF;color:#fff;border:none;border-radius:12px;padding:13px;font-size:.9rem;font-weight:700;cursor:pointer;">Activar notificaciones ahora</button>',
            '<button id="crm-ann-skip" style="width:100%;background:none;border:none;color:#9ca3af;font-size:.78rem;cursor:pointer;margin-top:8px;padding:6px;">Quizás más tarde</button>',
          '</div>',
        '</div>'
      ].join('');
      document.body.appendChild(overlay);
      document.getElementById('crm-ann-activate').addEventListener('click', function () {
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().then(function (p) {
            if (p === 'granted') showCRMNotif('info', { cliente: 'Notificaciones activadas', detalle: 'Recibirás alertas en tiempo real desde cualquier página', actor: '' });
          });
        }
        localStorage.setItem('crm_notif_announcement_v1', '1');
        overlay.remove();
      });
      document.getElementById('crm-ann-skip').addEventListener('click', function () {
        localStorage.setItem('crm_notif_announcement_v1', '1');
        overlay.remove();
      });
    }, 1500);
  }

  // ── Socket.io ──────────────────────────────────────────────
  function initSocket() {
    if (window.__CRM_SOCKET__) return;
    if (typeof io !== 'function') return;

    var ud = getUserData();
    var userRole = String(ud.role || ud.rol || '').toLowerCase();
    var userName = ud.username || ud.name || '';

    var socket = io({ transports: ['websocket', 'polling'], withCredentials: true });
    window.__CRM_SOCKET__ = socket;

    socket.on('connect', function () {
      socket.emit('register', { username: userName, role: userRole });
      console.log('[CRM-NOTIF] Socket conectado | usuario:', userName, '| rol:', userRole);
    });

    // Nota agregada al propio lead
    socket.on('note-added', function (p) {
      showCRMNotif('nota', { cliente: p.clientName, actor: p.author, detalle: 'Agregó una nota al lead' });
    });

    // Eventos solo para admins/backoffice
    var isAdmin = ['admin', 'administrador', 'administrator', 'backoffice', 'back office', 'back_office', 'b.o', 'bo'].some(function (r) {
      return userRole === r || userRole.includes(r);
    });

    if (isAdmin) {
      socket.on('lead-updated', function (p) {
        var detalle = p.tipo === 'status'  ? 'Cambió el status del lead'
                    : p.tipo === 'nota'    ? 'Agregó una nota'
                    : 'Editó la información del lead';
        var extra = (p.tipo === 'status' && p.status) ? 'Nuevo status: ' + p.status : '';
        showCRMNotif(p.tipo || 'edicion', { cliente: p.clientName, actor: p.actor, detalle: detalle, extra: extra });
      });

      socket.on('lead-deleted', function (p) {
        showCRMNotif('deleted', { cliente: 'ID ...' + String(p.leadId || '').slice(-6), actor: p.actor, detalle: 'Eliminó un lead del sistema' });
      });
    }

    // Force logout emitido por el admin
    socket.on('force-logout', function () {
      showCRMNotif('warn', { cliente: 'Sesión cerrada', detalle: 'El administrador cerró todas las sesiones', actor: '' });
      setTimeout(function () { redirectToLogin(); }, 2500);
    });
  }

  // ── Cargar socket.io si no está disponible aún ─────────────
  function ensureSocketIO(cb) {
    if (typeof io === 'function') { cb(); return; }
    var s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = cb;
    s.onerror = function () { console.warn('[CRM-NOTIF] socket.io no disponible'); };
    document.head.appendChild(s);
  }

  // ── Inicializar cuando el DOM esté listo ───────────────────
  function init() {
    initNotifPermission();
    initAnnouncement();
    ensureSocketIO(initSocket);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
