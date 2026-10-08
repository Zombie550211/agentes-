/**
 * Promociones activas — residencial/promociones-validas.html
 *
 * Lee /api/promociones y la pinta: arriba un resumen de todos los montos, la
 * destacada en grande y el resto en un carrusel de tarjetas. Si la API dice `puede_editar` (admin), aparecen "Editar" y
 * "Nueva promoción"; el permiso real lo comprueba el backend en cada escritura.
 *
 * Todo el texto entra por textContent: el título y los conceptos los escribe
 * un usuario, así que nunca pasan por innerHTML.
 */
(function () {
  'use strict';

  const API = '/api/promociones';
  const $ = (id) => document.getElementById(id);

  let promos = [];
  let puedeEditar = false;
  let editando = false;
  let borrador = null;       // { id, titulo, destacada, items:[{label, amount}] }

  // ── Utilidades ────────────────────────────────────────────────────
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icono(clase) {
    const i = el('i', clase);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function monto(n) {
    n = Number(n) || 0;
    return '$' + (n % 1 ? n.toFixed(2) : String(n));
  }
  function num2(i) { return String(i + 1).padStart(2, '0'); }

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    let json = {};
    try { json = await res.json(); } catch (_) { }
    if (!res.ok || json.success === false) {
      let msg = json.detail || json.message || ('Error ' + res.status);
      if (Array.isArray(msg)) msg = 'Revisa los datos del formulario.';
      throw new Error(msg);
    }
    return json;
  }

  function boton(cls, iconCls, texto, titulo, onClick) {
    const b = el('button', 'pa-btn ' + cls);
    b.type = 'button';
    if (iconCls) b.appendChild(icono(iconCls));
    if (texto) b.appendChild(el('span', null, texto));
    if (titulo) { b.title = titulo; b.setAttribute('aria-label', titulo); }
    b.addEventListener('click', onClick);
    return b;
  }

  // Icono de línea por promoción (por posición) — sólo decoración.
  const ICONOS = ['ph-megaphone-simple', 'ph-coins', 'ph-trend-up', 'ph-gift', 'ph-percent', 'ph-target', 'ph-star'];
  // Icono del resumen según el concepto del monto.
  function iconoConcepto(txt) {
    const t = String(txt || '').toLowerCase();
    if (t.indexOf('team') >= 0 || t.indexOf('equipo') >= 0) return 'ph-users-three';
    if (t.indexOf('supervisor') >= 0) return 'ph-user-circle-gear';
    if (t.indexOf('giga') >= 0) return 'ph-wifi-high';
    if (t.indexOf('bono') >= 0) return 'ph-target';
    if (t.indexOf('línea') >= 0 || t.indexOf('linea') >= 0) return 'ph-trend-up';
    return 'ph-tag';
  }

  // ── Render ────────────────────────────────────────────────────────
  function ordenadas() {
    const lead = promos.find((p) => p.destacada) || promos[0];
    return lead ? [lead].concat(promos.filter((p) => p !== lead)) : [];
  }

  // Franja superior: un ítem por monto de cada promoción (01 · Mejor team · $200 …)
  function renderIndice(lista) {
    const nav = $('paIndex');
    nav.replaceChildren();
    lista.forEach(function (p, i) {
      p.items.forEach(function (it) {
        const s = el('span', 'pa-indice-item');
        s.appendChild(icono('ph ' + iconoConcepto(it.label || p.titulo)));
        s.appendChild(el('span', 'pa-indice-n', num2(i)));
        s.appendChild(el('span', 'pa-indice-txt', it.label || p.titulo));
        s.appendChild(el('span', 'pa-indice-monto', monto(it.amount)));
        nav.appendChild(s);
      });
    });
  }

  // Destacada: fondo azul profundo del logo, cifra grande y el resto de montos debajo.
  function renderLead(p) {
    const art = el('article', 'pa-lead');
    art.appendChild(renderMedia());     // sin video: arcos del logo (+ «Subir video» si es admin)

    const cuerpo = el('div', 'pa-lead-cuerpo');
    const k = el('div', 'pa-kicker');
    k.appendChild(icono('ph ph-trophy'));
    k.appendChild(el('span', null, 'Promoción destacada'));
    cuerpo.appendChild(k);
    cuerpo.appendChild(el('h2', 'pa-lead-titulo', p.titulo));

    const first = p.items[0];
    const grande = el('div', 'pa-lead-monto');
    grande.appendChild(el('span', 'pa-lead-cifra', monto(first.amount)));
    if (first.label) grande.appendChild(el('span', 'pa-lead-concepto', first.label));
    cuerpo.appendChild(grande);

    if (p.items.length > 1) {
      const resto = el('div', 'pa-lead-resto');
      p.items.slice(1).forEach(function (it) {
        const r = el('div', 'pa-lead-item');
        r.appendChild(icono('ph ' + iconoConcepto(it.label)));
        const t = el('div');
        t.appendChild(el('span', 'pa-lead-item-lbl', it.label));
        t.appendChild(el('strong', 'pa-lead-item-monto', monto(it.amount)));
        r.appendChild(t);
        resto.appendChild(r);
      });
      cuerpo.appendChild(resto);
    }
    if (editando) {
      const tl = el('div', 'pa-tools');
      tl.appendChild(boton('pa-btn-sec', 'ph ph-pencil-simple', 'Editar', null, () => abrir(p)));
      tl.appendChild(boton('pa-btn-sec pa-btn-peligro', 'ph ph-trash', 'Quitar', null, () => quitar(p)));
      cuerpo.appendChild(tl);
    }
    art.appendChild(cuerpo);
    return art;
  }

  // Tarjeta del carrusel. i = posición tras la destacada (que es la 01): lleva el número i + 2.
  function renderCard(p, i, numero) {
    const card = el('article', 'pa-card in-glass pa-tono-' + (i % 3) + (p.destacada ? ' pa-card-destacada' : ''));
    const top = el('div', 'pa-card-top');
    const n = el('span', 'pa-card-n', num2(numero));
    if (p.destacada) { n.appendChild(icono('ph ph-trophy')); n.appendChild(el('span', null, 'Destacada')); }
    top.appendChild(n);
    if (editando) {
      const t = el('span', 'pa-tools');
      if (!p.destacada) t.appendChild(boton('pa-btn-icono', 'ph ph-star', null, 'Destacar', () => destacar(p)));
      t.appendChild(boton('pa-btn-icono', 'ph ph-pencil-simple', null, 'Editar', () => abrir(p)));
      t.appendChild(boton('pa-btn-icono pa-btn-peligro', 'ph ph-trash', null, 'Quitar', () => quitar(p)));
      top.appendChild(t);
    }
    card.appendChild(top);

    const ico = el('span', 'pa-card-ico');
    ico.appendChild(icono('ph ' + ICONOS[i % ICONOS.length]));
    card.appendChild(ico);
    card.appendChild(el('h3', 'pa-card-kicker', 'Promoción activa'));
    card.appendChild(el('span', 'pa-card-linea'));
    card.appendChild(el('p', 'pa-card-titulo', p.titulo));

    const montos = el('div', 'pa-card-montos');
    p.items.forEach(function (it) {
      const m = el('div', 'pa-card-monto');
      m.appendChild(el('strong', null, monto(it.amount)));
      if (it.label) m.appendChild(el('span', null, it.label));
      montos.appendChild(m);
    });
    card.appendChild(montos);
    return card;
  }

  // Carrusel: fila con desplazamiento horizontal y flechas que avanzan una tarjeta.
  function renderCarrusel(lista, desde) {
    const wrap = el('section', 'pa-carrusel');
    wrap.setAttribute('aria-label', 'Promociones activas');
    const pista = el('div', 'pa-pista');
    lista.forEach((p, i) => pista.appendChild(renderCard(p, i, desde + i)));
    wrap.appendChild(pista);
    const prev = boton('pa-flecha pa-flecha-izq', 'ph ph-caret-left', null, 'Promoción anterior', () => mover(-1));
    const next = boton('pa-flecha pa-flecha-der', 'ph ph-caret-right', null, 'Promoción siguiente', () => mover(1));
    wrap.append(prev, next);
    function paso() { const c = pista.querySelector('.pa-card'); return c ? c.getBoundingClientRect().width + 12 : 260; }
    function mover(d) { pista.scrollBy({ left: d * paso(), behavior: 'smooth' }); }
    function flechas() {
      prev.disabled = pista.scrollLeft <= 2;
      next.disabled = pista.scrollLeft + pista.clientWidth >= pista.scrollWidth - 2;
    }
    pista.addEventListener('scroll', flechas, { passive: true });
    requestAnimationFrame(flechas);
    window.addEventListener('resize', flechas);
    return wrap;
  }

  // ── Video promocional (el mismo del cuadro pequeño de la página de inicio) ──
  // Se ve a la derecha del cuadro grande, fundido con él. Los administradores lo suben,
  // cambian o quitan desde aquí; el servidor lo recomprime (routers/promo_video.py).
  let video = { url: null, procesando: false, error: null, puede_editar: false };
  let videoEspera = null;
  let videoMsg = '';

  function renderMedia() {
    const media = el('div', 'pa-lead-media');
    if (video.url) {
      const v = el('video');
      v.src = video.url; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
      media.appendChild(v);
      v.play().catch(function () {});
    } else {
      const deco = el('div', 'pa-lead-deco');
      deco.setAttribute('aria-hidden', 'true');
      media.appendChild(deco);
    }
    if (video.puede_editar) {
      const ctl = el('div', 'pa-video-ctl');
      const msg = videoMsg || (video.procesando ? 'Comprimiendo el video…' : video.error || (video.url ? '' : 'Sin video: sube uno para la página de inicio'));
      if (msg) ctl.appendChild(el('span', 'pa-video-msg', msg));
      const subir = el('label', 'pa-btn pa-btn-video' + (video.procesando ? ' pa-ocupado' : ''));
      subir.appendChild(icono('ph ph-upload-simple'));
      subir.appendChild(el('span', null, video.url ? 'Cambiar video' : 'Subir video'));
      const input = el('input');
      input.type = 'file'; input.hidden = true;
      input.accept = 'video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp';
      input.addEventListener('change', function () { subirVideo(input.files[0]); input.value = ''; });
      subir.appendChild(input);
      ctl.appendChild(subir);
      if (video.url && !video.procesando) ctl.appendChild(boton('pa-btn-video pa-btn-icono-video', 'ph ph-trash', null, 'Quitar video', quitarVideo));
      media.appendChild(ctl);
    }
    return media;
  }

  // Cuadro grande con el video completo (el mismo de inicio), sin nada encima salvo los
  // controles del administrador.
  function renderVideoCard() {
    const art = el('article', 'pa-lead pa-lead-video');
    art.setAttribute('aria-label', 'Video promocional');
    art.appendChild(renderMedia());
    return art;
  }

  async function cargarVideo() {
    try {
      const r = await fetch('/api/promo-video', { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const cambio = j.url !== video.url || j.procesando !== video.procesando || j.error !== video.error || j.puede_editar !== video.puede_editar;
      video = j; videoMsg = '';
      if (cambio && promos.length) render();
    } catch (e) { console.warn('[PROMOCIONES] video:', e); }
    clearTimeout(videoEspera);
    if (video.procesando) videoEspera = setTimeout(cargarVideo, 4000);
  }

  function subirVideo(archivo) {
    if (!archivo) return;
    if (archivo.size > 300 * 1024 * 1024) { videoMsg = 'El video pesa más de 300 MB.'; render(); return; }
    const fd = new FormData();
    fd.append('file', archivo);
    const xhr = new XMLHttpRequest();          // XHR: fetch no informa del progreso de subida
    xhr.open('POST', '/api/promo-video');
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (e) {
      if (!e.lengthComputable) return;
      videoMsg = 'Subiendo el video… ' + Math.round(e.loaded / e.total * 100) + ' %';
      const m = document.querySelector('.pa-video-msg');
      if (m) m.textContent = videoMsg; else render();
    };
    xhr.onload = function () {
      if (xhr.status === 202 || xhr.status === 200) { videoMsg = ''; cargarVideo(); return; }
      let d = ''; try { d = JSON.parse(xhr.responseText).detail || ''; } catch (_) { }
      videoMsg = d || ('No se pudo subir el video (HTTP ' + xhr.status + ').'); render();
    };
    xhr.onerror = function () { videoMsg = 'Se cortó la subida. Inténtalo de nuevo.'; render(); };
    videoMsg = 'Subiendo el video… 0 %'; render();
    xhr.send(fd);
  }

  async function quitarVideo() {
    if (!window.confirm('¿Quitar el video promocional? Dejará de verse también en la página de inicio.')) return;
    try {
      const r = await fetch('/api/promo-video', { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await cargarVideo(); render();
    } catch (e) { videoMsg = 'No se pudo quitar el video.'; render(); }
  }

  function render() {
    const cont = $('paContenido');
    const lista = ordenadas();
    renderIndice(lista);
    cont.replaceChildren();

    if (!lista.length) {
      const v = el('div', 'pa-vacio in-glass');
      v.appendChild(icono('ph ph-megaphone-simple'));
      v.appendChild(el('p', null, 'No hay promociones activas.'));
      if (puedeEditar) v.appendChild(boton('pa-btn-pri', 'ph ph-plus', 'Agregar la primera', null, () => abrir(null)));
      cont.appendChild(v);
      return;
    }

    const main = el('div', 'pa-main');
    if (video.url) {
      main.appendChild(renderVideoCard());
      main.appendChild(renderCarrusel(lista, 0));
    } else {
      // Sin video: la destacada en grande (como antes) y el resto en el carrusel.
      main.appendChild(renderLead(lista[0]));
      if (lista.length > 1) main.appendChild(renderCarrusel(lista.slice(1), 1));
      else main.classList.add('pa-main-sola');
    }
    cont.appendChild(main);
  }

  function pintarBotonEditar() {
    const b = $('paToggleEdit');
    b.setAttribute('aria-pressed', String(editando));
    b.querySelector('i').className = editando ? 'ph ph-check-circle' : 'ph ph-pencil-simple';
    b.querySelector('span').textContent = editando ? 'Listo' : 'Editar';
  }

  // ── Datos ─────────────────────────────────────────────────────────
  async function cargar() {
    try {
      const json = await api(API);
      promos = Array.isArray(json.data) ? json.data : [];
      puedeEditar = !!json.puede_editar;
      $('paAdmin').hidden = !puedeEditar;
      render();
    } catch (e) {
      console.error('[PROMOCIONES] cargar:', e);
      $('paContenido').replaceChildren(el('p', 'pa-estado', 'No se pudieron cargar las promociones. Recarga la página.'));
    }
  }

  async function quitar(p) {
    if (!window.confirm('¿Quitar "' + p.titulo + '"?')) return;
    try {
      await api(API + '/' + p.id, { method: 'DELETE' });
      await cargar();
    } catch (e) { window.alert('No se pudo quitar: ' + e.message); }
  }

  async function destacar(p) {
    try {
      await api(API + '/' + p.id + '/destacar', { method: 'POST' });
      await cargar();
    } catch (e) { window.alert('No se pudo destacar: ' + e.message); }
  }

  // ── Diálogo ───────────────────────────────────────────────────────
  function errores(err) {
    [['paErrTitulo', err.titulo], ['paErrItems', err.items], ['paErrGeneral', err.general]].forEach(function (x) {
      const n = $(x[0]);
      n.textContent = x[1] || '';
      n.hidden = !x[1];
    });
  }

  function renderItems() {
    const box = $('paItems');
    box.replaceChildren();
    borrador.items.forEach(function (it, i) {
      const fila = el('div', 'pa-item');
      const lab = el('input', 'pa-input');
      lab.placeholder = 'Ej. Por línea';
      lab.maxLength = 60;
      lab.value = it.label;
      lab.setAttribute('aria-label', 'Concepto ' + (i + 1));
      lab.addEventListener('input', () => { it.label = lab.value; });
      const amt = el('input', 'pa-input');
      amt.type = 'number'; amt.min = '0'; amt.step = '0.01'; amt.placeholder = '0';
      amt.inputMode = 'decimal';
      amt.value = it.amount;
      amt.setAttribute('aria-label', 'Monto ' + (i + 1));
      amt.addEventListener('input', () => { it.amount = amt.value; });
      const del = boton('pa-btn-icono', 'ph ph-x', null, 'Quitar monto', function () {
        borrador.items.splice(i, 1);
        renderItems();
      });
      del.disabled = borrador.items.length === 1;
      fila.append(lab, amt, del);
      box.appendChild(fila);
    });
  }

  function abrir(p) {
    borrador = p
      ? { id: p.id, titulo: p.titulo, destacada: p.destacada, items: p.items.map((it) => ({ label: it.label, amount: String(it.amount) })) }
      : { id: null, titulo: '', destacada: false, items: [{ label: '', amount: '' }] };
    $('paDialogoTitulo').textContent = p ? 'Editar promoción' : 'Nueva promoción';
    $('paGuardar').textContent = p ? 'Guardar cambios' : 'Publicar promoción';
    $('paTitulo').value = borrador.titulo;
    $('paDestacada').checked = borrador.destacada;
    errores({});
    renderItems();
    $('paDialogo').hidden = false;
    $('paTitulo').focus();
  }

  function cerrar() {
    $('paDialogo').hidden = true;
    borrador = null;
  }

  async function guardar(e) {
    e.preventDefault();
    const titulo = $('paTitulo').value.trim();
    const items = borrador.items
      .filter((i) => String(i.amount).trim() !== '' && !isNaN(+i.amount) && +i.amount >= 0)
      .map((i) => ({ label: i.label.trim(), amount: +i.amount }));
    const err = {};
    if (!titulo) err.titulo = 'Escribe un nombre.';
    if (!items.length) err.items = 'Agrega al menos un monto.';
    if (err.titulo || err.items) return errores(err);

    const body = JSON.stringify({ titulo: titulo, items: items, destacada: $('paDestacada').checked });
    const btn = $('paGuardar');
    btn.disabled = true;
    try {
      await api(borrador.id ? API + '/' + borrador.id : API, {
        method: borrador.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      });
      cerrar();
      await cargar();
    } catch (ex) {
      errores({ general: 'No se pudo guardar: ' + ex.message });
    } finally {
      btn.disabled = false;
    }
  }

  // ── Arranque ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    $('paHoy').textContent = new Date().toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    $('paToggleEdit').addEventListener('click', function () {
      editando = !editando;
      pintarBotonEditar();
      render();
    });
    $('paNueva').addEventListener('click', () => abrir(null));
    $('paAddItem').addEventListener('click', function () {
      borrador.items.push({ label: '', amount: '' });
      renderItems();
    });
    $('paCancelar').addEventListener('click', cerrar);
    $('paForm').addEventListener('submit', guardar);
    $('paDialogo').addEventListener('click', (e) => { if (e.target === e.currentTarget) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('paDialogo').hidden) cerrar(); });

    cargar().then(cargarVideo);
  });
})();
