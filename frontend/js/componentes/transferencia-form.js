/**
 * Transferencia de llamada — formulario acoplado a las páginas de registro
 * (residencial/formulario-registro.html y lineas/lead.html) mediante pestañas.
 *
 * La página aporta:
 *   - botones  [data-trf-tab="lead"]  y  [data-trf-tab="transferencia"]
 *   - lo que se ve en la pestaña de lead:  [data-trf-panel="lead"]  (uno o varios)
 *   - el hueco del formulario:             <div id="trf-panel" data-trf-panel="transferencia">
 *
 * La sección de origen sale de la ruta (/lineas/… o /residencial/…) y el backend
 * devuelve los teams y agentes de la sección CONTRARIA. Con #transferencia en la
 * URL la página abre directamente en esa pestaña.
 *
 * Debajo del formulario va "Mis transferencias": el backend ya filtra según el rol
 * (agente → las suyas, supervisor → su team, admin/BO → todas), así cada agente
 * consulta lo que envió y lo que recibió sin salir del formulario.
 *
 * Resultado: quien RECIBIÓ la transferencia la cierra desde su fila de "Mis
 * transferencias" con Venta completada / Cliente en seguimiento / Venta no
 * realizada y la captura de la venta (obligatoria para "completada"). La captura
 * se sube primero a /api/files/upload y luego se envía su URL con el resultado.
 *
 * Un panel con data-trf-reserve (el botón "Guardar Lead" de la cabecera) se
 * vuelve invisible en vez de desaparecer, para que las pestañas no salten.
 */
