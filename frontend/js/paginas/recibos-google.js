/**
 * Recibos de Google Ads (residencial/recibos-google.html) — solo administradores.
 *
 * Historial de pagos de Google Ads con su comprobante PDF, agrupado por fecha de pago.
 * Al subir PDF se abre una ventana con una tarjeta por archivo: cada uno se escanea en
 * el servidor (fecha, Billing ID, tarjeta y monto) y el usuario revisa los datos y elige
 * la cuenta antes de guardar. Todo o nada: si un PDF falla, no se guarda ninguno.
 *
 * Todo el DOM se construye con createElement/textContent (los datos nunca van a innerHTML).
 * API: /api/recibos-google/* (CRM_PYTHON/routers/recibos_google.py)
 */
(function () {
  'use strict';

  var API = '/api/recibos-google';
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MAX_ARCHIVOS = 20, MAX_BYTES = 10 * 1024 * 1024;
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  var cuentas = [];             // [{clave, nombre, campo, clase}]
  var pendientes = [];          // tarjetas de la ventana de subida
  var plegados = {};            // fechas de grupo cerradas en el historial

  // ── utilidades ──
  function $(id) { return document.getElementById(id); }
  function dinero(centavos) { return usd.format((centavos || 0) / 100); }
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fechaCorta(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fechaLarga(iso) { var p = iso.split('-').map(Number); return p[2] + ' de ' + MESES[p[1] - 1] + ' de ' + p[0]; }
  function tamano(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

  /** el('span', {class:'x', text:'…', title:'…'}, hijo1, hijo2…) */
  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i] != null) n.append(arguments[i]);
    return n;
  }
  function icono(nombre) { return el('i', { class: 'ph ph-' + nombre, 'aria-hidden': 'true' }); }
  function cuentaDe(clave) { return cuentas.find(function (c) { return c.clave === clave; }); }
  function etiquetaCuenta(clave, nombre) {
    var c = cuentaDe(clave);
    return el('span', { class: 'pg-chip rg-cuenta ' + (c ? c.clase : ''), text: nombre || (c ? c.nombre : clave) });
  }

  async function api(url, opciones) {
    var r = await fetch(url, Object.assign({ credentials: 'include' }, opciones || {}));
    if (r.status === 401) { location.replace('/login.html'); throw new Error('Sesión vencida'); }
    if (!r.ok) {
      var msg = 'Error ' + r.status;
      try {
        var j = await r.json();
        if (typeof j.detail === 'string') msg = j.detail;
        else if (Array.isArray(j.detail)) msg = 'Datos inválidos';
      } catch (_) { /* sin cuerpo JSON */ }
      throw new Error(msg);
    }
    return r.json();
  }

  var avisoTimer;
  function avisar(texto, error) {
    var a = $('rg-aviso');
    a.textContent = texto;
    a.classList.toggle('rg-aviso-error', !!error);
    a.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { a.hidden = true; }, 4500);
  }

  // ── filtros ──
  function parametros() {
    var p = new URLSearchParams();
    if ($('rg-desde').value) p.set('desde', $('rg-desde').value);
    if ($('rg-hasta').value) p.set('hasta', $('rg-hasta').value);
    if ($('rg-cuenta').value) p.set('cuenta', $('rg-cuenta').value);
    if ($('rg-q').value.trim()) p.set('q', $('rg-q').value.trim());
    return p.toString();
  }

  // ── indicadores e historial ──
  async function cargarResumen() {
    var r = await api(API + '/resumen');
    $('rg-kpi-total-lbl').textContent = 'Total pagado en ' + MESES[Number(r.mes.slice(5, 7)) - 1];
    $('rg-kpi-total').textContent = dinero(r.total_mes_centavos);
    $('rg-kpi-recibos').textContent = String(r.recibos);
    $('rg-kpi-ultimo').textContent = r.ultimo_pago ? fechaCorta(r.ultimo_pago) : '—';
  }

  async function cargarRecibos() {
    var r = await api(API + '?' + parametros());
    pintarTabla(r.recibos || []);
  }

  function pintarTabla(recibos) {
    var cuerpo = $('rg-cuerpo');
    cuerpo.replaceChildren();
    $('rg-vacio').hidden = recibos.length > 0;
    var totalFiltro = recibos.reduce(function (s, r) { return s + r.monto_centavos; }, 0);
    $('rg-chip-total').hidden = !recibos.length;
    $('rg-chip-total').textContent = recibos.length + (recibos.length === 1 ? ' recibo · ' : ' recibos · ') + dinero(totalFiltro);

    var grupos = new Map();
    recibos.forEach(function (r) {
      if (!grupos.has(r.fecha_pago)) grupos.set(r.fecha_pago, []);
      grupos.get(r.fecha_pago).push(r);
    });

    grupos.forEach(function (filas, fecha) {
      var abierto = !plegados[fecha];
      var total = filas.reduce(function (s, r) { return s + r.monto_centavos; }, 0);
      var toggle = el('button', { type: 'button', class: 'rg-grupo-btn', 'aria-expanded': String(abierto) },
        icono('caret-down'),
        el('span', { class: 'rg-grupo-fecha', text: fechaLarga(fecha) }),
        el('span', { class: 'rg-grupo-n', text: ' · ' + filas.length + (filas.length === 1 ? ' recibo' : ' recibos') }));
      var filasTr = [];
      toggle.addEventListener('click', function () {
        plegados[fecha] = !plegados[fecha];
        toggle.setAttribute('aria-expanded', String(!plegados[fecha]));
        filasTr.forEach(function (tr) { tr.hidden = !!plegados[fecha]; });
      });
      cuerpo.append(el('tr', { class: 'rg-grupo' },
        el('td', { colspan: '3', class: 'pg-izq' }, toggle),
        el('td', { class: 'rg-der rg-monto', text: dinero(total) }),
        el('td', { colspan: '2' })));

      filas.forEach(function (r) {
        var detalle = [r.metodo_pago, 'Subido por ' + r.subido_por].filter(Boolean).join(' · ');
        var ver = el('a', { class: 'pg-boton rg-accion', href: API + '/' + r.id + '/pdf', target: '_blank', rel: 'noopener',
          'aria-label': 'Ver ' + r.archivo_nombre }, icono('eye'), el('span', { text: 'Ver' }));
        var bajar = el('a', { class: 'pg-boton rg-accion rg-accion-icono', href: API + '/' + r.id + '/pdf?descargar=true',
          title: 'Descargar', 'aria-label': 'Descargar ' + r.archivo_nombre }, icono('download-simple'));
        var tr = el('tr', { class: 'rg-fila', title: detalle },
          el('td', { class: 'pg-izq rg-fecha', text: fechaCorta(r.fecha_pago) }),
          el('td', { class: 'pg-izq rg-c-cuenta' }, etiquetaCuenta(r.cuenta, r.cuenta_nombre)),
          el('td', { class: 'pg-izq rg-billing' },
            el('span', { class: 'rg-solo-movil', text: 'Billing ID ' }), el('span', { text: r.billing_id || '—' })),
          el('td', { class: 'rg-der rg-monto rg-c-monto', text: dinero(r.monto_centavos) }),
          el('td', { class: 'pg-izq rg-c-archivo' }, el('span', { class: 'rg-archivo', title: r.archivo_nombre },
            el('i', { class: 'ph ph-file-pdf rg-pdf', 'aria-hidden': 'true' }), el('span', { text: r.archivo_nombre }))),
          el('td', { class: 'rg-c-acciones' }, el('div', { class: 'rg-acciones' }, ver, bajar)));
        tr.hidden = !abierto;
        filasTr.push(tr);
        cuerpo.append(tr);
      });
    });
  }

  async function refrescar() {
    try {
      await Promise.all([cargarResumen(), cargarRecibos()]);
    } catch (e) {
      avisar('No se pudieron cargar los recibos: ' + e.message, true);
    }
  }

  // ── ventana de subida: escaneo y revisión ──
  // [clave, etiqueta, atributos del input]
  var CAMPOS = [
    ['fecha_pago', 'Fecha de pago', { type: 'date', required: true }],
    ['monto', 'Monto (USD)', { type: 'number', required: true, min: '0.01', step: '0.01', inputmode: 'decimal', placeholder: '0.00', class: 'rg-in-monto' }],
    ['billing_id', 'Billing ID', { maxlength: '14', pattern: '\\d{4}-\\d{4}-\\d{4}', placeholder: '0000-0000-0000', autocomplete: 'off' }],
    ['metodo_pago', 'Método de pago', { maxlength: '40', placeholder: 'Mastercard •••• 0000', autocomplete: 'off' }],
  ];

  function abrirVentana(archivos) {
    var lista = Array.prototype.slice.call(archivos);
    var pdfs = lista.filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); });
    var ignorados = lista.length - pdfs.length;
    if (!pdfs.length) { avisar('Solo se aceptan archivos PDF.', true); return; }
    if (pdfs.length > MAX_ARCHIVOS) { avisar('Máximo ' + MAX_ARCHIVOS + ' PDF por subida.', true); return; }
    var grandes = pdfs.filter(function (f) { return f.size > MAX_BYTES; });
    if (grandes.length) { avisar(grandes[0].name + ' pasa de 10 MB.', true); return; }
    if (ignorados) avisar(ignorados + (ignorados === 1 ? ' archivo ignorado' : ' archivos ignorados') + ': no son PDF.');

    pendientes = pdfs.map(function (archivo, i) { return { archivo: archivo, estado: 'leyendo', i: i }; });
    $('rg-dlg-error').hidden = true;
    $('rg-dlg-lista').replaceChildren.apply($('rg-dlg-lista'), pendientes.map(tarjeta));
    actualizarPie();
    $('rg-dlg').showModal();
    pendientes[0].select.focus();   // lo primero que hay que decidir es la cuenta
    pendientes.forEach(escanear);   // en paralelo
  }

  function tarjeta(item) {
    var id = 'rg-p' + item.i;
    var sel = el('select', { id: id + '-cuenta', required: true }, el('option', { value: '', text: '¿A qué cuenta pertenece?' }));
    cuentas.forEach(function (c) { sel.append(el('option', { value: c.clave, text: c.nombre })); });
    sel.addEventListener('change', function () { sel.classList.remove('rg-leido'); validarCuenta(item); });

    var quitar = el('button', { type: 'button', class: 'pg-boton rg-icono', title: 'Quitar', 'aria-label': 'Quitar ' + item.archivo.name }, icono('trash'));
    quitar.addEventListener('click', function () { quitarItem(item); });

    var campos = CAMPOS.map(function (c) {
      var input = el('input', Object.assign({ id: id + '-' + c[0], 'data-clave': c[0] }, c[2]));
      return el('div', { class: 'rg-campo' }, el('label', { for: input.id, text: c[1] }), input);
    });

    item.nodo = el('article', { class: 'rg-item', 'aria-label': item.archivo.name },
      el('div', { class: 'rg-item-nombre' },
        el('i', { class: 'ph ph-file-pdf rg-pdf', 'aria-hidden': 'true' }),
        el('span', { class: 'rg-item-archivo', text: item.archivo.name, title: item.archivo.name }),
        el('span', { class: 'rg-tenue', text: tamano(item.archivo.size) }),
        quitar),
      el('div', { class: 'rg-campo rg-campo-cuenta' }, el('label', { for: sel.id, text: 'Cuenta' }), sel),
      el('div', { class: 'rg-estado rg-leyendo', role: 'status' }, icono('spinner-gap'), el('span', { text: 'Escaneando…' })),
      el('div', { class: 'rg-campos' }, campos[0], campos[1], campos[2], campos[3]));
    item.select = sel;
    return item.nodo;
  }

  function input(item, clave) { return item.nodo.querySelector('[data-clave="' + clave + '"]'); }
  function validarCuenta(item) { item.select.classList.toggle('rg-falta', !item.select.value && item.marcado); }

  function ponerEstado(item, clase, ico, texto) {
    var e = item.nodo.querySelector('.rg-estado');
    e.className = 'rg-estado ' + clase;
    e.replaceChildren(icono(ico), el('span', { text: texto }));
  }

  async function escanear(item) {
    var fd = new FormData();
    fd.append('archivo', item.archivo, item.archivo.name);
    try {
      var d = await api(API + '/escanear', { method: 'POST', body: fd });
      if (pendientes.indexOf(item) < 0) return;          // lo quitaron mientras se escaneaba
      var leidos = 0;
      CAMPOS.forEach(function (c) {
        var inp = input(item, c[0]);
        if (d[c[0]] && !inp.value) { inp.value = d[c[0]]; inp.classList.add('rg-leido'); leidos++; }
      });
      if (d.cuenta_sugerida && !item.select.value && cuentaDe(d.cuenta_sugerida)) {
        item.select.value = d.cuenta_sugerida;
        item.select.classList.add('rg-leido');
      }
      var paginas = d.paginas + (d.paginas === 1 ? ' página' : ' páginas');
      if (d.duplicado) {
        item.estado = 'duplicado';
        ponerEstado(item, 'rg-error', 'warning-circle', 'Este PDF ya está registrado. Quítalo de la lista.');
      } else if (!d.con_texto) {
        item.estado = 'listo';
        ponerEstado(item, 'rg-advertencia', 'warning', 'El PDF es una imagen sin texto: completa los datos a mano.');
      } else if (leidos === CAMPOS.length || CAMPOS.every(function (c) { return d[c[0]]; })) {
        item.estado = 'listo';
        ponerEstado(item, 'rg-ok', 'check-circle', 'Datos leídos de ' + paginas + '. Revísalos antes de guardar.');
      } else {
        item.estado = 'listo';
        var faltan = CAMPOS.filter(function (c) { return !d[c[0]]; }).map(function (c) { return c[1]; });
        ponerEstado(item, 'rg-advertencia', 'warning', 'No se encontró: ' + faltan.join(', ') + '. Complétalo a mano.');
      }
    } catch (e) {
      if (pendientes.indexOf(item) < 0) return;
      item.estado = 'listo';
      ponerEstado(item, 'rg-error', 'warning-circle', 'No se pudo escanear (' + e.message + '). Completa los datos a mano.');
    }
    item.nodo.classList.toggle('rg-item-error', item.estado === 'duplicado');
    actualizarPie();
  }

  function quitarItem(item) {
    pendientes = pendientes.filter(function (p) { return p !== item; });
    item.nodo.remove();
    if (!pendientes.length) { $('rg-dlg').close(); return; }
    actualizarPie();
  }

  function actualizarPie() {
    var total = pendientes.reduce(function (s, p) { return s + Math.round((Number(input(p, 'monto').value) || 0) * 100); }, 0);
    var leyendo = pendientes.filter(function (p) { return p.estado === 'leyendo'; }).length;
    $('rg-dlg-total').textContent = leyendo
      ? 'Escaneando ' + leyendo + ' de ' + pendientes.length + ' PDF…'
      : pendientes.length + ' PDF · Total ' + dinero(total);
    $('rg-dlg-guardar').disabled = leyendo > 0 || pendientes.some(function (p) { return p.estado === 'duplicado'; });
  }

  /** Revisa los campos en el navegador; devuelve el primer campo con problema o null. */
  function revisar() {
    var primero = null;
    pendientes.forEach(function (p) {
      p.marcado = true;
      validarCuenta(p);
      if (!p.select.value && !primero) primero = p.select;
      CAMPOS.forEach(function (c) {
        var inp = input(p, c[0]);
        var mal = !inp.checkValidity();
        inp.classList.toggle('rg-falta', mal);
        if (mal && !primero) primero = inp;
      });
    });
    return primero;
  }

  async function guardar(ev) {
    ev.preventDefault();
    var malo = revisar();
    var err = $('rg-dlg-error');
    if (malo) {
      err.textContent = 'Revisa los campos marcados: cuenta, fecha y monto son obligatorios; el Billing ID va como 0000-0000-0000.';
      err.hidden = false;
      malo.focus();
      return;
    }
    var fd = new FormData();
    fd.append('detalles', JSON.stringify(pendientes.map(function (p) {
      var v = function (c) { return input(p, c).value.trim(); };
      return { cuenta: p.select.value, fecha_pago: v('fecha_pago'), monto: v('monto'),
        billing_id: v('billing_id'), metodo_pago: v('metodo_pago') };
    })));
    pendientes.forEach(function (p) { fd.append('archivos', p.archivo, p.archivo.name); });

    var btn = $('rg-dlg-guardar');
    btn.disabled = true;
    btn.lastChild.textContent = ' Guardando…';
    err.hidden = true;
    try {
      var r = await api(API, { method: 'POST', body: fd });
      $('rg-dlg').close();
      avisar(r.registrados + (r.registrados === 1 ? ' recibo registrado.' : ' recibos registrados.'));
      await refrescar();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.lastChild.textContent = ' Guardar recibos';
      actualizarPie();
    }
  }

  // ── eventos ──
  function iniciarEventos() {
    var inputArchivos = $('rg-input');
    var elegir = function () { inputArchivos.click(); };
    $('rg-btn-subir').addEventListener('click', elegir);
    inputArchivos.addEventListener('change', function () {
      if (inputArchivos.files.length) abrirVentana(inputArchivos.files);
      inputArchivos.value = '';
    });

    // Soltar PDF en cualquier parte de la página abre la ventana de subida (no con ella abierta).
    var ventanaAbierta = function () { return $('rg-dlg').open; };
    var conArchivos = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
    document.addEventListener('dragover', function (e) { if (conArchivos(e)) e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      if (!conArchivos(e)) return;
      e.preventDefault();
      if (!ventanaAbierta() && e.dataTransfer.files.length) abrirVentana(e.dataTransfer.files);
    });

    $('rg-filtros').addEventListener('submit', function (e) {
      e.preventDefault();
      cargarRecibos().catch(function (err) { avisar(err.message, true); });
    });
    $('rg-btn-exportar').addEventListener('click', function () { location.href = API + '/exportar?' + parametros(); });

    $('rg-form').addEventListener('submit', guardar);
    $('rg-dlg-lista').addEventListener('input', function (e) {
      e.target.classList.remove('rg-leido', 'rg-falta');
      if (e.target.classList.contains('rg-in-monto')) actualizarPie();
    });
    var cerrar = function () { $('rg-dlg').close(); };
    $('rg-dlg-cerrar').addEventListener('click', cerrar);
    $('rg-dlg-cancelar').addEventListener('click', cerrar);
    $('rg-dlg').addEventListener('close', function () { pendientes = []; $('rg-dlg-lista').replaceChildren(); });
  }

  // ── arranque: solo administradores (mismo criterio que topnav / ADMIN_ROLES) ──
  function esAdmin(role) {
    var r = String(role || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return r === 'admin' || r === 'administrador' || r === 'administrativo' || r === 'administrator' || r === 'administrador general';
  }

  async function iniciar() {
    var sesion = await (window.__sesion || Promise.resolve({}));
    if (!sesion || !sesion.authenticated) return;            // el guard del <head> ya redirige
    if (!esAdmin(sesion.user && sesion.user.role)) {
      alert('Acceso denegado: solo administradores.');
      location.href = '/residencial/inicio.html';
      return;
    }
    var hoy = hoyISO();
    $('rg-desde').value = hoy.slice(0, 8) + '01';
    $('rg-hasta').value = hoy;
    iniciarEventos();
    try {
      cuentas = (await api(API + '/cuentas')).cuentas || [];
      cuentas.forEach(function (c) { $('rg-cuenta').append(el('option', { value: c.clave, text: c.nombre })); });
    } catch (e) {
      avisar(e.message, true);
      return;
    }
    await refrescar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
