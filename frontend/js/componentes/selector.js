/**
 * Listas desplegables con estilo propio para todo el CRM.
 *
 * Las listas nativas (<select>) las dibuja el sistema operativo y no se pueden
 * estilizar. Este componente pone encima de cada <select> un botón y una lista propios,
 * SIN quitar el <select>: sigue en su sitio (invisible), con su id, su name y su valor.
 * Así el resto del código no cambia:
 *   - leer o escribir  sel.value  /  sel.selectedIndex  → el botón se actualiza solo;
 *   - rellenar las opciones (innerHTML, appendChild…) → la lista se actualiza sola;
 *   - al elegir se disparan  input  y  change  en el <select>, como con el nativo;
 *   - disabled y los estilos de error (borde rojo) se copian al botón.
 *
 * Uso:  Selector.auto(contenedor)  — mejora los <select> que haya y los que se añadan
 * después (formularios pintados por JS). Excluir uno: <select data-nativo>.
 * Teclado: Enter/Espacio/↓ abre; ↑↓ Inicio Fin se mueven; Enter elige; Esc cierra;
 * escribir salta a la opción que empieza por esas letras. Con más de 8 opciones la
 * lista trae un buscador.
 */
(function () {
  'use strict';

  var BUSCADOR_DESDE = 8;
  var abierto = null;                 // { sel, btn, lista, ... } del que está abierto
  var n = 0;

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function mejorar(sel) {
    if (sel.__selector || sel.multiple || sel.hasAttribute('data-nativo') || sel.size > 1) return;
    var id = 'sel-' + (++n);
    var caja = document.createElement('span');
    caja.className = 'sel';
    if (sel.parentNode.classList && sel.parentNode.classList.contains('fr-input')) caja.classList.add('sel-con-icono');
    sel.parentNode.insertBefore(caja, sel);
    caja.appendChild(sel);
    sel.classList.add('sel-nativo');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    var etiqueta = sel.id && document.querySelector('label[for="' + sel.id + '"]');
    if (etiqueta) { etiqueta.id = etiqueta.id || id + '-lbl'; btn.setAttribute('aria-labelledby', etiqueta.id + ' ' + id + '-txt'); }
    else if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    btn.innerHTML = '<span class="sel-txt" id="' + id + '-txt"></span><span class="sel-flecha" aria-hidden="true"></span>';
    caja.appendChild(btn);

    var s = { sel: sel, btn: btn, caja: caja, id: id };
    sel.__selector = s;

    // sel.value = … y sel.selectedIndex = … desde otro código → repintar el botón.
    ['value', 'selectedIndex'].forEach(function (prop) {
      var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      Object.defineProperty(sel, prop, {
        configurable: true,
        get: function () { return d.get.call(this); },
        set: function (v) { d.set.call(this, v); pintar(s); },
      });
    });
    new MutationObserver(function () { pintar(s); if (abierto === s) pintarLista(s); })
      .observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'style'] });
    sel.addEventListener('change', function () { pintar(s); });
    sel.addEventListener('focus', function () { btn.focus(); });   // <label for> enfoca el <select>
    if (etiqueta) etiqueta.addEventListener('click', function (e) { e.preventDefault(); btn.focus(); });

    btn.addEventListener('click', function () { abierto === s ? cerrar() : abrir(s); });
    btn.addEventListener('keydown', function (e) { teclaBoton(s, e); });
    pintar(s);
  }

  function pintar(s) {
    var o = s.sel.options[s.sel.selectedIndex];
    var txt = s.btn.querySelector('.sel-txt');
    txt.textContent = o ? o.text : '';
    s.btn.classList.toggle('sel-vacio', !o || o.value === '');
    s.btn.disabled = s.sel.disabled;
    // Los avisos de validación pintan el borde del <select>: se trasladan al botón.
    s.btn.style.borderColor = s.sel.style.borderColor;
    s.btn.style.boxShadow = s.sel.style.boxShadow;
  }

  // ── Lista ──
  function opciones(s) { return Array.prototype.slice.call(s.sel.options); }
  function abrir(s) {
    if (s.sel.disabled) return;
    cerrar();
    abierto = s;
    var lista = document.createElement('div');
    lista.className = 'sel-lista';
    lista.id = s.id;
    var conBuscador = opciones(s).length > BUSCADOR_DESDE;
    lista.innerHTML = (conBuscador ? '<div class="sel-buscar"><input type="text" placeholder="Buscar…" aria-label="Buscar opción" autocomplete="off"></div>' : '') +
      '<div class="sel-opciones" role="listbox" tabindex="-1"></div>';
    document.body.appendChild(lista);
    s.lista = lista;
    s.filtro = '';
    s.activa = s.sel.selectedIndex;
    pintarLista(s);
    colocar(s);
    s.btn.setAttribute('aria-expanded', 'true');
    s.caja.classList.add('sel-abierto');

    lista.addEventListener('mousedown', function (e) { if (!e.target.closest('input')) e.preventDefault(); });   // no quitar el foco
    lista.addEventListener('click', function (e) {
      var op = e.target.closest('[data-i]');
      if (op && !op.hasAttribute('aria-disabled')) elegir(s, +op.dataset.i);
    });
    lista.addEventListener('mousemove', function (e) {
      var op = e.target.closest('[data-i]');
      if (op && +op.dataset.i !== s.activa) { s.activa = +op.dataset.i; marcarActiva(s, false); }
    });
    var buscar = lista.querySelector('.sel-buscar input');
    if (buscar) {
      buscar.addEventListener('input', function () { s.filtro = buscar.value; pintarLista(s); });
      buscar.addEventListener('keydown', function (e) { teclaLista(s, e); });
      buscar.focus();
    }
  }
  function visibles(s) {
    var f = norm(s.filtro);
    return opciones(s).map(function (o, i) { return { o: o, i: i }; })
      .filter(function (x) { return !f || norm(x.o.text).indexOf(f) >= 0; });
  }
  function pintarLista(s) {
    var cont = s.lista.querySelector('.sel-opciones'), vis = visibles(s);
    if (vis.length && !vis.some(function (x) { return x.i === s.activa; })) s.activa = vis[0].i;
    cont.innerHTML = vis.length ? '' : '<div class="sel-nada">Sin resultados</div>';
    vis.forEach(function (x) {
      var d = document.createElement('div');
      d.className = 'sel-op' + (x.o.value === '' ? ' sel-op-vacia' : '');
      d.dataset.i = x.i;
      d.id = s.id + '-op-' + x.i;
      d.setAttribute('role', 'option');
      d.setAttribute('aria-selected', String(x.i === s.sel.selectedIndex));
      if (x.o.disabled) d.setAttribute('aria-disabled', 'true');
      d.textContent = x.o.text;
      cont.appendChild(d);
    });
    marcarActiva(s, true);
  }
  function marcarActiva(s, desplazar) {
    var cont = s.lista.querySelector('.sel-opciones');
    cont.querySelectorAll('.sel-op-activa').forEach(function (e) { e.classList.remove('sel-op-activa'); });
    var el = cont.querySelector('[data-i="' + s.activa + '"]');
    if (el) {
      el.classList.add('sel-op-activa');
      cont.setAttribute('aria-activedescendant', el.id);
      if (desplazar) el.scrollIntoView({ block: 'nearest' });
    }
  }
  function colocar(s) {
    var r = s.btn.getBoundingClientRect(), l = s.lista;
    l.style.minWidth = r.width + 'px';
    l.style.left = Math.max(8, Math.min(r.left, window.innerWidth - l.offsetWidth - 8)) + 'px';
    var abajo = window.innerHeight - r.bottom, arriba = r.top;
    var alto = Math.min(l.scrollHeight, 320);
    if (abajo < alto + 12 && arriba > abajo) { l.style.top = ''; l.style.bottom = (window.innerHeight - r.top + 4) + 'px'; l.classList.add('sel-arriba'); }
    else { l.style.bottom = ''; l.style.top = (r.bottom + 4) + 'px'; l.classList.remove('sel-arriba'); }
  }
  function cerrar(devolverFoco) {
    if (!abierto) return;
    var s = abierto;
    abierto = null;
    if (s.lista) s.lista.remove();
    s.lista = null;
    s.btn.setAttribute('aria-expanded', 'false');
    s.caja.classList.remove('sel-abierto');
    if (devolverFoco) s.btn.focus();
  }
  function elegir(s, i) {
    var cambia = s.sel.selectedIndex !== i;
    s.sel.selectedIndex = i;
    cerrar(true);
    if (cambia) {
      s.sel.dispatchEvent(new Event('input', { bubbles: true }));
      s.sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ── Teclado ──
  var tecleo = '', tecleoT = 0;
  function saltarPorLetra(s, ch) {
    clearTimeout(tecleoT);
    tecleo += norm(ch);
    tecleoT = setTimeout(function () { tecleo = ''; }, 600);
    var ops = opciones(s);
    for (var k = 1; k <= ops.length; k++) {
      var i = ((abierto === s ? s.activa : s.sel.selectedIndex) + k) % ops.length;
      if (!ops[i].disabled && norm(ops[i].text).indexOf(tecleo) === 0) return i;
    }
    return -1;
  }
  function teclaBoton(s, e) {
    if (abierto === s) { teclaLista(s, e); return; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(s); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var i = saltarPorLetra(s, e.key);
      if (i >= 0) elegir(s, i);
    }
  }
  function teclaLista(s, e) {
    var vis = visibles(s).filter(function (x) { return !x.o.disabled; });
    var pos = vis.map(function (x) { return x.i; }).indexOf(s.activa);
    var mover = function (p) { if (vis.length) { s.activa = vis[Math.max(0, Math.min(vis.length - 1, p))].i; marcarActiva(s, true); } };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); mover(pos + 1); break;
      case 'ArrowUp': e.preventDefault(); mover(pos - 1); break;
      case 'Home': if (e.target.tagName !== 'INPUT') { e.preventDefault(); mover(0); } break;
      case 'End': if (e.target.tagName !== 'INPUT') { e.preventDefault(); mover(vis.length - 1); } break;
      case 'Enter': e.preventDefault(); if (pos >= 0) elegir(s, s.activa); break;
      case 'Escape': e.preventDefault(); cerrar(true); break;
      case 'Tab': cerrar(); break;
      default:
        if (e.target.tagName !== 'INPUT' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          var i = saltarPorLetra(s, e.key);
          if (i >= 0) { s.activa = i; marcarActiva(s, true); }
        }
    }
  }

  document.addEventListener('mousedown', function (e) {
    if (abierto && !abierto.caja.contains(e.target) && !(abierto.lista && abierto.lista.contains(e.target))) cerrar();
  });
  window.addEventListener('resize', function () { if (abierto) colocar(abierto); });
  document.addEventListener('scroll', function (e) {
    if (abierto && !(abierto.lista && abierto.lista.contains(e.target))) colocar(abierto);
  }, true);

  function auto(raiz) {
    raiz = raiz || document.body;
    raiz.querySelectorAll('select').forEach(mejorar);
    new MutationObserver(function (cambios) {
      cambios.forEach(function (c) {
        c.addedNodes.forEach(function (nodo) {
          if (nodo.nodeType !== 1) return;
          if (nodo.tagName === 'SELECT') mejorar(nodo);
          else nodo.querySelectorAll && nodo.querySelectorAll('select').forEach(mejorar);
        });
      });
    }).observe(raiz, { childList: true, subtree: true });
  }

  window.Selector = { auto: auto, mejorar: mejorar };
})();
