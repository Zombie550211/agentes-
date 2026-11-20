/* estadisticas-cxc.js — «Cantidad de CXC Xfinity» de Estadísticas (residencial/estadisticas.html).
 *
 * Solo lectura: cuenta las ventas con motivo «CXC Xfinity» del día elegido (hoy por defecto)
 * y el acumulado de su mes. Cada team (fila con su total) y debajo sus agentes; lo que no
 * cabe se desplaza dentro de la tarjeta.
 * Se refresca solo cuando cambian ventas (CRMRealtime 'residencial').
 * API: CRM_PYTHON/routers/cxc_xfinity.py → GET /api/cxc-xfinity?fecha=YYYY-MM-DD.
 */
(function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
               'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var $ = function (id) { return document.getElementById(id); };
  var vista = 'agente';  // una sola vista (20-nov): cada team con su total y debajo sus agentes
  var dia = '';
  var datos = null;
  var pidiendo = 0;

  function esc(s) { return window.ESTeam ? window.ESTeam.esc(s) : String(s); }
  function nombreTeam(t) { return window.ESTeam ? window.ESTeam.nombre(t) : t; }
  function hoyISO() {
    var d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/El_Salvador' }));
    return iso(d);
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fecha(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function num(n) { return n ? String(n) : '<span class="es-cero">–</span>'; }

  function cargar() {
    var yo = ++pidiendo, f = dia || hoyISO();
    return fetch('/api/cxc-xfinity?fecha=' + f, { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { if (yo === pidiendo) { datos = d; pintar(); } })
      .catch(function () {
        if (yo === pidiendo) $('es-cx-cuerpo').innerHTML = '<div class="es-estado">No se pudo cargar CXC Xfinity. Recarga la página.</div>';
      });
  }

  function valor(lista, campo, tipo, clave) {
    var v = (lista || []).find(function (x) { return x.tipo === tipo && String(x.clave) === String(clave); });
    return v ? (+v[campo] || 0) : 0;
  }

  function pintar() {
    var d = datos, f = fecha(d.fecha), esHoy = d.fecha === hoyISO();
    $('es-cx-dia').textContent = (esHoy ? 'Hoy, ' : '') + f.getDate() + ' ' + MESES[f.getMonth()].slice(0, 3);
    $('es-cx-sub').textContent = 'Día ' + f.getDate() + ' y acumulado de ' + MESES[f.getMonth()];
    $('es-cx-next').disabled = esHoy;

    var dDia = function (t, k) { return valor(d.valores, 'cantidad', t, k); };
    var dMes = function (t, k) { return valor(d.mes, 'total', t, k); };
    var h = '<table class="es-tabla es-cxc"><thead><tr><th scope="col" class="es-col-team">' + (vista === 'team' ? 'Team' : 'Team / agente') +
      '</th><th scope="col" class="es-col-n">Día</th><th scope="col" class="es-col-n">Mes</th></tr></thead><tbody>';
    var tD = 0, tM = 0;

    if (vista === 'team') {
      var teams = (d.teams || []).slice();
      (d.mes || []).forEach(function (v) { if (v.tipo === 'team' && teams.indexOf(v.clave) === -1) teams.push(v.clave); });
      teams.sort(function (a, b) { return (dMes('team', b) - dMes('team', a)) || a.localeCompare(b); });
      teams.forEach(function (t) {
        var a = dDia('team', t), m = dMes('team', t); tD += a; tM += m;
        h += '<tr><th scope="row" class="es-col-team" title="' + esc(t) + '"><span class="es-nom">' + esc(nombreTeam(t)) + '</span></th>' +
          '<td>' + num(a) + '</td><td>' + num(m) + '</td></tr>';
      });
      if (!teams.length) h += '<tr><td colspan="3" class="es-vacio">No hay teams de venta.</td></tr>';
    } else {
      var ags = (d.agentes || []).slice(), ids = {};
      ags.forEach(function (a) { ids[a.id] = 1; });
      (d.mes || []).forEach(function (v) {
        if (v.tipo === 'agente' && !ids[v.clave]) ags.push({ id: v.clave, nombre: v.nombre, team: v.team || 'Sin team' });
      });
      var grupos = {};
      ags.forEach(function (a) { (grupos[a.team || 'Sin team'] = grupos[a.team || 'Sin team'] || []).push(a); });
      Object.keys(grupos).sort().forEach(function (t) {
        var lista = grupos[t], sD = 0, sM = 0;
        lista.forEach(function (a) { sD += dDia('agente', a.id); sM += dMes('agente', a.id); });
        tD += sD; tM += sM;
        h += '<tr class="es-ag-team"><th scope="rowgroup" class="es-col-team"><span class="es-nom">' + esc(nombreTeam(t)) + '</span></th>' +
          '<td>' + num(sD) + '</td><td>' + num(sM) + '</td></tr>';
        lista.sort(function (a, b) { return (dMes('agente', b.id) - dMes('agente', a.id)) || String(a.nombre).localeCompare(String(b.nombre)); })
          .forEach(function (a) {
            h += '<tr class="es-ag"><th scope="row" class="es-col-team"><span class="es-nom">' + esc(a.nombre) + '</span></th>' +
              '<td>' + num(dDia('agente', a.id)) + '</td><td>' + num(dMes('agente', a.id)) + '</td></tr>';
          });
      });
      if (!ags.length) h += '<tr><td colspan="3" class="es-vacio">No hay agentes de Residencial.</td></tr>';
    }
    h += '</tbody><tfoot><tr><th scope="row" class="es-col-team">Total</th><td>' + tD + '</td><td>' + tM + '</td></tr></tfoot></table>';
    $('es-cx-cuerpo').innerHTML = h;
    $('es-cx-estado').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }

  function mover(n) { var f = fecha(datos ? datos.fecha : hoyISO()); f.setDate(f.getDate() + n); dia = iso(f); if (dia >= hoyISO()) dia = ''; cargar(); }

  var espera = null;
  function refrescar() { clearTimeout(espera); espera = setTimeout(function () { if (!document.hidden) cargar(); }, 800); }

  function iniciar() {
    $('es-cx-prev').addEventListener('click', function () { mover(-1); });
    $('es-cx-next').addEventListener('click', function () { mover(1); });
    if (window.CRMRealtime) window.CRMRealtime.connect('residencial', refrescar);
    setInterval(function () { if (!document.hidden) cargar(); }, 120000);
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
