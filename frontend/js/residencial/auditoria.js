/**
 * Auditoría de llamadas (residencial/auditoria.html). API: routers/auditoria.py.
 *
 * Las llamadas las manda el servicio de captura que corre en la PC donde suenan (micrófono =
 * agente, audífonos = cliente). Aquí:
 * - Lista de llamadas del periodo, con las en curso arriba y el número de faltas.
 * - Detalle: transcripción completa frase por frase; las frases del agente que rompen una
 *   regla (R1–R6) van en rojo. Con grabación, el tiempo de cada frase salta a ese punto.
 * - Agente y cliente identificados por el CRM (estación, presentación en la llamada o lead
 *   tipificado); si falta o está mal, se corrige aquí (PATCH /api/auditoria/llamadas/{uuid}).
 * - Cada hallazgo: «Convertir en falta» (pasa a Monitoreo), «Revisado» o «Descartar».
 * - Todo llega al instante por el centro de notificaciones (evento «auditoria»); sin
 *   conexión en vivo se consulta cada 5 s. #<uuid> en la URL abre esa llamada.
 *
 * Solo para los auditores que define el backend (sesión con user.auditor).
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var FUENTE_AGENTE = { estacion: 'Asignado a la estación', llamada: 'Se presentó en la llamada', manual: 'Corregido a mano' };
  var FUENTE_CLIENTE = { tipificacion: 'Del lead tipificado', llamada: 'Lo dijo en la llamada', manual: 'Corregido a mano' };
  var ESTADOS = { nuevo: 'Pendiente', revisado: 'Revisado', descartado: 'Descartado', falta: 'Falta en Monitoreo' };

  var dias = 1, llamadas = [], actual = null, agentes = [], detalle = null;

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function api(url, opts) {
    opts = Object.assign({ credentials: 'include' }, opts || {});
    if (opts.body) opts.headers = { 'Content-Type': 'application/json' };
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Error ' + r.status);
        return d;
      });
    });
  }
  function hora(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }
  function fecha(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit' });
  }
  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function duracion(ll) {
    var a = new Date(ll.inicio), b = ll.fin ? new Date(ll.fin) : new Date();
    return isNaN(a) ? '' : mmss((b - a) / 1000);
  }
  function nombreAgente(ll) { return ll.agente || (ll.agente_detectado ? ll.agente_detectado + ' (?)' : ''); }
  function chip(r) { return el('span', 'pg-chip ' + (r.gravedad === 'alta' ? 'pg-chip-rojo' : 'pg-chip-amarillo'), r.id + ' · ' + r.nombre); }

  // ── Lista ─────────────────────────────────────────────────────────
  function cargarLista() {
    return api('/api/auditoria/llamadas?dias=' + dias).then(function (d) {
      llamadas = (d.llamadas || []).sort(function (a, b) {
        return (a.estado === 'en_curso' ? 0 : 1) - (b.estado === 'en_curso' ? 0 : 1) || (a.inicio < b.inicio ? 1 : -1);
      });
      pintarLista();
    }).catch(function (e) { $('au-lista').textContent = ''; $('au-lista').appendChild(el('li', 'pg-vacio', e.message)); });
  }

  function pintarLista() {
    var ul = $('au-lista');
    ul.textContent = '';
    if (!llamadas.length) { ul.appendChild(el('li', 'pg-vacio', 'Sin llamadas en este periodo.')); return; }
    llamadas.forEach(function (ll) {
      var li = el('li'), b = el('button', 'au-item');
      b.type = 'button';
      if (ll.uuid === actual) b.setAttribute('aria-current', 'true');
      var l1 = el('span', 'au-item-l1');
      l1.appendChild(nombreAgente(ll) ? el('span', null, nombreAgente(ll)) : el('span', 'au-sin', 'Agente sin identificar'));
      if (ll.faltas) l1.appendChild(el('span', 'pg-chip pg-chip-rojo', ll.faltas + (ll.faltas === 1 ? ' falta' : ' faltas')));
      var l2 = el('span', 'au-item-l2');
      l2.appendChild(el('span', null, (ll.cliente || 'Cliente sin identificar')));
      if (ll.estado === 'en_curso') {
        var v = el('span', 'au-vivo'); v.appendChild(el('i')); v.appendChild(document.createTextNode('En curso')); l2.appendChild(v);
      } else {
        l2.appendChild(el('span', null, (dias > 1 ? fecha(ll.inicio) + ' ' : '') + hora(ll.inicio) + ' · ' + duracion(ll)));
      }
      b.append(l1, l2);
      b.addEventListener('click', function () { abrir(ll.uuid); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ── Detalle ───────────────────────────────────────────────────────
  function abrir(uuid) {
    if (actual !== uuid) {
      actual = uuid;
      detalle = null;
      var audio = $('au-audio');
      audio.pause(); audio.removeAttribute('src'); audio.hidden = true;
      history.replaceState(null, '', '#' + uuid);
    }
    pintarLista();
    cargarDetalle(true);
  }

  function cargarDetalle(alFinal) {
    if (!actual) return Promise.resolve();
    var uuid = actual;
    return api('/api/auditoria/llamadas/' + uuid).then(function (d) {
      if (uuid !== actual) return;
      var tx = $('au-tx');
      var abajo = alFinal || tx.scrollHeight - tx.scrollTop - tx.clientHeight < 40;
      detalle = d;
      pintarDetalle();
      if (abajo) tx.scrollTop = tx.scrollHeight;
    }).catch(function (e) {
      $('au-det').hidden = true; $('au-det-vacio').hidden = false; $('au-det-vacio').textContent = e.message;
    });
  }

  function pintarDetalle() {
    var ll = detalle.llamada;
    $('au-det-vacio').hidden = true;
    $('au-det').hidden = false;
    $('au-det-titulo').textContent = 'Llamada de las ' + hora(ll.inicio) + (dias > 1 ? ' del ' + fecha(ll.inicio) : '');
    $('au-det-sub').textContent = [ll.estacion && 'Estación ' + ll.estacion, 'Duración ' + duracion(ll),
      ll.faltas ? ll.faltas + (ll.faltas === 1 ? ' falta' : ' faltas') : 'Sin faltas'].filter(Boolean).join(' · ');
    $('au-det-vivo').hidden = ll.estado !== 'en_curso';

    // Agente: la lista de agentes, más el de la llamada si no está en ella.
    var sel = $('au-agente');
    sel.textContent = '';
    sel.appendChild(new Option('Sin identificar', ''));
    var lista = agentes.slice();
    if (ll.agente_id && !lista.some(function (a) { return a.id === ll.agente_id; })) lista.unshift({ id: ll.agente_id, username: ll.agente, team: ll.team });
    lista.forEach(function (a) { sel.appendChild(new Option(a.username + (a.team ? ' — ' + a.team.replace(/^\s*team\s+/i, '') : ''), a.id)); });
    sel.value = ll.agente_id || '';
    var fa = $('au-agente-fuente');
    fa.className = 'au-fuente' + (ll.agente_id ? '' : ' au-falta-dato');
    fa.textContent = ll.agente_id ? (FUENTE_AGENTE[ll.agente_fuente] || '')
      : (ll.agente_detectado ? 'Dijo llamarse «' + ll.agente_detectado + '»: no coincide con ningún usuario' : 'Aún no se presenta');

    var inp = $('au-cliente');
    if (document.activeElement !== inp) inp.value = ll.cliente;
    var fc = $('au-cliente-fuente');
    fc.className = 'au-fuente' + (ll.cliente ? '' : ' au-falta-dato');
    fc.textContent = ll.cliente ? (FUENTE_CLIENTE[ll.cliente_fuente] || '') + (ll.lead_id ? ' (lead #' + ll.lead_id + ')' : '')
      : 'Aún sin nombre: se toma de la llamada o del lead que tipifique el agente';

    var audio = $('au-audio');
    if (ll.audio && audio.hidden) { audio.src = '/api/auditoria/llamadas/' + ll.uuid + '/audio'; audio.hidden = false; }

    pintarTranscripcion();
    pintarHallazgos();
  }

  function pintarTranscripcion() {
    var ol = $('au-tx'), audio = $('au-audio');
    ol.textContent = '';
    if (!detalle.segmentos.length) { ol.appendChild(el('li', 'pg-vacio', 'Esperando la primera frase…')); return; }
    detalle.segmentos.forEach(function (s) {
      var li = el('li', 'au-seg au-seg-' + s.canal + (s.reglas.length ? ' au-seg-falta' : ''));
      li.setAttribute('data-ini', s.t_ini); li.setAttribute('data-fin', s.t_fin);
      li.id = 'au-seg-' + s.id;
      var t = el('button', 'au-seg-t', mmss(s.t_ini));
      t.type = 'button';
      t.disabled = audio.hidden;
      t.setAttribute('aria-label', 'Escuchar desde ' + mmss(s.t_ini));
      t.addEventListener('click', function () { audio.currentTime = s.t_ini; audio.play(); });
      var quien = el('span', 'au-seg-quien', s.canal === 'agente' ? 'Agente' : 'Cliente');
      var txt = el('div', 'au-seg-txt', s.texto);
      if (s.reglas.length) {
        var rr = el('div', 'au-seg-reglas');
        s.reglas.forEach(function (r) { rr.appendChild(chip(r)); });
        txt.appendChild(rr);
      }
      li.append(t, quien, txt);
      ol.appendChild(li);
    });
  }

  function accion(texto, fn) {
    var b = el('button', 'pg-boton', texto);
    b.type = 'button';
    b.addEventListener('click', function () {
      b.disabled = true;
      fn().then(function () { return Promise.all([cargarDetalle(), cargarLista()]); })
        .catch(function (e) { b.disabled = false; alerta(e.message); });
    });
    return b;
  }
  function alerta(msg) {
    var h = $('au-hall'), p = el('p', 'au-fuente au-falta-dato', msg);
    p.setAttribute('role', 'alert');
    h.insertBefore(p, h.firstChild);
    setTimeout(function () { p.remove(); }, 6000);
  }

  function pintarHallazgos() {
    var cont = $('au-hall');
    cont.textContent = '';
    if (!detalle.hallazgos.length) return;
    cont.appendChild(el('h3', null, 'Faltas detectadas'));
    detalle.hallazgos.forEach(function (h) {
      var fila = el('div', 'au-hall-item');
      var txt = el('div', 'au-hall-txt');
      txt.appendChild(chip({ id: h.regla, nombre: h.detalle, gravedad: h.gravedad }));
      txt.appendChild(el('span', null, ESTADOS[h.estado] + (h.revisado_por ? ' · ' + h.revisado_por : '')));
      var acc = el('div', 'au-acciones');
      var ir = el('button', 'pg-boton', 'Ver frase');
      ir.type = 'button';
      ir.addEventListener('click', function () {
        var seg = $('au-seg-' + h.segmento_id);
        if (seg) { seg.scrollIntoView({ block: 'center' }); seg.querySelector('.au-seg-t').focus(); }
      });
      acc.appendChild(ir);
      if (h.estado !== 'falta') {
        acc.appendChild(accion('Convertir en falta', function () { return api('/api/auditoria/hallazgos/' + h.id + '/falta', { method: 'POST' }); }));
        if (h.estado !== 'revisado') acc.appendChild(accion('Revisado', function () { return api('/api/auditoria/hallazgos/' + h.id, { method: 'PATCH', body: JSON.stringify({ estado: 'revisado' }) }); }));
        if (h.estado !== 'descartado') acc.appendChild(accion('Descartar', function () { return api('/api/auditoria/hallazgos/' + h.id, { method: 'PATCH', body: JSON.stringify({ estado: 'descartado' }) }); }));
      }
      fila.append(txt, acc);
      cont.appendChild(fila);
    });
  }

  function corregir(cambio) {
    if (!actual) return;
    api('/api/auditoria/llamadas/' + actual, { method: 'PATCH', body: JSON.stringify(cambio) })
      .then(function () { return Promise.all([cargarDetalle(), cargarLista()]); })
      .catch(function (e) { alerta(e.message); });
  }

  // La frase que está sonando se resalta.
  $('au-audio').addEventListener('timeupdate', function () {
    var t = this.currentTime;
    document.querySelectorAll('.au-seg').forEach(function (li) {
      li.classList.toggle('au-seg-sonando', t >= Number(li.getAttribute('data-ini')) && t < Number(li.getAttribute('data-fin')));
    });
  });
  $('au-audio').addEventListener('loadedmetadata', function () {
    document.querySelectorAll('.au-seg-t').forEach(function (b) { b.disabled = false; });
  });

  // ── Arranque ──────────────────────────────────────────────────────
  Promise.resolve(window.__sesion).then(function (s) {
    if (!(s && s.user && s.user.auditor)) { $('au-sin-permiso').hidden = false; return; }
    $('au-contenido').hidden = false;

    document.querySelectorAll('[data-dias]').forEach(function (b) {
      b.addEventListener('click', function () {
        dias = Number(b.getAttribute('data-dias'));
        document.querySelectorAll('[data-dias]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        cargarLista();
      });
    });
    $('au-agente').addEventListener('change', function () { corregir({ agente_id: this.value ? Number(this.value) : null }); });
    $('au-cliente').addEventListener('change', function () { corregir({ cliente: this.value }); });

    api('/api/auditoria/agentes').then(function (d) { agentes = d.agentes || []; if (detalle) pintarDetalle(); }).catch(function () {});
    cargarLista().then(function () {
      var pedida = location.hash.slice(1);
      var enCurso = llamadas.filter(function (l) { return l.estado === 'en_curso'; })[0];
      if (pedida) abrir(pedida);
      else if (enCurso) abrir(enCurso.uuid);
    });

    // Al instante: cada frase nueva, falta o cambio llega como evento «auditoria».
    var tLista = null, tDet = null;
    function enganchar() {
      if (!window.CRMNotificaciones) return setTimeout(enganchar, 300);
      window.CRMNotificaciones.on('auditoria', function (ev) {
        clearTimeout(tLista); tLista = setTimeout(cargarLista, 400);
        if (ev.llamada && ev.llamada === actual) { clearTimeout(tDet); tDet = setTimeout(cargarDetalle, 200); }
        else if (!actual && ev.llamada) abrir(ev.llamada);     // nada abierto: se abre la nueva
      });
    }
    enganchar();
    setInterval(function () {
      if (document.hidden || (window.CRMNotificaciones && window.CRMNotificaciones.enVivo())) return;
      cargarLista();
      if (detalle && detalle.llamada.estado === 'en_curso') cargarDetalle();
    }, 5000);
  });
})();
