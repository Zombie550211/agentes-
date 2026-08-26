/**
 * Sidebar del CRM — marcado generado desde datos, en un solo sitio.
 *
 * Antes este menú estaba escrito a mano en las 37 páginas que lo usan: ~12 KB de
 * HTML idéntico por página (476 KB en total), con los 25 SVG en línea. Cambiar un
 * enlace, un icono o una etiqueta obligaba a editar 37 archivos y confiar en no
 * saltarse ninguno.
 *
 * Las dos "variantes" que existían (residencial y líneas) resultaron ser la MISMA
 * lista: lo único que cambia es qué grupo es el propio de la página. El grupo
 * propio va primero y visible para todos; el otro va después y sólo lo ven admin
 * y back office. Eso se deduce del pathname, así que no hace falta que la página
 * declare nada.
 *
 * La página sólo necesita:  <nav class="sidebar" id="app-sidebar"></nav>
 */
(function () {
  'use strict';

  // ── Datos ────────────────────────────────────────────────────────
  // {href,label,icon} = botón · {sec} = título de sección · {head} = título del
  // bloque de líneas.
  //
  // `color` ya no se pinta: en el diseño actual todos los chips comparten el
  // mismo azul sobre el fondo marino, y ese color lo pone el CSS. Se conserva el
  // dato de cada ítem por si alguna vez se vuelve a un icono por color.
  const MENU = {
  RESIDENCIAL: [
    {"href": "/residencial/inicio.html", "label": "Inicio", "color": "#2563eb", "icon": "<path d=\"M3 11l9-7 9 7\"/><path d=\"M5 10v10h14V10\"/>"},
    {"href": "/residencial/formulario-registro.html", "label": "Formulario", "color": "#059669", "icon": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20c0-4 3-6 6-6s6 2 6 6\"/><line x1=\"19\" y1=\"8\" x2=\"19\" y2=\"14\"/><line x1=\"16\" y1=\"11\" x2=\"22\" y2=\"11\"/>"},
    {"href": "/residencial/costumer.html", "label": "Lista de Clientes", "color": "#7c3aed", "icon": "<circle cx=\"8\" cy=\"8\" r=\"3\"/><path d=\"M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6\"/><circle cx=\"17\" cy=\"9\" r=\"2.6\"/><path d=\"M15.5 14c2.6.4 4.5 2.6 4.5 6\"/>"},
    {"href": "/residencial/normativas-tipificacion.html", "label": "Tipificación", "color": "#0d9488", "icon": "<path d=\"M3 11l9-8 9 8-9 9-9-9z\"/><circle cx=\"15\" cy=\"8\" r=\"1.3\" fill=\"currentColor\"/>"},
    {"sec": "ESTADÍSTICAS"},
    {"href": "/residencial/productividad-bo.html", "label": "Productividad B.O", "color": "#d97706", "icon": "<circle cx=\"9\" cy=\"7\" r=\"3\"/><path d=\"M4 20c0-3.5 2.7-6 5-6\"/><path d=\"M13 20l3-4 2 2 3-6\"/>"},
    {"href": "/residencial/estadisticas.html", "label": "Estadísticas", "color": "#ca8a04", "icon": "<line x1=\"4\" y1=\"20\" x2=\"20\" y2=\"20\"/><rect x=\"6\" y=\"12\" width=\"3\" height=\"8\" rx=\"2\"/><rect x=\"11\" y=\"8\" width=\"3\" height=\"12\" rx=\"2\"/><rect x=\"16\" y=\"4\" width=\"3\" height=\"16\" rx=\"2\"/>"},
    {"href": "/residencial/productividad.html", "label": "Productividad", "color": "#4f46e5", "icon": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><line x1=\"3\" y1=\"12\" x2=\"21\" y2=\"12\"/><path d=\"M12 3c3 4 3 14 0 18\"/><path d=\"M12 3c-3 4-3 14 0 18\"/>"},
    {"href": "/residencial/ranking-agente.html", "label": "Ranking de Agentes", "color": "#ea580c", "icon": "<path d=\"M4 16l5-5 4 3 7-8\"/><path d=\"M4 20h16\"/>"},
    {"href": "/residencial/ranking.html", "label": "Ranking y Promociones", "color": "#db2777", "icon": "<path d=\"M7 4h10v5a5 5 0 0 1-10 0V4z\"/><path d=\"M7 5H4a2 2 0 0 0 2 4\"/><path d=\"M17 5h3a2 2 0 0 1-2 4\"/><line x1=\"12\" y1=\"14\" x2=\"12\" y2=\"17\"/><path d=\"M8 21h8\"/><path d=\"M9 21c0-2 1.3-3 3-3s3 1 3 3\"/>"},
    {"href": "/residencial/premios.html", "label": "Premios", "color": "#2563eb", "icon": "<rect x=\"3\" y=\"9\" width=\"18\" height=\"4\" rx=\"2\"/><rect x=\"5\" y=\"13\" width=\"14\" height=\"8\" rx=\"2\"/><line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"21\"/><path d=\"M12 9C10 4 5 5 5 8s3 1 7 1z\"/><path d=\"M12 9c2-5 7-4 7-1s-3 1-7 1z\"/>"},
    {"href": "/residencial/reglas.html", "label": "Reglas y Puntajes", "color": "#059669", "icon": "<path d=\"M6 3h9l4 4v14H6V3z\"/><path d=\"M15 3v4h4\"/><line x1=\"9\" y1=\"13\" x2=\"15\" y2=\"13\"/><line x1=\"9\" y1=\"17\" x2=\"15\" y2=\"17\"/>"},
    {"href": "/residencial/facturacion.html", "label": "Facturación", "color": "#dc2626", "icon": "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><line x1=\"8\" y1=\"8\" x2=\"16\" y2=\"8\"/><line x1=\"8\" y1=\"12\" x2=\"16\" y2=\"12\"/><line x1=\"8\" y1=\"16\" x2=\"13\" y2=\"16\"/>"},
    {"href": "/residencial/llamadas-ventas.html", "label": "Llamadas y Ventas por Team", "color": "#475569", "icon": "<path d=\"M5 4c0 9 6 15 15 15l1-4-5-2-2 2c-3-1.5-5-3.5-6-6l2-2-2-5-4 1z\"/>"},
    {"href": "/residencial/comisiones.html", "label": "Comisión", "color": "#0891b2", "icon": "<circle cx=\"9\" cy=\"9\" r=\"5\"/><circle cx=\"15\" cy=\"15\" r=\"5\" fill=\"none\"/>"},
    {"href": "/residencial/semaforo.html", "label": "El Semáforo", "color": "#64748b", "icon": "<rect x=\"9\" y=\"2\" width=\"6\" height=\"20\" rx=\"2\"/><circle cx=\"12\" cy=\"6\" r=\"1.4\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"18\" r=\"1.4\" fill=\"currentColor\"/>"},
    {"sec": "ADMINISTRACIÓN"},
    {"href": "/residencial/empleado-mes.html", "label": "Empleado del Mes", "color": "#ca8a04", "icon": "<path d=\"M12 2l3 6.5 7 .8-5.2 4.8 1.4 7-6.2-3.6L5.8 21.1l1.4-7L2 9.3l7-.8z\"/>"},
    {"href": "/residencial/tabla-puntaje.html", "label": "Tabla de Puntaje", "color": "#ea580c", "icon": "<line x1=\"9\" y1=\"6\" x2=\"20\" y2=\"6\"/><line x1=\"9\" y1=\"12\" x2=\"20\" y2=\"12\"/><line x1=\"9\" y1=\"18\" x2=\"20\" y2=\"18\"/><circle cx=\"4.5\" cy=\"6\" r=\"1.3\" fill=\"currentColor\"/><circle cx=\"4.5\" cy=\"12\" r=\"1.3\" fill=\"currentColor\"/><circle cx=\"4.5\" cy=\"18\" r=\"1.3\" fill=\"currentColor\"/>"},
    {"href": "/crear-cuenta.html", "label": "Permisos", "color": "#4f46e5", "icon": "<path d=\"M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z\"/><path d=\"M9 12l2 2 4-4\"/>"},
    {"href": "/residencial/tiempo-laboral.html", "label": "Tiempo laboral", "color": "#0284c7", "icon": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3.5 2\"/>"},
    {"href": "/chat.html", "label": "Chat", "color": "#0d9488", "icon": "<path d=\"M4 5h16v11H9l-5 4V5z\"/>"}
  ],

  LINEAS: [
    {"head": "SERVICIOS MÓVILES"},
    {"href": "/lineas/inicio.html", "label": "Inicio", "color": "#059669", "icon": "<path d=\"M3 11l9-7 9 7\"/><path d=\"M5 10v10h14V10\"/>"},
    {"href": "/lineas/lead.html", "label": "Nuevo Lead", "color": "#0d9488", "icon": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20c0-4 3-6 6-6s6 2 6 6\"/><line x1=\"19\" y1=\"8\" x2=\"19\" y2=\"14\"/><line x1=\"16\" y1=\"11\" x2=\"22\" y2=\"11\"/>"},
    {"href": "/lineas/costumer.html", "label": "Costumer Líneas", "color": "#0d9488", "icon": "<circle cx=\"8\" cy=\"8\" r=\"3\"/><path d=\"M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6\"/><circle cx=\"17\" cy=\"9\" r=\"2.6\"/><path d=\"M15.5 14c2.6.4 4.5 2.6 4.5 6\"/>"},
    {"href": "/lineas/estadisticas.html", "label": "Estadísticas Líneas", "color": "#0d9488", "icon": "<line x1=\"4\" y1=\"20\" x2=\"20\" y2=\"20\"/><rect x=\"6\" y=\"12\" width=\"3\" height=\"8\" rx=\"2\"/><rect x=\"11\" y=\"8\" width=\"3\" height=\"12\" rx=\"2\"/><rect x=\"16\" y=\"4\" width=\"3\" height=\"16\" rx=\"2\"/>"},
    {"href": "/lineas/ranking.html", "label": "Ranking Líneas", "color": "#0d9488", "icon": "<path d=\"M4 16l5-5 4 3 7-8\"/><path d=\"M4 20h16\"/>"}
  ],
  };

  const SVG_ATTRS = 'width="17" height="17" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';

  // ── Utilidades ───────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Normaliza para comparar la ruta actual con el href de cada botón. */
  function normPath(p) {
    try { p = new URL(p, location.origin).pathname; } catch (_) { }
    return p.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
  }

  // ── Marcado ──────────────────────────────────────────────────────
  function itemHtml(it, activo, soloAdmin) {
    // aria-label además de la etiqueta visible: en escritorio el sidebar arranca
    // colapsado y .sb-lbl queda en display:none, que lo saca del árbol de
    // accesibilidad. Sin esto, un lector de pantalla anunciaba 25 enlaces sin
    // nombre. `title` da además el tooltip al pasar el ratón estando colapsado.
    return '<a href="' + esc(it.href) + '" class="sb-item' + (it.mov ? ' mov' : '') +
      (activo ? ' active' : '') + '"' +
      (soloAdmin ? ' data-admin-only' : '') +
      (activo ? ' aria-current="page"' : '') +
      ' aria-label="' + esc(it.label) + '" title="' + esc(it.label) + '">' +
      '<span class="sb-ic"><svg ' + SVG_ATTRS + ' aria-hidden="true" focusable="false">' +
        it.icon + '</svg></span>' +
      '<span class="sb-lbl">' + esc(it.label) + '</span>' +
      '<svg class="sb-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg></a>';
  }

  function grupoHtml(lista, soloAdmin, mov, rutaActual) {
    return lista.map(function (e) {
      if (e.sec)  return '<div class="sb-sec"' + (soloAdmin ? ' data-admin-only' : '') + '>' + esc(e.sec) + '</div>';
      if (e.head) return '<div class="sb-mov-head"' + (soloAdmin ? ' data-admin-only' : '') + '>' + esc(e.head) + '</div>';
      e.mov = mov;
      return itemHtml(e, normPath(e.href) === rutaActual, soloAdmin);
    }).join('\n');
  }

  /** Ventana del banner de independencia: del 15 de agosto al 30 de septiembre.
   *  Fuera de ella vuelve la frase del pie. Se hace por fecha y no a mano porque
   *  este módulo alimenta las 37 páginas: si dependiera de acordarse de quitarlo,
   *  el 15 de septiembre seguiría ahí en diciembre. Para moverlo, tocar sólo
   *  estas dos constantes. */
  const BANNER_DESDE = { mes: 7, dia: 15 };   // 7 = agosto (los meses van de 0 a 11)
  const BANNER_HASTA = { mes: 8, dia: 30 };   // 8 = septiembre

  function enTemporadaIndependencia(hoy) {
    const d = hoy || new Date();
    const m = d.getMonth(), dia = d.getDate();
    if (m < BANNER_DESDE.mes || m > BANNER_HASTA.mes) return false;
    if (m === BANNER_DESDE.mes) return dia >= BANNER_DESDE.dia;
    if (m === BANNER_HASTA.mes) return dia <= BANNER_HASTA.dia;
    return true;
  }

  function render(nav) {
    const ruta = normPath(location.pathname);
    const enLineas = ruta.indexOf('/lineas/') === 0;
    const propio  = enLineas ? MENU.LINEAS : MENU.RESIDENCIAL;
    const ajeno   = enLineas ? MENU.RESIDENCIAL : MENU.LINEAS;

    nav.setAttribute('aria-label', 'Menú principal');
    nav.innerHTML =
      // Franja de bandera. Es decorativa, así que va con aria-hidden y sin alt:
      // no aporta nada a quien navega con lector de pantalla y sería ruido.
      '<div class="sb-flag" aria-hidden="true"></div>' +
      '<div class="sb-user">' +
        '<div class="sb-user-avatar-wrap">' +
          '<div class="sb-user-avatar">' +
            '<img id="sb-user-avatar-img" alt="" hidden>' +
            '<span id="sb-user-initials">?</span>' +
          '</div>' +
          '<span class="sb-user-badge" aria-hidden="true">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">' +
            '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" opacity=".95"/></svg>' +
          '</span>' +
          '<button type="button" class="sb-user-edit-btn" id="sb-user-edit-btn" ' +
            'title="Cambiar foto de perfil" aria-label="Cambiar foto de perfil">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
              '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
          '</button>' +
          '<input type="file" id="sb-user-avatar-input" accept="image/*" hidden>' +
        '</div>' +
        '<div class="sb-user-meta">' +
          '<div class="sb-user-name" id="sb-user-name">Usuario</div>' +
          '<div class="sb-user-role" id="sb-user-role">Rol</div>' +
          // Se rellena desde la API; si el usuario no tiene correo, sidebar-user.js
          // deja la fila oculta en vez de mostrarla vacía.
          '<div class="sb-user-mail" id="sb-user-mail" hidden>' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2" aria-hidden="true" focusable="false">' +
              '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>' +
            '<span id="sb-user-mail-text"></span>' +
          '</div>' +
        '</div>' +
        '<div class="sb-user-rule" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="sb-scroll">' +
        grupoHtml(propio, false, enLineas, ruta) +
        grupoHtml(ajeno,  true,  !enLineas, ruta) +
      '</div>' +
      '<div class="sb-footer">' +
        // Banner de temporada. Se pinta sólo dentro de su ventana de fechas: si no,
        // el 16 de septiembre seguiría ahí y habría que acordarse de quitarlo a mano
        // en un módulo que alimenta 37 páginas.
        (enTemporadaIndependencia()
          ? '<img class="sb-banner" src="/images/mesindependencia.webp" width="323" height="136" ' +
            'alt="Mes de la Independencia de El Salvador, 15 de septiembre" loading="lazy">'
          : '<p class="sb-quote">"El éxito es la suma de pequeños esfuerzos repetidos día tras día"</p>') +
        '<button type="button" class="sb-logout" data-logout-button title="Cerrar Sesión" aria-label="Cerrar Sesión">' +
          '<span class="sb-ic">' +
            '<svg ' + SVG_ATTRS + ' aria-hidden="true" focusable="false">' +
            '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>' +
            '</svg></span>' +
          '<span class="sb-lbl">Cerrar Sesión</span>' +
          '<svg class="sb-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            '<path d="m9 18 6-6-6-6"/></svg>' +
        '</button>' +
      '</div>';
  }

  const nav = document.getElementById('app-sidebar');
  if (nav) {
    render(nav);
    // Aviso a quien venga después (sidebar-user.js, el toggle móvil): el marcado
    // ya está en el DOM y se le puede consultar.
    document.dispatchEvent(new CustomEvent('sidebar:ready', { detail: { nav: nav } }));
  }
})();
