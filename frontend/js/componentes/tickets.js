/* tickets.js — «Nuevo ticket» desde la tuerquita y avisos en vivo de tickets.
 *
 * Lo carga js/layout/topbar-acciones.js en todas las páginas con menú superior.
 * - CRMTickets.abrir(): ventana para crear un ticket (título, tipo, prioridad,
 *   descripción y capturas: se pueden pegar con Ctrl+V). Guarda sola la pantalla
 *   desde la que se abre. API: routers/tickets.py.
 * - Avisos: administración ve uno al llegar un ticket nuevo o un mensaje del autor;
 *   el autor, cuando le responden o cambia el estado. Llegan por el centro de
 *   notificaciones (evento «ticket»).
 */
(function () {
  'use strict';
  if (window.CRMTickets || window.PORTAL) return;

  var MAX = 5;
  var capturas = [];
  var fondo = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CSS = '\
.tk-fondo{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgb(20 33 42 / .35)}\
.tk-ventana{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border:1px solid rgb(0 112 152 / .18);box-shadow:0 18px 48px rgb(20 33 42 / .22);font-size:13px;color:var(--color-text,#14212a)}\
.tk-cab{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid rgb(0 112 152 / .12)}\
.tk-cab h2{margin:0;font-size:17px}\
.tk-cab p{margin:3px 0 0;font-size:12px;color:var(--color-neutral-600,#5b6770)}\
.tk-x{flex:none;width:32px;height:32px;border:1px solid rgb(0 112 152 / .15);background:#fff;cursor:pointer;font-size:16px}\
.tk-cuerpo{display:flex;flex-direction:column;gap:12px;padding:16px 20px}\
.tk-fila{display:grid;grid-template-columns:1fr 1fr;gap:12px}\
.tk-campo{display:flex;flex-direction:column;gap:5px}\
.tk-campo label{font-size:12px;font-weight:600;color:var(--color-neutral-800,#2f3a42)}\
.tk-campo input,.tk-campo select,.tk-campo textarea{font:inherit;padding:8px 10px;border:1px solid rgb(0 112 152 / .25);background:#fff;color:inherit;border-radius:0}\
.tk-campo textarea{min-height:110px;resize:vertical}\
.tk-campo :focus-visible,.tk-x:focus-visible,.tk-btn:focus-visible,.tk-adj:focus-visible{outline:2px solid #007098;outline-offset:1px}\
.tk-ayuda{font-size:11px;color:var(--color-neutral-600,#5b6770)}\
.tk-adj{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border:1.5px dashed rgb(0 112 152 / .3);background:rgb(0 112 152 / .03);cursor:pointer;font:inherit;color:#007098;font-weight:600}\
.tk-miniaturas{display:flex;flex-wrap:wrap;gap:8px}\
.tk-mini{position:relative;width:72px;height:56px;border:1px solid rgb(0 112 152 / .2);background:#f4f8fa center/cover no-repeat}\
.tk-mini button{position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;border:0;background:#14212a;color:#fff;cursor:pointer;font-size:12px;line-height:22px}\
.tk-pie{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-top:1px solid rgb(0 112 152 / .12)}\
.tk-err{color:#b91c1c;font-size:12px}\
.tk-btn{min-height:38px;padding:0 16px;border:1px solid #007098;background:#007098;color:#fff;font:inherit;font-weight:700;cursor:pointer}\
.tk-btn[disabled]{opacity:.6;cursor:default}\
.tk-btn.sec{background:#fff;color:#007098}\
.tk-aviso{position:fixed;right:16px;bottom:16px;z-index:9100;width:min(340px,calc(100vw - 32px));padding:12px 14px;background:#fff;border:1px solid rgb(0 112 152 / .2);border-left:4px solid #007098;box-shadow:0 12px 32px rgb(20 33 42 / .18);font-size:13px}\
.tk-aviso b{display:block;margin-bottom:3px}\
.tk-aviso a{color:#007098;font-weight:700}\
@media (max-width:560px){.tk-fila{grid-template-columns:1fr}}';

  function estilo() {
    if (document.getElementById('tk-css')) return;
    var s = document.createElement('style'); s.id = 'tk-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function pintarCapturas() {
    var cont = fondo && fondo.querySelector('.tk-miniaturas'); if (!cont) return;
    cont.innerHTML = capturas.map(function (c, i) {
      return '<div class="tk-mini" style="background-image:url(' + c.url + ')"><button type="button" data-quitar="' + i + '" aria-label="Quitar captura ' + (i + 1) + '">×</button></div>';
    }).join('');
    fondo.querySelector('.tk-adj').hidden = capturas.length >= MAX;
  }

  function agregar(files) {
    var err = fondo.querySelector('.tk-err'); err.textContent = '';
    Array.prototype.forEach.call(files || [], function (f) {
      if (capturas.length >= MAX) { err.textContent = 'Máximo ' + MAX + ' capturas.'; return; }
      if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) { err.textContent = f.name + ' no es una imagen.'; return; }
      if (f.size > 8 * 1024 * 1024) { err.textContent = f.name + ' pasa de 8 MB.'; return; }
      capturas.push({ file: f, url: URL.createObjectURL(f) });
    });
    pintarCapturas();
  }

  function cerrar() {
    if (!fondo) return;
    capturas.forEach(function (c) { URL.revokeObjectURL(c.url); });
    capturas = []; fondo.remove(); fondo = null;
    document.removeEventListener('paste', alPegar);
  }
  function alPegar(e) {
    var items = (e.clipboardData && e.clipboardData.files) || [];
    if (items.length) { agregar(items); e.preventDefault(); }
  }

  function abrir() {
    if (fondo) return;
    estilo();
    fondo = document.createElement('div');
    fondo.className = 'tk-fondo';
    fondo.innerHTML =
      '<form class="tk-ventana" role="dialog" aria-modal="true" aria-labelledby="tk-titulo" novalidate>' +
        '<div class="tk-cab"><div><h2 id="tk-titulo">Nuevo ticket</h2><p>Llega a administración. Se guarda en qué pantalla estabas.</p></div>' +
          '<button type="button" class="tk-x" data-cerrar aria-label="Cerrar">×</button></div>' +
        '<div class="tk-cuerpo">' +
          '<div class="tk-campo"><label for="tk-t">Título</label><input id="tk-t" name="titulo" maxlength="150" required placeholder="Ej. No carga la lista de clientes"></div>' +
          '<div class="tk-fila">' +
            '<div class="tk-campo"><label for="tk-tipo">Tipo</label><select id="tk-tipo" name="tipo">' +
              '<option value="error">Error</option><option value="mejora">Mejora</option><option value="acceso">Acceso o permisos</option><option value="consulta">Consulta</option><option value="otro">Otro</option></select></div>' +
            '<div class="tk-campo"><label for="tk-p">Prioridad</label><select id="tk-p" name="prioridad">' +
              '<option value="baja">Baja</option><option value="normal" selected>Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></div>' +
          '</div>' +
          '<div class="tk-campo"><label for="tk-d">Qué pasó o qué necesitas</label><textarea id="tk-d" name="descripcion" maxlength="5000" required placeholder="Cuéntalo con detalle: qué hacías, qué esperabas y qué pasó."></textarea></div>' +
          '<div class="tk-campo"><span class="tk-ayuda">Capturas de pantalla (hasta ' + MAX + '). También puedes pegarlas con Ctrl+V.</span>' +
            '<button type="button" class="tk-adj"><i class="ph ph-camera" aria-hidden="true"></i> Adjuntar captura</button>' +
            '<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>' +
            '<div class="tk-miniaturas"></div></div>' +
        '</div>' +
        '<div class="tk-pie"><span class="tk-err" role="alert"></span>' +
          '<div style="display:flex;gap:8px"><button type="button" class="tk-btn sec" data-cerrar>Cancelar</button><button type="submit" class="tk-btn">Enviar ticket</button></div></div>' +
      '</form>';
    document.body.appendChild(fondo);
    var form = fondo.querySelector('form'), input = fondo.querySelector('input[type=file]');
    fondo.addEventListener('click', function (e) {
      if (e.target === fondo || e.target.closest('[data-cerrar]')) return cerrar();
      var q = e.target.closest('[data-quitar]');
      if (q) { var i = +q.dataset.quitar; URL.revokeObjectURL(capturas[i].url); capturas.splice(i, 1); pintarCapturas(); return; }
      if (e.target.closest('.tk-adj')) input.click();
    });
    input.addEventListener('change', function () { agregar(input.files); input.value = ''; });
    fondo.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
    document.addEventListener('paste', alPegar);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = fondo.querySelector('.tk-err'), btn = form.querySelector('button[type=submit]');
      var t = form.titulo.value.trim(), d = form.descripcion.value.trim();
      if (t.length < 3) { err.textContent = 'Escribe un título de al menos 3 caracteres.'; form.titulo.focus(); return; }
      if (d.length < 3) { err.textContent = 'Cuenta qué pasó o qué necesitas.'; form.descripcion.focus(); return; }
      var fd = new FormData();
      fd.append('titulo', t); fd.append('descripcion', d);
      fd.append('tipo', form.tipo.value); fd.append('prioridad', form.prioridad.value);
      fd.append('pagina', location.pathname);
      capturas.forEach(function (c) { fd.append('capturas', c.file, c.file.name || 'captura.png'); });
      btn.disabled = true; btn.textContent = 'Enviando…'; err.textContent = '';
      try {
        var r = await fetch('/api/tickets', { method: 'POST', body: fd, credentials: 'include' });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(j.detail && typeof j.detail === 'string' ? j.detail : 'No se pudo enviar. Revisa la conexión y vuelve a intentarlo.');
        cerrar();
        avisar('Ticket #' + j.id + ' enviado', 'Administración lo verá enseguida. Puedes seguirlo en <a href="/tickets.html?id=' + j.id + '">Tickets</a>.');
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Enviar ticket';
      }
    });
    setTimeout(function () { form.titulo.focus(); }, 30);
  }

  var tAviso = null;
  function avisar(titulo, html) {
    estilo();
    var a = document.querySelector('.tk-aviso');
    if (!a) { a = document.createElement('div'); a.className = 'tk-aviso'; a.setAttribute('role', 'status'); document.body.appendChild(a); }
    a.innerHTML = '<b>' + esc(titulo) + '</b>' + html;
    clearTimeout(tAviso); tAviso = setTimeout(function () { a.remove(); }, 9000);
  }

  // Avisos en vivo (routers/tickets.py publica «ticket»).
  function enlazar() {
    if (!window.CRMNotificaciones) return setTimeout(enlazar, 500);
    CRMNotificaciones.on('ticket', function (ev) {
      var enlace = ' <a href="/tickets.html?id=' + (+ev.id) + '">Ver</a>';
      if (ev.accion === 'nuevo') avisar('Nuevo ticket #' + ev.id + (ev.prioridad === 'urgente' ? ' · URGENTE' : ''), esc(ev.titulo) + ' — de ' + esc(ev.de) + '.' + enlace);
      else if (ev.accion === 'mensaje') avisar('Nueva respuesta en el ticket #' + ev.id, esc(ev.de) + ' escribió en «' + esc(ev.titulo) + '».' + enlace);
      else if (ev.accion === 'respuesta') avisar('Te respondieron el ticket #' + ev.id, '«' + esc(ev.titulo) + '».' + enlace);
      else if (ev.accion === 'estado') avisar('Tu ticket #' + ev.id + ': ' + esc(ev.estado), '«' + esc(ev.titulo) + '».' + enlace);
      if (window.CRMTicketsPagina) window.CRMTicketsPagina.recargar();
    });
  }
  enlazar();

  window.CRMTickets = { abrir: abrir, avisar: avisar };
})();
