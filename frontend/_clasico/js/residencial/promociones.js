/**
 * Promociones activas — residencial/promociones-validas.html
 *
 * Lee /api/promociones y la pinta: la destacada en grande y el resto en
 * tarjetas. Si la API dice `puede_editar` (admin), aparecen "Editar" y
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

  // ── Cifra en tres planchas (C/M/Y) ────────────────────────────────
  function cifra(texto, tam) {
    const box = el('div', 'pa-cmyk ' + tam);
    box.appendChild(el('span', 'pa-papel', texto));
    ['pa-c', 'pa-m', 'pa-y'].forEach(function (p) {
      const s = el('span', 'pa-plancha ' + p, texto);
      s.setAttribute('aria-hidden', 'true');
      box.appendChild(s);
    });
    return box;
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

  // ── Render ────────────────────────────────────────────────────────
  function ordenadas() {
    const lead = promos.find((p) => p.destacada) || promos[0];
    return lead ? [lead].concat(promos.filter((p) => p !== lead)) : [];
  }

  function renderIndice(lista) {
    const nav = $('paIndex');
    nav.replaceChildren();
    lista.forEach(function (p, i) {
      p.items.forEach(function (it) {
        const s = el('span', 'pa-index-item');
        s.appendChild(el('span', 'pa-index-n', num2(i)));
        s.appendChild(el('span', null, it.label || p.titulo));
        s.appendChild(el('span', 'pa-index-amt', monto(it.amount)));
        nav.appendChild(s);
      });
    });
  }

  function renderLead(p) {
    const art = el('article', 'pa-lead');
    const top = el('div', 'pa-lead-top');
    const k = el('div', 'pa-kicker pa-kicker-lead');
    k.appendChild(icono('fas fa-trophy'));
    k.appendChild(el('span', null, '01 · Promoción destacada'));
    top.appendChild(k);
    top.appendChild(el('h2', 'pa-lead-title', p.titulo));
    if (editando) {
      const t = el('div', 'pa-tools');
      t.appendChild(boton('pa-btn-secondary', 'fas fa-pen', 'Editar', null, () => abrir(p)));
      t.appendChild(boton('pa-btn-ghost pa-btn-danger', 'fas fa-trash', 'Quitar', null, () => quitar(p)));
      top.appendChild(t);
    }
    art.appendChild(top);

    const amts = el('div', 'pa-lead-amounts');
    p.items.forEach(function (it, i) {
      const fila = el('div', i === 0 ? 'pa-lead-first' : 'pa-lead-row');
      fila.appendChild(cifra(monto(it.amount), i === 0 ? 'pa-num-xl' : 'pa-num-lg'));
      fila.appendChild(el('span', 'pa-amt-label', it.label));
      amts.appendChild(fila);
    });
    art.appendChild(amts);
    return art;
  }

  // i = posición dentro de la columna lateral (0 = primera tarjeta); la
  // destacada es la 01, así que la tarjeta i lleva el número i + 2.
  function renderCard(p, i) {
    const card = el('article', 'pa-card' + (i % 3 === 1 ? ' pa-card-alt' : ''));
    const top = el('div', 'pa-card-top');
    const k = el('span', 'pa-kicker');
    k.appendChild(icono('fas fa-tag'));
    k.appendChild(el('span', null, num2(i + 1) + ' · Promoción activa'));
    top.appendChild(k);
    if (editando) {
      const t = el('span', 'pa-tools');
      t.appendChild(boton('pa-btn-ghost pa-btn-icon', 'fas fa-star', null, 'Destacar', () => destacar(p)));
      t.appendChild(boton('pa-btn-ghost pa-btn-icon', 'fas fa-pen', null, 'Editar', () => abrir(p)));
      t.appendChild(boton('pa-btn-ghost pa-btn-icon pa-btn-danger', 'fas fa-trash', null, 'Quitar', () => quitar(p)));
      top.appendChild(t);
    }
    card.appendChild(top);
    card.appendChild(el('h3', 'pa-card-title', p.titulo));

    const first = p.items[0];
    const amt = el('div', 'pa-card-amt');
    amt.appendChild(cifra(monto(first.amount), 'pa-num-md'));
    amt.appendChild(el('span', 'pa-amt-label', first.label));
    card.appendChild(amt);

    p.items.slice(1).forEach(function (it) {
      const r = el('div', 'pa-card-row');
      r.appendChild(el('span', null, it.label));
      r.appendChild(el('strong', null, monto(it.amount)));
      card.appendChild(r);
    });
    return card;
  }

  function render() {
    const cont = $('paContenido');
    const lista = ordenadas();
    renderIndice(lista);
    cont.replaceChildren();

    if (!lista.length) {
      const v = el('div', 'pa-vacio');
      v.appendChild(el('h2', null, 'No hay promociones activas.'));
      if (puedeEditar) v.appendChild(boton('pa-btn-primary pa-self-start', 'fas fa-plus', 'Agregar la primera', null, () => abrir(null)));
      cont.appendChild(v);
      return;
    }

    const main = el('div', 'pa-main');
    main.appendChild(renderLead(lista[0]));
    if (lista.length > 1) {
      const side = el('div', 'pa-side');
      lista.slice(1).forEach((p, i) => side.appendChild(renderCard(p, i)));
      main.appendChild(side);
    }
    cont.appendChild(main);
  }

  function pintarBotonEditar() {
    const b = $('paToggleEdit');
    b.setAttribute('aria-pressed', String(editando));
    b.querySelector('i').className = editando ? 'fas fa-check' : 'fas fa-pen';
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
      const del = boton('pa-btn-ghost pa-btn-icon', 'fas fa-xmark', null, 'Quitar monto', function () {
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
    $('paHoy').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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

    cargar();
  });
})();
