/**
 * Aviso por llamadas de verificación/seguimiento pendientes.
 *
 * Consulta /api/leads/llamadas-pendientes; si el usuario tiene llamadas
 * vencidas se le AVISA (notificación + banner superior), pero NO se bloquea
 * el CRM: puede seguir trabajando y creando leads con normalidad.
 *
 * El aviso se muestra en cada carga de página (siempre les llega), con acceso
 * directo a costumer.html?llamadas=1, donde se ven solo los leads por llamar y
 * se registra la llamada (captura de Xencall + nota) desde editar cliente.
 *
 * Para reactivar el bloqueo duro: poner BLOQUEO_ACTIVO = true aquí y volver a
 * habilitar el 423 en CRM_PYTHON/routers/leads.py (create_lead).
 */
(function () {
  'use strict';

  // No aplicar en login / páginas públicas
  var path = (window.location.pathname || '').toLowerCase();
  if (path.indexOf('login') !== -1 || path.indexOf('register') !== -1 || path.indexOf('crear-cuenta') !== -1) return;

  // En el modo lista de llamadas ya se está resolviendo: solo banner
  var inLlamadasMode = /[?&]llamadas=1/.test(window.location.search || '');

  function fmtPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    return p || '—';
  }

  function goLeads()  { window.location.href = '/residencial/costumer.html?llamadas=1'; }
  function goLineas() { window.location.href = '/lineas/costumer.html?llamadas=1'; }

  /** Card de notificación (usa el sistema global; espera a que cargue). */
  function notifCard(data, intentos) {
    if (typeof window.showCRMNotif !== 'function') {
      if ((intentos || 0) > 20) return; // ~10 s: el sistema global no cargó
      setTimeout(function () { notifCard(data, (intentos || 0) + 1); }, 500);
      return;
    }
    var leads = data.leads || [];
    var primero = leads[0] || {};
    window.showCRMNotif('warn', {
      cliente: 'Tienes ' + data.total + ' cliente(s) por llamar',
      actor:   '',
      detalle: leads.length === 1
        ? (primero.nombre_cliente || '') + ' · ' + fmtPhone(primero.telefono)
        : 'Registra la llamada: captura de Xencall + nota en editar cliente',
      extra:   'Abre tu lista de clientes por llamar',
    });
  }

  /** Banner superior no bloqueante, con acceso directo y botón de cerrar. */
  function buildBanner(data) {
    if (document.getElementById('llamadas-bloqueo-banner')) return;
    var leads = data.leads || [];
    var hasLeads  = leads.some(function (l) { return l.source !== 'lineas'; });
    var hasLineas = leads.some(function (l) { return l.source === 'lineas'; });

    var b = document.createElement('div');
    b.id = 'llamadas-bloqueo-banner';
    b.setAttribute('style',
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#7f1d1d,#991b1b);color:#fff;' +
      'padding:9px 18px;font-size:.78rem;font-weight:700;font-family:\'Outfit\',\'Segoe UI\',sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;');

    var btnCss = 'background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);color:#fff;' +
      'border-radius:8px;padding:4px 12px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;';

    b.innerHTML =
      '<span>📞 Tienes <strong>' + data.total + '</strong> cliente(s) por llamar. Sube la captura de Xencall y agrega la nota de la llamada en editar cliente.</span>' +
      (hasLeads  ? '<button id="llb-go-btn" style="' + btnCss + '">Ver lista</button>' : '') +
      (hasLineas ? '<button id="llb-go-lineas-btn" style="' + btnCss + '">Ver lista (Líneas)</button>' : '') +
      '<button id="llb-close-btn" title="Ocultar aviso" style="background:none;border:none;color:rgba(255,255,255,.75);font-size:.95rem;cursor:pointer;padding:0 4px;line-height:1;">✕</button>';

    document.body.appendChild(b);
    document.body.style.paddingTop = b.offsetHeight + 4 + 'px';

    var goBtn = document.getElementById('llb-go-btn');
    if (goBtn) goBtn.addEventListener('click', goLeads);
    var goLineasBtn = document.getElementById('llb-go-lineas-btn');
    if (goLineasBtn) goLineasBtn.addEventListener('click', goLineas);
    var closeBtn = document.getElementById('llb-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      b.remove();
      document.body.style.paddingTop = '';
    });
  }

  function avisar(data) {
    buildBanner(data);
    if (!inLlamadasMode) notifCard(data, 0);
  }

  async function check() {
    // Modo demo: ?demoBloqueo=1 muestra el aviso con datos de ejemplo
    if (/[?&]demoBloqueo=1/.test(window.location.search || '')) {
      avisar({
        blocked: true, total: 2,
        leads: [
          { nombre_cliente: 'JOSE NOE MARTINEZ RIVERA', telefono: '5737684651', numero_llamada: 1, tipo_llamada: 'verificacion' },
          { nombre_cliente: 'MARIA LOPEZ GARCIA', telefono: '8135038926', numero_llamada: 2, tipo_llamada: 'seguimiento' },
        ],
      });
      return;
    }
    try {
      var res = await fetch('/api/leads/llamadas-pendientes', {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return; // 401/403/500 → sin aviso
      var data = await res.json();
      if (!data || !data.blocked) return;
      window.__llamadasPendientes = data;
      avisar(data);
    } catch (_) { /* sin red → sin aviso */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
