/* aviso-transferencias.js — aviso a todo un departamento cuando transferencias suyas quedan
 * LIBRES (pasaron las 24 h de protección sin que el agente asignado registrara resultado).
 *
 * El servidor (routers/transferencias.py → bucle_liberadas) publica «transferencias_libres»
 * en el canal personal de cada usuario del departamento destino; este módulo, cargado en
 * todas las páginas junto al centro de notificaciones, lo muestra abajo a la derecha con un
 * enlace a la lista del departamento, donde se pueden tomar.
 */
(function () {
  'use strict';
  if (window.__avisoTransferencias || !window.CRMNotificaciones || window.PORTAL) return;
  window.__avisoTransferencias = true;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function estilos() {
    if (document.getElementById('aviso-trf-css')) return;
    var st = document.createElement('style');
    st.id = 'aviso-trf-css';
    st.textContent =
      '.aviso-trf{position:fixed;right:16px;bottom:16px;z-index:1500;width:min(360px,calc(100vw - 32px));padding:16px;' +
        'background:#fff;color:#0f172a;border:1px solid rgb(0 112 152 / .22);box-shadow:0 12px 32px rgb(0 112 152 / .18);' +
        'font:13px/1.45 Inter,system-ui,sans-serif}' +
      '.aviso-trf h3{margin:0 28px 6px 0;font-size:14px;font-weight:600}' +
      '.aviso-trf p{margin:0 0 10px;color:#475569}' +
      '.aviso-trf ul{margin:0 0 12px;padding-left:18px;color:#334155}' +
      '.aviso-trf a{display:inline-block;padding:7px 12px;background:#007098;color:#fff;text-decoration:none;font-weight:600}' +
      '.aviso-trf a:hover{background:#004e6b}' +
      '.aviso-trf a:focus-visible,.aviso-trf button:focus-visible{outline:2px solid #007098;outline-offset:2px}' +
      '.aviso-trf button{position:absolute;top:10px;right:10px;width:26px;height:26px;border:0;background:transparent;' +
        'font-size:18px;line-height:1;color:#64748b;cursor:pointer}' +
      '@media (prefers-reduced-motion:no-preference){.aviso-trf{animation:avisoTrf .25s ease-out}}' +
      '@keyframes avisoTrf{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}';
    document.head.appendChild(st);
  }

  window.CRMNotificaciones.on('transferencias_libres', function (ev) {
    estilos();
    var viejo = document.querySelector('.aviso-trf');
    if (viejo) viejo.remove();
    var depto = ev.seccion === 'lineas' ? 'Líneas' : 'Residencial';
    var n = ev.cantidad || 0;
    var caja = document.createElement('div');
    caja.className = 'aviso-trf';
    caja.setAttribute('role', 'status');
    caja.innerHTML =
      '<button type="button" aria-label="Cerrar aviso">×</button>' +
      '<h3>' + n + (n === 1 ? ' transferencia quedó libre' : ' transferencias quedaron libres') + '</h3>' +
      '<p>Pasaron 24 h sin gestionarse. Cualquier agente de ' + depto + ' puede tomarlas.</p>' +
      (ev.clientes && ev.clientes.length
        ? '<ul>' + ev.clientes.slice(0, 5).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
      '<a href="/' + (ev.seccion === 'lineas' ? 'lineas' : 'residencial') + '/transferencia.html#trf-dep">Ver y tomar</a>';
    caja.querySelector('button').addEventListener('click', function () { caja.remove(); });
    document.body.appendChild(caja);
  });
})();
