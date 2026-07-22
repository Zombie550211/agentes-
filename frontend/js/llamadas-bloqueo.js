/**
 * Bloqueo por llamadas de verificación/seguimiento pendientes.
 *
 * Consulta /api/leads/llamadas-pendientes; si el usuario tiene llamadas
 * vencidas, bloquea todo el CRM con un modal de pantalla completa.
 * Única salida: "Ir a Lista de clientes" → costumer.html?llamadas=1,
 * donde se muestran solo los leads por llamar y se registra la llamada
 * (captura de Xencall + nota) desde editar cliente.
 */
(function () {
  'use strict';

  // No aplicar en login / páginas públicas
  var path = (window.location.pathname || '').toLowerCase();
  if (path.indexOf('login') !== -1 || path.indexOf('register') !== -1 || path.indexOf('crear-cuenta') !== -1) return;

  // En el modo lista de llamadas, no tapar la página: ahí se resuelve el bloqueo
  var inLlamadasMode = /[?&]llamadas=1/.test(window.location.search || '');

  function fmtPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    return p || '—';
  }

  function buildModal(data) {
    var leads = data.leads || [];
    var rows = leads.map(function (l) {
      var tipo = l.tipo_llamada === 'seguimiento' ? 'Seguimiento' : 'Verificación';
      var srcBadge = l.source === 'lineas'
        ? '<span style="font-size:.58rem;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(56,189,248,.15);border:1px solid rgba(56,189,248,.3);color:#38bdf8;margin-left:6px;">LÍNEAS</span>'
        : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:10px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-weight:700;font-size:.85rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (l.nombre_cliente || '—') + srcBadge + '</div>' +
          '<div style="font-size:.78rem;color:rgba(255,255,255,.65);font-family:monospace;">' + fmtPhone(l.telefono) + '</div>' +
        '</div>' +
        '<span style="flex-shrink:0;font-size:.62rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#f87171;white-space:nowrap;">Llamada ' + (l.numero_llamada || 1) + '/2 · ' + tipo + '</span>' +
      '</div>';
    }).join('');

    var hasLeads  = leads.some(function (l) { return l.source !== 'lineas'; });
    var hasLineas = leads.some(function (l) { return l.source === 'lineas'; });
    var btns = '';
    if (hasLeads)  btns += '<button id="llb-go-btn" style="width:100%;padding:13px;border:none;border-radius:12px;background:#2563eb;color:#fff;font-size:.88rem;font-weight:800;cursor:pointer;font-family:inherit;">Ir a Lista de clientes</button>';
    if (hasLineas) btns += '<button id="llb-go-lineas-btn" style="width:100%;padding:13px;border:none;border-radius:12px;background:#0ea5e9;color:#fff;font-size:.88rem;font-weight:800;cursor:pointer;font-family:inherit;' + (hasLeads ? 'margin-top:8px;' : '') + '">Ir a Lista de clientes (Líneas)</button>';

    var overlay = document.createElement('div');
    overlay.id = 'llamadas-bloqueo-overlay';
    overlay.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;background:rgba(5,10,20,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;');
    overlay.innerHTML =
      '<div style="max-width:520px;width:100%;background:#10161f;border:1px solid rgba(239,68,68,.35);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.6);padding:28px;font-family:\'Outfit\',\'Segoe UI\',sans-serif;">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">' +
          '<div style="width:42px;height:42px;border-radius:12px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📞</div>' +
          '<div>' +
            '<div style="font-size:1.05rem;font-weight:800;color:#fff;">Tienes clientes completados por llamar</div>' +
            '<div style="font-size:.72rem;color:#f87171;font-weight:600;">Tu cuenta está bloqueada hasta registrar las llamadas</div>' +
          '</div>' +
        '</div>' +
        '<div style="max-height:240px;overflow-y:auto;scrollbar-width:none;display:flex;flex-direction:column;gap:8px;margin:16px 0;" class="llb-list">' + rows + '</div>' +
        '<div style="font-size:.76rem;color:rgba(255,255,255,.6);line-height:1.55;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 14px;margin-bottom:18px;">' +
          'Debes llamar a cada cliente y, en <strong style="color:#fff;">editar cliente</strong>, subir la <strong style="color:#fff;">captura de Xencall</strong> y agregar una <strong style="color:#fff;">nota</strong> indicando que la llamada se realizó y cuál fue la respuesta del cliente. ' +
          'Si no lo haces, el bloqueo no se quitará y no podrás seguir ingresando tus leads.' +
        '</div>' +
        btns +
      '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    var st = document.createElement('style');
    st.textContent = '#llamadas-bloqueo-overlay .llb-list::-webkit-scrollbar{display:none}';
    document.head.appendChild(st);

    var goBtn = document.getElementById('llb-go-btn');
    if (goBtn) goBtn.addEventListener('click', function () {
      window.location.href = '/residencial/costumer.html?llamadas=1';
    });
    var goLineasBtn = document.getElementById('llb-go-lineas-btn');
    if (goLineasBtn) goLineasBtn.addEventListener('click', function () {
      window.location.href = '/lineas/costumer.html?llamadas=1';
    });

    // Bloquear teclado fuera del modal (tab-trap básico)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  function buildBanner(data) {
    if (document.getElementById('llamadas-bloqueo-banner')) return;
    var b = document.createElement('div');
    b.id = 'llamadas-bloqueo-banner';
    b.setAttribute('style',
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#7f1d1d,#991b1b);color:#fff;' +
      'padding:9px 18px;font-size:.78rem;font-weight:700;text-align:center;font-family:\'Outfit\',\'Segoe UI\',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);');
    b.innerHTML = '📞 Tienes <strong>' + data.total + '</strong> cliente(s) por llamar. Abre cada lead, sube la captura de Xencall y agrega la nota de la llamada para desbloquear tu cuenta.';
    document.body.appendChild(b);
    document.body.style.paddingTop = '38px';
  }

  async function check() {
    // Modo demo: ?demoBloqueo=1 muestra el modal con datos de ejemplo (no bloquea de verdad)
    if (/[?&]demoBloqueo=1/.test(window.location.search || '')) {
      buildModal({
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
      if (!res.ok) return; // 401/403/500 → no bloquear
      var data = await res.json();
      if (!data || !data.blocked) return;
      window.__llamadasPendientes = data;
      if (inLlamadasMode) buildBanner(data);
      else buildModal(data);
    } catch (_) { /* sin red → no bloquear */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
