/**
 * Aviso de CASOS A SOLVENTAR (semáforo de clientes).
 *
 * Sustituye al antiguo aviso de llamadas de verificación a los 15 días. Consulta
 * /api/casos/pendientes y, si el agente tiene clientes completados con el caso
 * sin solventar, le AVISA en pantalla (banner + tarjeta + lista con el caso que
 * escribió en el formulario). No bloquea: puede seguir trabajando.
 *
 * Plazos (días naturales desde que el cliente pasa a completed):
 *   verde 3 días · amarillo +2 · rojo +1 · después negro → oficina (automático).
 *
 * PANTALLA BLOQUEADA: la 1ª llamada (la del caso) bloquea desde que el cliente
 * pasa a completed; las de seguimiento (14 días, 14 días y luego cada 30)
 * bloquean 3 días después de vencer. La pantalla lista las llamadas y deja
 * subir ahí mismo la captura o el audio; al no quedar ninguna que bloquee, se
 * levanta. El servidor además rechaza ventas nuevas mientras haya bloqueo.
 *
 * Se mantiene el nombre del archivo: lo cargan todas las páginas del CRM.
 * Todo lo que llega del servidor se pinta con textContent.
 */
(function () {
  'use strict';

  var path = (window.location.pathname || '').toLowerCase();
  if (path.indexOf('login') !== -1 || path.indexOf('register') !== -1 || path.indexOf('crear-cuenta') !== -1) return;

  var URL_LISTA = '/residencial/costumer.html?casos=1';
  var COLOR = {
    verde:    { t: 'Verde',    bg: '#0f766e', dot: '#34d399' },
    amarillo: { t: 'Amarillo', bg: '#a16207', dot: '#facc15' },
    rojo:     { t: 'Rojo',     bg: '#991b1b', dot: '#f87171' }
  };
  var ORDEN = { rojo: 0, amarillo: 1, verde: 2 };

  function el(tag, css, txt) {
    var n = document.createElement(tag);
    if (css) n.setAttribute('style', css);
    if (txt != null) n.textContent = String(txt);
    return n;
  }
  function horas(h) {
    if (h == null) return '';
    var t = Math.round(h), d = Math.floor(t / 24), r = t % 24;
    return d > 0 ? d + ' d' + (r ? ' ' + r + ' h' : '') : t + ' h';
  }
  function fechaHora(v) {
    if (!v) return '';
    var t = String(v).replace(' ', 'T');
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) t += 'Z';
    var d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function etiqueta(c) {
    if (c.motivo === 'seguimiento') {
      return 'Llamada de seguimiento ' + c.numero + ' · tocaba el ' + fechaHora(c.vence_at);
    }
    var cfg = COLOR[c.color] || COLOR.verde;
    return 'Llamada del caso · ' + cfg.t + ' · quedan ' + horas(c.horas_restantes_color) + (c.color === 'rojo' ? ' para oficina' : '');
  }

  function peor(casos) {
    return casos.reduce(function (a, c) { return ORDEN[c.color] < ORDEN[a] ? c.color : a; }, 'verde');
  }
  function resumen(casos) {
    var n = { verde: 0, amarillo: 0, rojo: 0 };
    casos.forEach(function (c) { if (n[c.color] != null) n[c.color]++; });
    var partes = [];
    if (n.rojo) partes.push(n.rojo + ' en rojo');
    if (n.amarillo) partes.push(n.amarillo + ' en amarillo');
    if (n.verde) partes.push(n.verde + ' en verde');
    return partes.join(' · ');
  }

  // ── Lista de casos (ventana) ─────────────────────────────────────
  function abrirLista(casos) {
    if (document.getElementById('casos-aviso-lista')) return;
    var fondo = el('div', 'position:fixed;inset:0;z-index:100000;background:rgba(10,15,30,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;');
    fondo.id = 'casos-aviso-lista';
    var caja = el('div', 'background:#fff;color:#0f1b2d;width:100%;max-width:620px;max-height:86vh;display:flex;flex-direction:column;border-radius:10px;border-top:4px solid #13294b;box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:\'Outfit\',\'Segoe UI\',sans-serif;');
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', 'casos-aviso-titulo');

    var cab = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 12px;border-bottom:1px solid #dde1e8;');
    var tit = el('div');
    var h = el('h2', 'margin:0;font-size:1.05rem;font-weight:800;letter-spacing:.02em;text-transform:uppercase;', 'Llamadas pendientes');
    h.id = 'casos-aviso-titulo';
    tit.appendChild(h);
    tit.appendChild(el('p', 'margin:4px 0 0;font-size:.78rem;color:#5b6577;', 'Sube la captura o el audio de la llamada donde lo solventaste, en Editar cliente. Si el rojo se acaba, el cliente pasa a oficina.'));
    var cerrar = el('button', 'background:none;border:1px solid #dde1e8;border-radius:6px;width:34px;height:34px;cursor:pointer;font-size:1rem;color:#5b6577;flex-shrink:0;', '✕');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar');
    cab.appendChild(tit);
    cab.appendChild(cerrar);

    var ul = el('ul', 'list-style:none;margin:0;padding:8px 12px;overflow-y:auto;');
    casos.slice().sort(function (a, b) {
      return (ORDEN[a.color] - ORDEN[b.color]) || ((a.horas_restantes_color || 0) - (b.horas_restantes_color || 0));
    }).forEach(function (c) {
      var cfg = COLOR[c.color] || COLOR.verde;
      var li = el('li', 'display:grid;grid-template-columns:14px 1fr auto;gap:4px 10px;align-items:start;padding:11px 8px;border-bottom:1px solid #eef1f5;');
      li.appendChild(el('span', 'width:12px;height:12px;margin-top:4px;border-radius:50%;background:' + cfg.dot + ';box-shadow:0 0 0 3px ' + cfg.dot + '33;'));
      var cuerpo = el('div', 'min-width:0;');
      cuerpo.appendChild(el('div', 'font-weight:700;font-size:.9rem;', c.nombre_cliente || 'Sin nombre'));
      cuerpo.appendChild(el('div', 'font-size:.8rem;color:#2b3547;margin-top:3px;white-space:pre-wrap;word-break:break-word;', c.caso_solventar || '—'));
      if (c.telefono) cuerpo.appendChild(el('div', 'font-size:.72rem;color:#8a93a3;margin-top:3px;font-family:ui-monospace,monospace;', c.telefono));
      li.appendChild(cuerpo);
      var plazo = el('div', 'text-align:right;font-size:.72rem;font-weight:700;color:' + cfg.bg + ';white-space:nowrap;');
      if (c.motivo === 'seguimiento') {
        plazo.appendChild(el('div', 'color:#13294b;', 'Seguimiento ' + c.numero));
        plazo.appendChild(el('div', 'font-weight:500;color:#5b6577;margin-top:2px;', 'bloquea el ' + fechaHora(c.bloquea_at)));
      } else {
        plazo.appendChild(el('div', null, cfg.t));
        plazo.appendChild(el('div', 'font-weight:500;color:#5b6577;margin-top:2px;', 'quedan ' + horas(c.horas_restantes_color)));
      }
      li.appendChild(plazo);
      ul.appendChild(li);
    });

    var pie = el('div', 'display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid #dde1e8;');
    var ir = el('button', 'background:#13294b;color:#fff;border:none;border-radius:6px;padding:10px 16px;font-weight:700;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;box-shadow:inset 0 -2px 0 #b8923a;font-family:inherit;', 'Ir a mis casos');
    ir.type = 'button';
    pie.appendChild(ir);

    caja.appendChild(cab);
    caja.appendChild(ul);
    caja.appendChild(pie);
    fondo.appendChild(caja);
    document.body.appendChild(fondo);

    var previo = document.activeElement;
    function quitar() {
      fondo.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previo && previo.focus) previo.focus();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); quitar(); } }
    cerrar.addEventListener('click', quitar);
    fondo.addEventListener('click', function (e) { if (e.target === fondo) quitar(); });
    ir.addEventListener('click', function () { window.location.href = URL_LISTA; });
    document.addEventListener('keydown', onKey, true);
    cerrar.focus();
  }

  // ── Banner superior ──────────────────────────────────────────────
  function banner(casos) {
    if (document.getElementById('llamadas-bloqueo-banner')) return;
    var cfg = COLOR[peor(casos)] || COLOR.verde;
    var b = el('div',
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:' + cfg.bg + ';color:#fff;' +
      'padding:9px 18px;font-size:.78rem;font-weight:700;font-family:\'Outfit\',\'Segoe UI\',sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;');
    b.id = 'llamadas-bloqueo-banner';
    b.setAttribute('role', 'status');
    var txt = el('span');
    txt.appendChild(el('span', 'display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;background:' + cfg.dot + ';box-shadow:0 0 6px ' + cfg.dot + ';'));
    var segs = casos.filter(function (c) { return c.motivo === 'seguimiento'; }).length;
    txt.appendChild(document.createTextNode(segs === casos.length
      ? 'Tienes ' + segs + ' llamada(s) de seguimiento por hacer: súbelas antes de 3 días o se bloqueará el CRM'
      : 'Tienes ' + casos.length + ' caso(s) por solventar (' + resumen(casos) + ')'));
    var btnCss = 'background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:8px;padding:4px 12px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;';
    var ver = el('button', btnCss, 'Ver casos');
    ver.type = 'button';
    var x = el('button', 'background:none;border:none;color:rgba(255,255,255,.8);font-size:.95rem;cursor:pointer;padding:0 4px;line-height:1;', '✕');
    x.type = 'button';
    x.title = 'Ocultar aviso';
    x.setAttribute('aria-label', 'Ocultar aviso');
    b.appendChild(txt);
    b.appendChild(ver);
    b.appendChild(x);
    document.body.appendChild(b);
    document.body.style.paddingTop = b.offsetHeight + 4 + 'px';
    ver.addEventListener('click', function () { abrirLista(casos); });
    x.addEventListener('click', function () { b.remove(); document.body.style.paddingTop = ''; });
  }

  /** Tarjeta en el sistema global de notificaciones (si está cargado). */
  function tarjeta(casos, intentos) {
    if (typeof window.showCRMNotif !== 'function') {
      if ((intentos || 0) > 20) return;
      setTimeout(function () { tarjeta(casos, (intentos || 0) + 1); }, 500);
      return;
    }
    var urg = casos.slice().sort(function (a, b) { return ORDEN[a.color] - ORDEN[b.color]; })[0] || {};
    window.showCRMNotif('warn', {
      cliente: 'Tienes ' + casos.length + ' caso(s) por solventar',
      actor: '',
      detalle: (urg.nombre_cliente || '') + (urg.caso_solventar ? ' — ' + String(urg.caso_solventar).slice(0, 80) : ''),
      extra: resumen(casos),
    });
  }

  // ── Pantalla bloqueada ───────────────────────────────────────────
  function cerrarSesion() {
    try { localStorage.removeItem('user'); localStorage.removeItem('token'); sessionStorage.clear(); } catch (_) {}
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(function () {})
      .finally(function () { window.location.replace('/login.html'); });
  }

  async function subirLlamada(c, file, nota) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('leadId', c.id);
    var up = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: fd });
    var upj = await up.json().catch(function () { return {}; });
    if (!up.ok) throw new Error(upj.detail || 'No se pudo subir el archivo');
    var url = (upj.data && upj.data.url) || '';
    if (!url) throw new Error('El servidor no devolvió la URL del archivo');
    var mt = String(file.type || '');
    var tipo = mt.indexOf('image/') === 0 ? 'imagen' : (mt.indexOf('audio/') === 0 ? 'audio' : 'documento');
    var ruta = c.motivo === 'seguimiento'
      ? '/api/leads/' + encodeURIComponent(c.id) + '/seguimiento'
      : '/api/leads/' + encodeURIComponent(c.id) + '/caso/comprobante';
    var r = await fetch(ruta, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ url: url, tipo: tipo, nombre: file.name, nota: nota })
    });
    var rj = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(rj.detail || 'No se pudo registrar la llamada');
  }

  function tarjetaLlamada(c, alSubir) {
    var cfg = c.motivo === 'seguimiento' ? { bg: '#13294b', dot: '#b8923a' } : (COLOR[c.color] || COLOR.verde);
    var li = el('li', 'border:1px solid #dde1e8;border-left:5px solid ' + cfg.dot + ';border-radius:8px;padding:14px;display:grid;gap:8px;background:' + (c.bloquea ? '#fff' : '#f8f9fb') + ';');
    var cab = el('div', 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;');
    cab.appendChild(el('strong', 'font-size:.95rem;', c.nombre_cliente || 'Sin nombre'));
    cab.appendChild(el('span', 'font-family:ui-monospace,monospace;font-size:.8rem;color:#5b6577;', c.telefono || ''));
    li.appendChild(cab);
    li.appendChild(el('div', 'font-size:.74rem;font-weight:700;color:' + cfg.bg + ';text-transform:uppercase;letter-spacing:.05em;',
      etiqueta(c) + (c.bloquea ? '' : ' · bloquea el ' + fechaHora(c.bloquea_at))));
    if (c.caso_solventar) {
      var caso = el('div', 'font-size:.84rem;line-height:1.4;background:#f8f1e1;border-radius:6px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;');
      caso.appendChild(el('b', null, c.motivo === 'seguimiento' ? 'Caso (ya solventado): ' : 'Caso a solventar: '));
      caso.appendChild(document.createTextNode(c.caso_solventar));
      li.appendChild(caso);
    }
    var fila = el('div', 'display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center;');
    var fid = 'cb-file-' + c.motivo + '-' + c.id;
    var fi = el('input', 'position:absolute;width:1px;height:1px;opacity:0;');
    fi.type = 'file'; fi.id = fid; fi.accept = 'image/*,audio/*';
    var lbl = el('label', 'cursor:pointer;border:1px solid #c3cad6;border-radius:6px;padding:8px 12px;font-size:.76rem;font-weight:700;background:#fff;white-space:nowrap;', '📎 Captura o audio de la llamada');
    lbl.htmlFor = fid;
    var nom = el('span', 'font-size:.76rem;color:#8a93a3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', 'Ningún archivo');
    var nota = el('input', 'grid-column:1/-1;border:1px solid #c3cad6;border-radius:6px;padding:9px 10px;font-size:.84rem;font-family:inherit;');
    nota.type = 'text'; nota.maxLength = 1000;
    nota.placeholder = c.motivo === 'seguimiento' ? 'Nota: qué te dijo el cliente' : 'Nota: cómo se solventó el caso';
    nota.setAttribute('aria-label', 'Nota de la llamada');
    var btn = el('button', 'grid-column:1/-1;background:#13294b;color:#fff;border:none;border-radius:6px;padding:10px;font-weight:700;font-size:.8rem;cursor:pointer;box-shadow:inset 0 -2px 0 #b8923a;font-family:inherit;opacity:.5;', 'Subir llamada');
    btn.type = 'button'; btn.disabled = true;
    var msg = el('div', 'grid-column:1/-1;font-size:.76rem;font-weight:600;');
    msg.setAttribute('role', 'status');
    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0];
      nom.textContent = f ? f.name : 'Ningún archivo';
      btn.disabled = !f; btn.style.opacity = f ? '1' : '.5';
    });
    btn.addEventListener('click', async function () {
      var f = fi.files && fi.files[0];
      if (!f) return;
      btn.disabled = true; btn.textContent = 'Subiendo…'; msg.textContent = '';
      try {
        await subirLlamada(c, f, nota.value.trim());
        msg.style.color = '#1f7a4d'; msg.textContent = '✓ Llamada registrada';
        alSubir();
      } catch (e) {
        msg.style.color = '#b42318'; msg.textContent = e.message || 'Error al subir';
        btn.disabled = false; btn.textContent = 'Subir llamada';
      }
    });
    fila.appendChild(fi); fila.appendChild(lbl); fila.appendChild(nom); fila.appendChild(nota); fila.appendChild(btn); fila.appendChild(msg);
    li.appendChild(fila);
    return li;
  }

  function pantallaBloqueo(items) {
    var previa = document.getElementById('casos-bloqueo');
    if (previa) previa.remove();
    var b = document.getElementById('llamadas-bloqueo-banner');
    if (b) { b.remove(); document.body.style.paddingTop = ''; }

    var capa = el('div', 'position:fixed;inset:0;z-index:100002;background:rgba(10,18,36,.92);backdrop-filter:blur(6px);overflow-y:auto;padding:24px 16px;font-family:\'Outfit\',\'Segoe UI\',sans-serif;');
    capa.id = 'casos-bloqueo';
    var caja = el('div', 'max-width:720px;margin:0 auto;background:#fff;color:#0f1b2d;border-radius:10px;border-top:4px solid #b42318;box-shadow:0 30px 80px rgba(0,0,0,.45);');
    caja.setAttribute('role', 'alertdialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', 'casos-bloqueo-t');
    caja.setAttribute('aria-describedby', 'casos-bloqueo-d');
    var cab = el('div', 'padding:20px 22px 14px;border-bottom:1px solid #dde1e8;');
    var h = el('h2', 'margin:0;font-size:1.15rem;font-weight:800;text-transform:uppercase;letter-spacing:.02em;outline:none;', '🔒 CRM bloqueado: tienes llamadas pendientes');
    h.id = 'casos-bloqueo-t'; h.tabIndex = -1;
    var d = el('p', 'margin:6px 0 0;font-size:.84rem;color:#5b6577;line-height:1.45;',
      'Haz la llamada y sube la captura o el audio donde se ve que el caso quedó solventado. En cuanto subas las llamadas que bloquean, podrás seguir usando el CRM. Si el cliente llega a negro, pasa a oficina y deja de contar para ti.');
    d.id = 'casos-bloqueo-d';
    cab.appendChild(h); cab.appendChild(d);
    var ul = el('ul', 'list-style:none;margin:0;padding:16px 22px;display:grid;gap:12px;');
    var orden = items.slice().sort(function (a, b) {
      if (a.bloquea !== b.bloquea) return a.bloquea ? -1 : 1;
      if (a.motivo !== b.motivo) return a.motivo === 'caso' ? -1 : 1;
      return (ORDEN[a.color] || 0) - (ORDEN[b.color] || 0);
    });
    orden.forEach(function (c) { ul.appendChild(tarjetaLlamada(c, function () { setTimeout(revisar, 700); })); });
    var pie = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 22px 18px;border-top:1px solid #dde1e8;font-size:.76rem;color:#8a93a3;');
    pie.appendChild(el('span', null, items.filter(function (x) { return x.bloquea; }).length + ' llamada(s) bloquean · ' + items.length + ' pendiente(s) en total'));
    var salir = el('button', 'background:none;border:1px solid #c3cad6;border-radius:6px;padding:8px 14px;font-size:.76rem;font-weight:600;cursor:pointer;color:#2b3547;font-family:inherit;', 'Cerrar sesión');
    salir.type = 'button';
    salir.addEventListener('click', cerrarSesion);
    pie.appendChild(salir);
    caja.appendChild(cab); caja.appendChild(ul); caja.appendChild(pie);
    capa.appendChild(caja);
    document.body.appendChild(capa);
    // El resto de la página queda inerte (ni clic ni teclado) y sin scroll.
    [].forEach.call(document.body.children, function (n) { if (n !== capa) n.inert = true; });
    document.documentElement.style.overflow = 'hidden';
    h.focus();
  }

  function levantarBloqueo() {
    var capa = document.getElementById('casos-bloqueo');
    if (!capa) return;
    capa.remove();
    [].forEach.call(document.body.children, function (n) { n.inert = false; });
    document.documentElement.style.overflow = '';
  }

  async function revisar() {
    try {
      var res = await fetch('/api/casos/pendientes', {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return;
      var data = await res.json();
      var casos = (data && data.data) || [];
      window.__casosPendientes = casos;
      if (data && data.bloqueado) { pantallaBloqueo(casos); return; }
      var estabaBloqueado = !!document.getElementById('casos-bloqueo');
      levantarBloqueo();
      if (estabaBloqueado) { window.location.reload(); return; }
      if (!casos.length) return;
      banner(casos);
      tarjeta(casos, 0);
    } catch (_) { /* sin red → sin aviso ni bloqueo */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revisar);
  else revisar();
})();
