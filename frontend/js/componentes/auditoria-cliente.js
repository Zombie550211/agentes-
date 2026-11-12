/**
 * Auditoría de llamadas en la Lista de Clientes (residencial/costumer.html).
 *
 * Las llamadas auditadas (panel del auditor) llevan teléfono y/o No. de cuenta. Si coinciden con un
 * cliente, su fila muestra en «Acción» el botón de audífonos, y al pulsarlo se abre esta ventana: la
 * llamada transcrita y las faltas (sin el audio, a pedido de Daniel).
 *
 * La ve todo el que ve la Lista de Clientes, solo en sus clientes: el servidor decide por cliente con
 * la frontera del listado (routers/auditoria.py). La página «Auditoría de llamadas» sigue restringida.
 *   window.AudCliente.pedir(ids)   pregunta qué clientes de la página tienen llamadas (una vez por id)
 *   window.AudCliente.tiene(id)    → null o { llamadas, faltas }
 *   window.AudCliente.abrir(lead)
 * Cuando llegan respuestas avisa con el evento «auditoria:vinculos» para que la tabla se repinte.
 */
(function () {
  'use strict';

  var marcas = {};   // id → { llamadas, faltas } | null (ya preguntado, sin llamadas)
  // Audífonos de diadema (mismo dibujo que el botón de la lista).
  var AUD_SVG = '<svg class="aud-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
  var ESTADOS = { nuevo: 'Pendiente', revisado: 'Revisado', descartado: 'Descartado', falta: 'Falta confirmada' };

  function nTel(s) { var d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function ico(nombre) { var i = el('i', 'ph ph-' + nombre); i.setAttribute('aria-hidden', 'true'); return i; }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function fechaHora(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }
  function duracion(ll) { var a = new Date(ll.inicio), b = new Date(ll.fin); return isNaN(a) || isNaN(b) ? '' : mmss((b - a) / 1000); }
  function fmtTel(t) { t = String(t || ''); return t.length === 10 ? '(' + t.slice(0, 3) + ') ' + t.slice(3, 6) + '-' + t.slice(6) : t; }

  // ── Qué clientes de la página tienen llamadas ──────────────────────
  var enCurso = false, cola = [];
  function pedir(ids) {
    (ids || []).forEach(function (id) {
      id = String(id || '');
      if (id && !(id in marcas) && cola.indexOf(id) < 0) cola.push(id);
    });
    if (enCurso || !cola.length) return;
    var lote = cola.splice(0, 300);
    enCurso = true;
    fetch('/api/auditoria/marcas', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: lote })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var hay = false;
        lote.forEach(function (id) { marcas[id] = (d.marcas && d.marcas[id]) || null; if (marcas[id]) hay = true; });
        if (hay) document.dispatchEvent(new CustomEvent('auditoria:vinculos'));
      })
      .catch(function () {})
      .then(function () { enCurso = false; if (cola.length) pedir([]); });
  }

  function tiene(id) { return marcas[String(id)] || null; }

  // ── Ventana ─────────────────────────────────────────────────────────
  var dlg, cuerpo, titulo, sub, datos = [], actual = 0;

  function crear() {
    dlg = el('dialog', 'audc');
    dlg.setAttribute('aria-labelledby', 'audc-titulo');
    var cab = el('div', 'audc-cab');
    var tx = el('div', 'audc-cab-txt');
    var ic = el('span', 'audc-ico'); ic.innerHTML = AUD_SVG;   // constante propia, sin datos
    titulo = el('h2', null, 'Llamadas auditadas'); titulo.id = 'audc-titulo';
    sub = el('p');
    tx.append(titulo, sub);
    var cerrar = el('button', 'audc-cerrar');
    cerrar.type = 'button'; cerrar.setAttribute('aria-label', 'Cerrar'); cerrar.appendChild(ico('x'));
    cerrar.addEventListener('click', function () { dlg.close(); });
    cab.append(ic, tx, cerrar);
    cuerpo = el('div', 'audc-cuerpo');
    dlg.append(cab, cuerpo);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });   // clic fuera
    document.body.appendChild(dlg);
  }

  function abrir(lead) {
    if (!dlg) crear();
    titulo.textContent = 'Llamadas auditadas · ' + (lead.nombre_cliente || 'Cliente');
    sub.textContent = [nTel(lead.telefono) && fmtTel(nTel(lead.telefono)), nTel(lead.telefono_alt) && fmtTel(nTel(lead.telefono_alt)),
      lead.numero_cuenta && 'ACC ' + lead.numero_cuenta].filter(Boolean).join(' · ');
    cuerpo.textContent = '';
    cuerpo.appendChild(el('p', 'audc-vacio', 'Cargando…'));
    if (!dlg.open) dlg.showModal();
    fetch('/api/auditoria/cliente/' + encodeURIComponent(String(lead._id)), { credentials: 'include' })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.detail || 'Error ' + r.status); return d; }); })
      .then(function (d) {
        datos = d.llamadas || []; actual = 0;
        if (!datos.length) { cuerpo.textContent = ''; cuerpo.appendChild(el('p', 'audc-vacio', 'Este cliente no tiene llamadas auditadas.')); return; }
        pintar();
      })
      .catch(function (e) { cuerpo.textContent = ''; cuerpo.appendChild(el('p', 'audc-vacio audc-error', e.message)); });
  }

  function pintar() {
    cuerpo.textContent = '';
    // Varias llamadas del mismo cliente: pestañas, la más reciente primero.
    if (datos.length > 1) {
      var tabs = el('div', 'audc-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Llamadas');
      datos.forEach(function (d, i) {
        var b = el('button', 'audc-tab'); b.type = 'button'; b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(i === actual));
        b.appendChild(el('span', null, fechaHora(d.llamada.inicio)));
        if (d.llamada.faltas) b.appendChild(el('span', 'audc-chip audc-chip-rojo', String(d.llamada.faltas)));
        b.addEventListener('click', function () { actual = i; pintar(); });
        tabs.appendChild(b);
      });
      cuerpo.appendChild(tabs);
    }
    var d = datos[actual], ll = d.llamada;

    var info = el('dl', 'audc-info');
    [['Agente', ll.agente || 'Sin identificar'], ['Fecha', fechaHora(ll.inicio)], ['Duración', duracion(ll)],
      ['Faltas', ll.faltas ? String(ll.faltas) : 'Ninguna']].forEach(function (p) {
      var w = el('div'); w.append(el('dt', null, p[0]), el('dd', null, p[1])); info.appendChild(w);
    });
    cuerpo.appendChild(info);

    if (Array.isArray(ll.saludo) || (ll.temas && ll.temas.length)) {
      var ex = el('div', 'audc-extra');
      if (Array.isArray(ll.saludo)) {
        var f1 = el('div', 'audc-fila'); f1.appendChild(el('span', 'audc-rot', 'Saludo'));
        if (!ll.saludo.length) f1.appendChild(el('span', 'audc-chip audc-chip-verde', 'Completo'));
        else { f1.appendChild(el('span', 'audc-chip audc-chip-rojo', 'Le faltó')); ll.saludo.forEach(function (x) { f1.appendChild(el('span', null, x)); }); }
        ex.appendChild(f1);
      }
      if (ll.temas && ll.temas.length) {
        var f2 = el('div', 'audc-fila'); f2.appendChild(el('span', 'audc-rot', 'Temas'));
        ll.temas.forEach(function (x) { f2.appendChild(el('span', 'audc-chip', x)); });
        ex.appendChild(f2);
      }
      cuerpo.appendChild(ex);
    }

    if (d.hallazgos.length) {
      var h = el('section', 'audc-faltas'); h.setAttribute('aria-label', 'Faltas');
      h.appendChild(el('h3', null, 'Faltas'));
      d.hallazgos.forEach(function (x) {
        var fila = el('div', 'audc-falta');
        var cab = el('div', 'audc-fila');
        cab.append(el('span', 'audc-chip audc-chip-rojo', x.regla + ' · ' + x.detalle), el('span', 'audc-estado', ESTADOS[x.estado] || x.estado));
        var ir = el('button', 'audc-ir', 'Ver en la llamada'); ir.type = 'button';
        ir.addEventListener('click', function () {
          var seg = cuerpo.querySelector('[data-seg="' + x.segmento_id + '"]');
          if (seg) {
            seg.scrollIntoView({ block: 'center' });
            seg.classList.add('audc-resaltar');
            setTimeout(function () { seg.classList.remove('audc-resaltar'); }, 1600);
          }
        });
        cab.appendChild(ir);
        fila.append(cab, el('p', null, x.frase));
        h.appendChild(fila);
      });
      cuerpo.appendChild(h);
    }

    var tx = el('ol', 'audc-tx'); tx.setAttribute('aria-label', 'Transcripción');
    d.segmentos.forEach(function (s) {
      var li = el('li', 'audc-seg audc-' + s.canal + (s.reglas.length ? ' audc-seg-falta' : ''));
      li.setAttribute('data-seg', s.id);
      var t = el('span', 'audc-t', mmss(s.t_ini));
      var txt = el('div', 'audc-seg-txt', s.texto);
      if (s.reglas.length) {
        var rr = el('div', 'audc-reglas');
        s.reglas.forEach(function (r) { rr.appendChild(el('span', 'audc-chip audc-chip-rojo', r.id + ' · ' + r.nombre)); });
        txt.appendChild(rr);
      }
      li.append(t, el('span', 'audc-quien', s.canal === 'agente' ? 'Agente' : 'Cliente'), txt);
      tx.appendChild(li);
    });
    var tsec = el('section', 'audc-tx-sec'); tsec.append(el('h3', null, 'Transcripción'), tx);
    cuerpo.appendChild(tsec);

  }

  window.AudCliente = { pedir: pedir, tiene: tiene, abrir: abrir };
})();