(function () {
  'use strict';

  const ORIGEN = location.pathname.indexOf('/lineas/') === 0 ? 'lineas' : 'residencial';
  const DESTINO_LABEL = ORIGEN === 'lineas' ? 'Residencial' : 'Líneas';
  const SALIDA_MS = 160;   // = duración de trfSale en transferencia-form.css

  let destinos = null;   // [{team, agentes:[{id,nombre,username}]}] — se carga al abrir la pestaña
  let panel = null;
  let historial = [];    // última carga de "Mis transferencias"
  let filtroTipo = '';   // '' | 'enviada' | 'recibida'

  const RESULTADOS = {
    completada:   { label: 'Venta completada',       ic: 'fa-circle-check',   cls: 'ok' },
    seguimiento:  { label: 'Cliente en seguimiento', ic: 'fa-clock',          cls: 'seg' },
    no_realizada: { label: 'Venta no realizada',     ic: 'fa-circle-xmark',   cls: 'no' },
  };

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  const q = (sel) => panel.querySelector(sel);

  function render() {
    panel.innerHTML =
      '<section class="trf-card" aria-labelledby="trf-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="fas fa-phone-volume"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-title">Transferencia de llamada</h2>' +
            '<p class="trf-sub">Registra la llamada que transfieres a un agente de ' + esc(DESTINO_LABEL) + '.</p>' +
          '</div>' +
        '</div>' +
        '<form class="trf-form" novalidate>' +
          '<div class="trf-grid">' +
            '<div class="trf-field">' +
              '<label for="trf-telefono">Número de teléfono <span class="trf-req">*</span></label>' +
              '<input type="tel" id="trf-telefono" inputmode="tel" maxlength="20" autocomplete="off" placeholder="(555) 123-4567">' +
            '</div>' +
            '<div class="trf-field">' +
              '<label for="trf-nombre">Nombre del cliente <span class="trf-req">*</span></label>' +
              '<input type="text" id="trf-nombre" maxlength="150" autocomplete="off">' +
            '</div>' +
            '<div class="trf-field trf-full">' +
              '<label for="trf-direccion">Dirección <span class="trf-req">*</span></label>' +
              '<input type="text" id="trf-direccion" maxlength="300" autocomplete="off">' +
            '</div>' +
            '<div class="trf-field trf-full">' +
              '<label for="trf-motivo">Motivo de la llamada <span class="trf-req">*</span></label>' +
              '<textarea id="trf-motivo" maxlength="1000"></textarea>' +
            '</div>' +
            '<div class="trf-field">' +
              '<label for="trf-team">Team de ' + esc(DESTINO_LABEL) + ' <span class="trf-req">*</span></label>' +
              '<select id="trf-team"><option value="">Cargando…</option></select>' +
            '</div>' +
            '<div class="trf-field">' +
              '<label for="trf-agente">Agente <span class="trf-req">*</span></label>' +
              '<select id="trf-agente" disabled><option value="">Primero elige un team</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="trf-msg" role="status" aria-live="polite"></div>' +
          '<button type="submit" class="trf-btn"><i class="fas fa-share"></i> Registrar transferencia</button>' +
        '</form>' +
      '</section>' +
      '<section class="trf-card trf-hist" aria-labelledby="trf-hist-title">' +
        '<div class="trf-head">' +
          '<div class="trf-ic"><i class="fas fa-clock-rotate-left"></i></div>' +
          '<div class="trf-head-txt">' +
            '<h2 class="trf-title" id="trf-hist-title">Mis transferencias</h2>' +
            '<p class="trf-sub">Las que enviaste y las que te transfirieron.</p>' +
          '</div>' +
          '<div class="trf-hist-filtros">' +
            '<div class="trf-seg" role="group" aria-label="Tipo">' +
              '<button type="button" data-tipo="" class="trf-seg-on" aria-pressed="true">Todas</button>' +
              '<button type="button" data-tipo="enviada" aria-pressed="false">Enviadas</button>' +
              '<button type="button" data-tipo="recibida" aria-pressed="false">Recibidas</button>' +
            '</div>' +
            '<select id="trf-periodo" aria-label="Periodo">' +
              '<option value="0">Hoy</option>' +
              '<option value="7" selected>Últimos 7 días</option>' +
              '<option value="30">Últimos 30 días</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="trf-kpis" id="trf-kpis" aria-live="polite"></div>' +
        '<div class="trf-hist-body" id="trf-hist-body"></div>' +
      '</section>';

    q('#trf-team').addEventListener('change', onTeamChange);
    q('form').addEventListener('submit', onSubmit);
    q('#trf-periodo').addEventListener('change', cargarHistorial);
    panel.querySelectorAll('.trf-seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        filtroTipo = b.getAttribute('data-tipo');
        panel.querySelectorAll('.trf-seg button').forEach(function (x) {
          const on = x === b;
          x.classList.toggle('trf-seg-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        pintarHistorial();
      });
    });
  }

  // ── Mis transferencias ─────────────────────────────────────────
  function fechaISO(diasAtras) {
    const d = new Date();
    d.setDate(d.getDate() - diasAtras);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtFecha(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function fmtTel(t) {
    const s = String(t || '');
    return s.length === 10 ? '(' + s.slice(0, 3) + ') ' + s.slice(3, 6) + '-' + s.slice(6) : s;
  }

  async function cargarHistorial() {
    const box = q('#trf-hist-body');
    const dias = parseInt(q('#trf-periodo').value, 10) || 0;
    const qs = new URLSearchParams({ seccion: ORIGEN, desde: fechaISO(dias), hasta: fechaISO(0) });
    box.innerHTML = '<div class="trf-vacio">Cargando…</div>';
    try {
      const r = await fetch('/api/transferencias?' + qs);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      historial = j.transferencias || [];
    } catch (e) {
      q('#trf-kpis').innerHTML = '';
      box.innerHTML = '<div class="trf-vacio">No se pudieron cargar tus transferencias</div>';
      return;
    }
    pintarHistorial();
  }

  /** KPIs del periodo y del filtro (Todas / Enviadas / Recibidas) que se ven en la tabla. */
  function pintarKpis(filas) {
    const n = { total: filas.length, completada: 0, seguimiento: 0, no_realizada: 0, pendiente: 0 };
    filas.forEach(function (f) {
      if (RESULTADOS[f.resultado]) n[f.resultado]++;
      else n.pendiente++;
    });
    const pct = (v) => (n.total ? Math.round(v * 100 / n.total) : 0) + '% del total';
    const tarjetas = [
      { cls: 'tot',  ic: 'fa-phone-volume',   label: 'Transferidas',   v: n.total,        sub: filtroTipo === 'enviada' ? 'Enviadas' : filtroTipo === 'recibida' ? 'Recibidas' : 'Enviadas y recibidas' },
      { cls: 'ok',   ic: RESULTADOS.completada.ic,   label: 'Cerradas',       v: n.completada,   sub: pct(n.completada) },
      { cls: 'seg',  ic: RESULTADOS.seguimiento.ic,  label: 'En seguimiento', v: n.seguimiento,  sub: pct(n.seguimiento) },
      { cls: 'no',   ic: RESULTADOS.no_realizada.ic, label: 'No realizadas',  v: n.no_realizada, sub: pct(n.no_realizada) },
      { cls: 'pend', ic: 'fa-hourglass-half', label: 'Pendientes',     v: n.pendiente,    sub: 'Sin resultado' },
    ];
    q('#trf-kpis').innerHTML = tarjetas.map(function (t) {
      return '<div class="trf-kpi ' + t.cls + '">' +
        '<div class="trf-kpi-head"><span class="trf-kpi-label">' + esc(t.label) + '</span>' +
          '<span class="trf-kpi-ic"><i class="fas ' + t.ic + '"></i></span></div>' +
        '<div class="trf-kpi-num">' + t.v + '</div>' +
        '<div class="trf-kpi-sub">' + esc(t.sub) + '</div>' +
      '</div>';
    }).join('');
  }

  function pintarHistorial() {
    const box = q('#trf-hist-body');
    const filas = filtroTipo ? historial.filter((f) => f.direccion_tipo === filtroTipo) : historial;
    pintarKpis(filas);
    if (!filas.length) {
      box.innerHTML = '<div class="trf-vacio">Sin transferencias en este periodo</div>';
      return;
    }
    box.innerHTML = '<div class="trf-tabla-wrap"><table class="trf-tabla"><thead><tr>' +
      '<th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Teléfono</th><th>Motivo</th><th>De</th><th>Para</th><th>Resultado</th>' +
      '</tr></thead><tbody>' +
      filas.map((f) => {
        const env = f.direccion_tipo === 'enviada';
        return '<tr>' +
          '<td class="trf-nw">' + esc(fmtFecha(f.created_at)) + '</td>' +
          '<td><span class="trf-chip ' + (env ? 'env' : 'rec') + '">' + (env ? 'Enviada' : 'Recibida') + '</span></td>' +
          '<td>' + esc(f.nombre_cliente) + '<small>' + esc(f.direccion) + '</small></td>' +
          '<td class="trf-nw">' + esc(fmtTel(f.telefono)) + '</td>' +
          '<td class="trf-motivo">' + esc(f.motivo) + '</td>' +
          '<td>' + esc(f.created_by_nombre || f.created_by) + '<small>' + esc(f.created_by_team || '') + '</small></td>' +
          '<td>' + esc(f.agente_destino_nombre) + '<small>' + esc(f.team_destino) + '</small></td>' +
          '<td class="trf-res-cel">' + celdaResultado(f) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
    box.querySelectorAll('[data-trf-res]').forEach(function (b) {
      b.addEventListener('click', function () {
        const f = historial.find((x) => String(x.id) === b.getAttribute('data-trf-res'));
        if (f) abrirResultado(f);
      });
    });
  }

  function celdaResultado(f) {
    const r = RESULTADOS[f.resultado];
    let html = r
      ? '<span class="trf-res ' + r.cls + '"><i class="fas ' + r.ic + '"></i> ' + esc(r.label) + '</span>'
      : '<span class="trf-res pend"><i class="fas fa-hourglass-half"></i> Pendiente</span>';
    if (f.captura_url) {
      html += '<a class="trf-res-cap" href="' + esc(f.captura_url) + '" target="_blank" rel="noopener">' +
        '<i class="fas fa-image"></i> Ver captura</a>';
    }
    if (f.resultado_nota) html += '<small>' + esc(f.resultado_nota) + '</small>';
    if (f.resultado_por) html += '<small>' + esc(f.resultado_por) + ' · ' + esc(fmtFecha(f.resultado_at)) + '</small>';
    if (f.puede_registrar) {
      html += '<button type="button" class="trf-res-btn" data-trf-res="' + esc(f.id) + '" title="Registrar el resultado de la transferencia">' +
        '<i class="fas fa-pen-to-square"></i> ' + (f.resultado ? 'Actualizar' : 'Registrar') + '</button>';
    }
    return html;
  }

  // ── Diálogo de resultado ───────────────────────────────────────
  let dlg = null;          // <div class="trf-dlg-fondo">
  let dlgFila = null;      // transferencia que se está cerrando
  let dlgArchivo = null;   // File de la captura elegida o pegada
  let dlgPreview = null;   // object URL de la vista previa

  function crearDialogo() {
    dlg = document.createElement('div');
    dlg.className = 'trf-dlg-fondo trf-oculto';
    dlg.innerHTML =
      '<form class="trf-dlg" role="dialog" aria-modal="true" aria-labelledby="trf-dlg-t" novalidate>' +
        '<h3 class="trf-dlg-t" id="trf-dlg-t">Resultado de la transferencia</h3>' +
        '<p class="trf-dlg-sub" id="trf-dlg-sub"></p>' +
        '<fieldset class="trf-dlg-ops"><legend>Status <span class="trf-req">*</span></legend>' +
          Object.keys(RESULTADOS).map(function (k) {
            const r = RESULTADOS[k];
            return '<label class="trf-op ' + r.cls + '"><input type="radio" name="trf-res" value="' + k + '">' +
              '<i class="fas ' + r.ic + '"></i><span>' + esc(r.label) + '</span></label>';
          }).join('') +
        '</fieldset>' +
        '<div class="trf-field">' +
          '<label>Captura de la venta <span class="trf-req" id="trf-cap-req">*</span></label>' +
          '<label class="trf-drop" tabindex="0">' +
            '<input type="file" accept="image/*" id="trf-cap-in" hidden>' +
            '<span class="trf-drop-txt"><i class="fas fa-cloud-arrow-up"></i> Elige la imagen o pégala aquí con Ctrl+V</span>' +
            '<img class="trf-drop-img trf-oculto" alt="Vista previa de la captura">' +
          '</label>' +
          '<small class="trf-dlg-ayuda" id="trf-cap-ayuda"></small>' +
        '</div>' +
        '<div class="trf-field">' +
          '<label for="trf-res-nota">Nota (opcional)</label>' +
          '<textarea id="trf-res-nota" maxlength="500" placeholder="Ej. el cliente pidió que le llamen el viernes"></textarea>' +
        '</div>' +
        '<div class="trf-msg" role="status" aria-live="polite"></div>' +
        '<div class="trf-dlg-acc">' +
          '<button type="button" class="trf-btn-sec" data-trf-cerrar>Cancelar</button>' +
          '<button type="submit" class="trf-btn"><i class="fas fa-floppy-disk"></i> Guardar resultado</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(dlg);

    const d = (sel) => dlg.querySelector(sel);
    d('form').addEventListener('submit', guardarResultado);
    d('[data-trf-cerrar]').addEventListener('click', cerrarResultado);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) cerrarResultado(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dlg && !dlg.classList.contains('trf-oculto')) cerrarResultado();
    });
    dlg.querySelectorAll('input[name="trf-res"]').forEach(function (r) {
      r.addEventListener('change', pintarRequisitoCaptura);
    });
    d('#trf-cap-in').addEventListener('change', function (e) { elegirCaptura(e.target.files[0]); });
    d('.trf-drop').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d('#trf-cap-in').click(); }
    });
    dlg.addEventListener('paste', function (e) {
      const it = Array.prototype.find.call((e.clipboardData || {}).items || [], (x) => x.type.indexOf('image/') === 0);
      if (it) { e.preventDefault(); elegirCaptura(it.getAsFile()); }
    });
  }

  function msgDlg(tipo, texto) {
    const el = dlg.querySelector('.trf-msg');
    el.className = 'trf-msg ' + tipo;
    el.textContent = texto;
  }

  function elegirCaptura(file) {
    if (!file) return;
    if (file.type.indexOf('image/') !== 0) { msgDlg('err', 'La captura debe ser una imagen'); return; }
    if (file.size > 10 * 1024 * 1024) { msgDlg('err', 'La imagen supera 10 MB'); return; }
    dlgArchivo = file;
    if (dlgPreview) URL.revokeObjectURL(dlgPreview);
    dlgPreview = URL.createObjectURL(file);
    const img = dlg.querySelector('.trf-drop-img');
    img.src = dlgPreview;
    img.classList.remove('trf-oculto');
    dlg.querySelector('.trf-drop-txt').innerHTML = '<i class="fas fa-rotate"></i> Cambiar imagen';
    msgDlg('', '');
  }

  function resultadoElegido() {
    const r = dlg.querySelector('input[name="trf-res"]:checked');
    return r ? r.value : '';
  }

  function pintarRequisitoCaptura() {
    const obligatoria = resultadoElegido() === 'completada' && !(dlgFila && dlgFila.captura_url);
    dlg.querySelector('#trf-cap-req').style.visibility = obligatoria ? 'visible' : 'hidden';
    dlg.querySelector('#trf-cap-ayuda').textContent = dlgFila && dlgFila.captura_url
      ? 'Ya hay una captura guardada; sube otra solo si quieres reemplazarla.'
      : 'Obligatoria para "Venta completada".';
  }

  function abrirResultado(f) {
    if (!dlg) crearDialogo();
    dlgFila = f;
    dlgArchivo = null;
    if (dlgPreview) { URL.revokeObjectURL(dlgPreview); dlgPreview = null; }
    dlg.querySelector('form').reset();
    dlg.querySelector('.trf-drop-img').classList.add('trf-oculto');
    dlg.querySelector('.trf-drop-txt').innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Elige la imagen o pégala aquí con Ctrl+V';
    dlg.querySelector('#trf-dlg-sub').textContent = f.nombre_cliente + ' · ' + fmtTel(f.telefono);
    if (f.resultado) {
      const r = dlg.querySelector('input[name="trf-res"][value="' + f.resultado + '"]');
      if (r) r.checked = true;
    }
    dlg.querySelector('#trf-res-nota').value = f.resultado_nota || '';
    msgDlg('', '');
    pintarRequisitoCaptura();
    dlg.classList.remove('trf-oculto');
    const primero = dlg.querySelector('input[name="trf-res"]:checked') || dlg.querySelector('input[name="trf-res"]');
    primero.focus();
  }

  function cerrarResultado() {
    if (!dlg) return;
    dlg.classList.add('trf-oculto');
    if (dlgPreview) { URL.revokeObjectURL(dlgPreview); dlgPreview = null; }
    dlgFila = null;
    dlgArchivo = null;
  }

  async function guardarResultado(ev) {
    ev.preventDefault();
    const resultado = resultadoElegido();
    if (!resultado) { msgDlg('err', 'Elige el status'); return; }
    if (resultado === 'completada' && !dlgArchivo && !dlgFila.captura_url) {
      msgDlg('err', 'Sube la captura donde se ve la venta cerrada');
      return;
    }
    const btn = dlg.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      let capturaUrl = null;
      if (dlgArchivo) {
        msgDlg('', '');
        const fd = new FormData();
        fd.append('file', dlgArchivo, dlgArchivo.name || 'captura.png');
        const up = await fetch('/api/files/upload', { method: 'POST', body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.data) throw new Error(typeof uj.detail === 'string' ? uj.detail : 'No se pudo subir la captura');
        capturaUrl = uj.data.url;
      }
      const r = await fetch('/api/transferencias/' + encodeURIComponent(dlgFila.id) + '/resultado', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultado: resultado,
          captura_url: capturaUrl,
          nota: dlg.querySelector('#trf-res-nota').value.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo guardar el resultado');
      cerrarResultado();
      cargarHistorial();
    } catch (e) {
      msgDlg('err', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function mensaje(tipo, texto) {
    const el = q('.trf-msg');
    el.className = 'trf-msg ' + tipo;
    el.textContent = texto;
  }

  async function cargarDestinos() {
    const sel = q('#trf-team');
    try {
      const r = await fetch('/api/transferencias/destinos?origen=' + ORIGEN);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Error');
      destinos = j.teams || [];
    } catch (e) {
      destinos = null;   // se reintenta la próxima vez que se abra la pestaña
      sel.innerHTML = '<option value="">No se pudieron cargar los teams</option>';
      return;
    }
    sel.innerHTML = '<option value="">Selecciona un team</option>' +
      destinos.map((t) => '<option value="' + esc(t.team) + '">' + esc(t.team) + '</option>').join('');
  }

  function onTeamChange() {
    const sel = q('#trf-agente');
    const t = (destinos || []).find((x) => x.team === q('#trf-team').value);
    if (!t) {
      sel.innerHTML = '<option value="">Primero elige un team</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML = '<option value="">Selecciona el agente</option>' +
      t.agentes.map((a) => '<option value="' + a.id + '">' + esc(a.nombre) + '</option>').join('');
    sel.disabled = false;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const tel = q('#trf-telefono').value.replace(/\D/g, '');
    if (tel.length < 7 || tel.length > 15) {
      mensaje('err', 'Número de teléfono inválido');
      q('#trf-telefono').focus();
      return;
    }
    const body = {
      origen: ORIGEN,
      telefono: tel,
      motivo: q('#trf-motivo').value.trim(),
      nombre_cliente: q('#trf-nombre').value.trim(),
      direccion: q('#trf-direccion').value.trim(),
      team_destino: q('#trf-team').value,
      agente_destino_id: parseInt(q('#trf-agente').value, 10) || 0,
    };
    if (!body.motivo || !body.nombre_cliente || !body.direccion || !body.team_destino || !body.agente_destino_id) {
      mensaje('err', 'Completa todos los campos');
      return;
    }
    const btn = q('.trf-btn');
    btn.disabled = true;
    try {
      const r = await fetch('/api/transferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo guardar');
      q('form').reset();
      onTeamChange();
      mensaje('ok', 'Transferencia registrada');
      cargarHistorial();
    } catch (e) {
      mensaje('err', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ── Pestañas ───────────────────────────────────────────────────
  let actual = null;
  let salidaTimer = null;

  function sinMovimiento() {
    return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ocultar(p, si) {
    p.classList.toggle(p.hasAttribute('data-trf-reserve') ? 'trf-invisible' : 'trf-oculto', si);
  }

  /** Desplaza la píldora de fondo bajo la pestaña activa. */
  function moverPildora(animar) {
    document.querySelectorAll('.trf-tabs').forEach(function (tabs) {
      const on = tabs.querySelector('.trf-tab-on');
      let pill = tabs.querySelector('.trf-pill');
      if (!on) return;
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'trf-pill';
        pill.setAttribute('aria-hidden', 'true');
        tabs.insertBefore(pill, tabs.firstChild);
        tabs.classList.add('trf-tabs-pill');
      }
      pill.classList.toggle('trf-pill-anim', !!animar);
      pill.style.width = on.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + (on.offsetLeft - pill.offsetLeft) + 'px)';
    });
  }

  function activar(tab, animar) {
    if (tab === actual) return;
    actual = tab;
    animar = animar && !sinMovimiento();

    document.querySelectorAll('[data-trf-tab]').forEach(function (b) {
      const on = b.getAttribute('data-trf-tab') === tab;
      b.classList.toggle('trf-tab-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    moverPildora(animar);

    const paneles = Array.prototype.slice.call(document.querySelectorAll('[data-trf-panel]'));
    const entran = paneles.filter((p) => p.getAttribute('data-trf-panel') === tab);
    const salen = paneles.filter((p) => p.getAttribute('data-trf-panel') !== tab);

    function mostrarEntrantes() {
      salen.forEach(function (p) { p.classList.remove('trf-sale'); ocultar(p, true); });
      entran.forEach(function (p) {
        ocultar(p, false);
        if (!animar) return;
        p.classList.remove('trf-entra');
        void p.offsetWidth;   // reinicia la animación si se cambia rápido de pestaña
        p.classList.add('trf-entra');
      });
    }

    clearTimeout(salidaTimer);
    entran.forEach(function (p) { p.classList.remove('trf-sale'); });
    if (animar) {
      salen.forEach(function (p) { p.classList.remove('trf-entra'); p.classList.add('trf-sale'); });
      salidaTimer = setTimeout(mostrarEntrantes, SALIDA_MS);
    } else {
      mostrarEntrantes();
    }

    if (tab === 'transferencia') {
      if (!destinos) cargarDestinos();
      cargarHistorial();   // cada vez: pudieron transferirte llamadas mientras tanto
    }
    const hash = tab === 'transferencia' ? '#transferencia' : '';
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  }

  document.addEventListener('DOMContentLoaded', function () {
    panel = document.getElementById('trf-panel');
    if (!panel) return;
    render();
    document.querySelectorAll('[data-trf-tab]').forEach(function (b) {
      b.addEventListener('click', function () { activar(b.getAttribute('data-trf-tab'), true); });
    });
    document.querySelectorAll('[data-trf-panel]').forEach(function (p) {
      p.addEventListener('animationend', function () { p.classList.remove('trf-entra'); });
    });
    activar(location.hash === '#transferencia' ? 'transferencia' : 'lead', false);
    // La fuente de iconos puede cambiar el ancho de las pestañas al terminar de cargar.
    window.addEventListener('load', function () { moverPildora(false); });
    window.addEventListener('resize', function () { moverPildora(false); });
  });
})();
