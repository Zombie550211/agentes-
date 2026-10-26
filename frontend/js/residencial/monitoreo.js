/**
 * Monitoreo (residencial/monitoreo.html): los equipos de venta de Residencial, cada uno
 * con su supervisor y sus agentes. Datos: GET /api/monitoreo/teams (routers/monitoreo.py),
 * que ya filtra por rol: admin y back office ven todos; supervisor y agente, el suyo.
 * Cada agente es una fila con una columna por día de la semana en curso (lunes a domingo).
 *
 * Faltas en sus llamadas: un clic en la casilla del día abre el recuadro con las faltas de
 * ese día (puede haber varias) y el campo «Notas» para agregar otra con su porqué
 * (POST /api/monitoreo/faltas); cada una se quita por separado (DELETE …/faltas/{id}).
 * La casilla muestra ✓ con una falta y el número con dos o más. Marcan admin, back office
 * (Control de calidad) y el supervisor de su team; los días que aún no llegan no se marcan.
 * Con 3 faltas en la semana el agente recibe el aviso y administración la alerta para
 * sacarlo de inbound (js/componentes/aviso-faltas.js).
 */
(function () {
  'use strict';

  var cont = document.getElementById('mo-contenido');
  var DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var AVISO_DESDE = 3;
  var semana = { dias: [], hoy: '' };
  var agentes = {};           // id → agente (con sus faltas), para el recuadro
  var dlg = document.getElementById('mo-dialogo');
  var nota = document.getElementById('mo-nota');
  var lista = document.getElementById('mo-dlg-lista');
  var abierta = null;         // casilla del recuadro abierto

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iniciales(n) {
    return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }
  // "TEAM IRANIA SERRANO" → "Irania Serrano"
  function nombreTeam(t) {
    return String(t || '').replace(/^\s*team\s+/i, '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
  }
  // "2026-10-26" → "26/10"
  function corta(f) { return f ? f.slice(8, 10) + '/' + f.slice(5, 7) : ''; }
  function nombreDia(f) { return DIAS[semana.dias.indexOf(f)] + ' ' + corta(f); }

  function chipFaltas(n) {
    return n >= AVISO_DESDE
      ? '<span class="pg-chip pg-chip-rojo mo-chip">' + n + ' faltas · Sacar de inbound</span>'
      : '';
  }

  function delDia(a, fecha) { return a.faltas.filter(function (x) { return x.fecha === fecha; }); }

  // Lo que se ve en la casilla, su etiqueta accesible y el tooltip con las notas.
  function marca(n) { return n === 0 ? '' : n === 1 ? '✓' : String(n); }
  function etiquetaDe(a, fecha, n) {
    return a.username + ', ' + nombreDia(fecha).toLowerCase() + ': ' +
      (n === 0 ? 'sin faltas' : n === 1 ? '1 falta' : n + ' faltas');
  }
  function tituloDe(a, fecha) {
    var dia = delDia(a, fecha);
    var notas = dia.map(function (x) { return x.nota; }).filter(Boolean);
    return etiquetaDe(a, fecha, dia.length) + (notas.length ? '\n· ' + notas.join('\n· ') : '');
  }

  function celda(a, fecha, puede) {
    var n = delDia(a, fecha).length;
    var hoy = fecha === semana.hoy ? ' mo-hoy' : '';
    var cls = n > 1 ? ' mo-varias' : '';
    if (!puede) {
      return '<td class="mo-celda' + hoy + '">' + (n
        ? '<span class="mo-check' + cls + '" role="img" aria-label="' + esc(etiquetaDe(a, fecha, n)) + '">' + marca(n) + '</span>' : '') + '</td>';
    }
    var futuro = fecha > semana.hoy;
    return '<td class="mo-celda' + hoy + '"><button type="button" class="mo-marca' + cls + '"' +
      ' aria-pressed="' + (n > 0) + '" aria-haspopup="dialog"' +
      ' data-agente="' + esc(a.id) + '" data-fecha="' + fecha + '"' + (futuro ? ' disabled' : '') +
      ' aria-label="' + esc(etiquetaDe(a, fecha, n)) + '" title="' + (futuro ? 'Aún no llega' : esc(tituloDe(a, fecha))) + '">' +
      '<span aria-hidden="true">' + marca(n) + '</span></button></td>';
  }

  function tarjeta(t) {
    var sups = t.supervisores.map(function (s) { return esc(s.username); }).join(', ');
    // Dos días empiezan por M: <abbr> con el nombre completo para el lector de pantalla y el tooltip.
    var cabecera = '<thead><tr><th scope="col" class="pg-izq">Agente</th>' + DIAS.map(function (d, i) {
      var f = semana.dias[i];
      return '<th scope="col" class="mo-dia' + (f === semana.hoy ? ' mo-hoy' : '') + '">' +
        '<abbr title="' + d + ' ' + corta(f) + '">' + d[0] + '</abbr></th>';
    }).join('') + '</tr></thead>';
    var filas = t.agentes.length
      ? '<div class="pg-scroll"><table class="pg-tbl mo-tbl">' + cabecera + '<tbody>' + t.agentes.map(function (a) {
          return '<tr data-fila="' + esc(a.id) + '"' + (a.faltas.length >= AVISO_DESDE ? ' class="mo-alerta"' : '') + '>' +
            '<th scope="row" class="pg-izq"><span class="mo-agente"><span class="mo-ini" aria-hidden="true">' +
            esc(iniciales(a.username)) + '</span><span class="mo-nom">' + esc(a.username) + '</span></span>' +
            '<span class="mo-chip-sitio">' + chipFaltas(a.faltas.length) + '</span></th>' +
            semana.dias.map(function (f) { return celda(a, f, t.puede_marcar); }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>'
      : '<p class="mo-vacio">Sin agentes asignados</p>';
    return '<section class="pg-card in-glass mo-team" aria-label="' + esc(t.team) + '">' +
      '<div class="pg-card-head"><div>' +
        '<h2><i class="ph ph-users-three" aria-hidden="true"></i>' + esc(nombreTeam(t.team)) + '</h2>' +
        '<p class="mo-sup"><i class="ph ph-user-circle-gear" aria-hidden="true"></i>Supervisor: <b>' + sups + '</b></p>' +
      '</div></div>' +
      filas + '</section>';
  }

  // Repinta la casilla y el aviso de la fila tras agregar o quitar.
  function pintar(btn, total) {
    var a = agentes[btn.dataset.agente];
    var fecha = btn.dataset.fecha;
    var n = delDia(a, fecha).length;
    btn.setAttribute('aria-pressed', String(n > 0));
    btn.classList.toggle('mo-varias', n > 1);
    btn.setAttribute('aria-label', etiquetaDe(a, fecha, n));
    btn.title = tituloDe(a, fecha);
    btn.firstChild.textContent = marca(n);
    var fila = btn.closest('tr');
    if (total == null) total = a.faltas.length;
    fila.classList.toggle('mo-alerta', total >= AVISO_DESDE);
    fila.querySelector('.mo-chip-sitio').innerHTML = chipFaltas(total);
  }

  function pedir(url, opts) {
    return fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.detail || 'No se pudo guardar');
          return d;
        });
      });
  }

  // ── Recuadro: faltas del día + «Notas» para agregar otra ──────────
  function pintarLista() {
    var a = agentes[abierta.dataset.agente];
    var dia = delDia(a, abierta.dataset.fecha);
    document.getElementById('mo-dlg-vacio').hidden = dia.length > 0;
    lista.innerHTML = dia.map(function (x, i) {
      return '<li class="mo-dlg-falta">' +
        '<div class="mo-dlg-falta-txt"><b>Falta ' + (i + 1) + '</b>' +
          '<span class="mo-dlg-nota' + (x.nota ? '' : ' mo-dlg-sin') + '">' + esc(x.nota || 'Sin nota') + '</span>' +
          (x.por ? '<span class="mo-dlg-por">Marcada por ' + esc(x.por) + '</span>' : '') + '</div>' +
        '<button type="button" class="pg-boton mo-quitar" data-quitar="' + esc(x.id) + '"' +
          ' aria-label="Quitar falta ' + (i + 1) + '">Quitar</button></li>';
    }).join('');
    document.getElementById('mo-guardar').textContent = dia.length ? 'Agregar otra falta' : 'Guardar falta';
  }

  function abrir(btn) {
    var a = agentes[btn.dataset.agente];
    abierta = btn;
    document.getElementById('mo-dlg-sub').textContent = a.username + ' · ' + nombreDia(btn.dataset.fecha);
    nota.value = '';
    pintarLista();
    dlg.showModal();
    nota.focus();
  }

  cont.addEventListener('click', function (e) {
    var btn = e.target.closest('.mo-marca');
    if (btn && !btn.disabled) abrir(btn);
  });

  document.getElementById('mo-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!abierta) return;
    var btn = abierta;
    var guardar = document.getElementById('mo-guardar');
    guardar.disabled = true;
    pedir('/api/monitoreo/faltas', {
      method: 'POST',
      body: JSON.stringify({ user_id: Number(btn.dataset.agente), fecha: btn.dataset.fecha, nota: nota.value.trim() }),
    })
      .then(function (d) {
        agentes[btn.dataset.agente].faltas.push(d.falta);
        pintar(btn, d.faltas_semana);
        dlg.close();
      })
      .catch(function (err) { alert(err.message); })
      .then(function () { guardar.disabled = false; });
  });

  lista.addEventListener('click', function (e) {
    var q = e.target.closest('[data-quitar]');
    if (!q || !abierta) return;
    var btn = abierta;
    var id = q.getAttribute('data-quitar');
    q.disabled = true;
    pedir('/api/monitoreo/faltas/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (d) {
        var a = agentes[btn.dataset.agente];
        a.faltas = a.faltas.filter(function (x) { return x.id !== id; });
        pintar(btn, d.faltas_semana);
        pintarLista();
        nota.focus();
      })
      .catch(function (err) { q.disabled = false; alert(err.message); });
  });

  document.getElementById('mo-cancelar').addEventListener('click', function () { dlg.close(); });
  // Al cerrar (también con Esc) el foco vuelve a la casilla.
  dlg.addEventListener('close', function () { if (abierta) abierta.focus(); abierta = null; });

  function cargar() {
    fetch('/api/monitoreo/teams', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        semana = d.semana || semana;
        var teams = d.teams || [];
        agentes = {};
        teams.forEach(function (t) { t.agentes.forEach(function (a) { agentes[a.id] = a; }); });
        cont.innerHTML = teams.length
          ? '<div class="mo-teams">' + teams.map(tarjeta).join('') + '</div>'
          : '<div class="pg-vacio in-glass">No hay equipos de residencial para mostrar</div>';
      })
      .catch(function () {
        cont.innerHTML = '<div class="pg-vacio in-glass">No se pudieron cargar los equipos</div>';
      });
  }

  cargar();
})();
