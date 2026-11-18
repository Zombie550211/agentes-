/* Guirnalda navideña en 3D colgada de la esquina de una tarjeta (Inicio, 18-nov-2026).
 *
 * Reemplaza las imágenes navidad3/navidad4. Se dibuja en código, así que sigue exactamente
 * el borde y la esquina redondeada de la tarjeta a cualquier tamaño de pantalla:
 *   - Ramas de pino: miles de agujas en 4 capas (sombra, base, medio, brillo) dentro de
 *     solo 4 <path>, con nieve, bayas y piñas. Es un SVG estático: se pinta una vez.
 *   - Moño de satén rojo con filo dorado en la esquina.
 *   - Bolas colgando de hilos: HTML con degradados y sombras internas (luz arriba a la
 *     izquierda) que se balancean con transform, que el navegador hace en la GPU sin
 *     repintar. Sin WebGL ni canvas (ver PCs de los agentes).
 *   - Luces que titilan a lo largo de la rama y destellos en las bolas (solo opacidad y
 *     transform, también en la GPU).
 *   - Al cargar: barrido que dibuja la guirnalda desde la punta de abajo hasta la de arriba
 *     (máscara SVG); el moño aparece al pasar por la esquina y las bolas caen a su paso.
 *   - Interactiva: al pasar el mouse cerca de una bola la empuja según la velocidad del
 *     cursor y oscila como un péndulo. El cálculo solo corre mientras alguna se mueve.
 *   En modo ligero o con «reducir movimiento» aparece sin animaciones y no reacciona.
 *
 * Uso: <div class="gn" data-guirnalda="izq|der" aria-hidden="true"></div> dentro de una
 * tarjeta con position:relative. «izq» cuelga de la esquina superior izquierda y «der» de
 * la superior derecha. Medidas en css/paginas/inicio.css (.gn).
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var M = 18;       // margen: el borde de la tarjeta queda a 18 px del borde del lienzo
  var R = 18;       // radio de la esquina de la tarjeta (--radius-glass en Inicio)
  var DUR = 3.2;    // segundos del barrido de entrada (tarjetas y barra)

  // Configuración de cada guirnalda: largo de los brazos y bolas (posición en el brazo de
  // arriba, «x», o en el lateral, «y»; largo del hilo; tamaño; tipo).
  var CONF = {
    izq: {
      ancho: 300, alto: 170, semilla: 7,
      bolas: [
        { x: 100, hilo: 26, d: 30, tipo: 'roja' },
        { x: 150, hilo: 12, d: 22, tipo: 'dorada' },
        { x: 208, hilo: 34, d: 26, tipo: 'roja' },
        { x: 262, hilo: 14, d: 18, tipo: 'dorada' },
        { y: 120, hilo: 10, d: 20, tipo: 'dorada' }
      ]
    },
    der: {
      ancho: 250, alto: 150, semilla: 23,
      bolas: [
        { x: 104, hilo: 30, d: 30, tipo: 'roja' },
        { x: 160, hilo: 14, d: 22, tipo: 'dorada' },
        { x: 214, hilo: 22, d: 18, tipo: 'roja' },
        { y: 110, hilo: 12, d: 22, tipo: 'roja' }
      ]
    }
  };

  // Aleatorio con semilla: la guirnalda sale idéntica en cada carga.
  function azar(semilla) {
    var a = semilla >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(nombre, attrs, padre) {
    var n = document.createElementNS(NS, nombre);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(n);
    return n;
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  // Recorrido del borde: baja por el lateral izquierdo hasta la esquina, la rodea y sigue
  // por arriba. s = 0 es el extremo de abajo; devuelve punto y dirección (hacia s mayor).
  function recorrido(ancho, alto) {
    var lat = alto - (M + R), arco = Math.PI * R / 2, sup = ancho - (M + R);
    var total = lat + arco + sup;
    function punto(s) {
      if (s <= lat) return { x: M, y: alto - s, tx: 0, ty: -1 };
      if (s <= lat + arco) {
        var a = Math.PI - (s - lat) / R * (Math.PI / 2);     // de 180° a 90°
        return { x: M + R + R * Math.cos(a), y: M + R - R * Math.sin(a),
                 tx: Math.sin(a), ty: Math.cos(a) };
      }
      return { x: M + R + (s - lat - arco), y: M, tx: 1, ty: 0 };
    }
    return { total: total, esquina: lat + arco / 2, punto: punto };
  }

  // Recorrido por una curva cualquiera f(t), t de 0 a 1, muestreada en tramos rectos.
  function caminoCurva(f, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push(f(i / n));
    return caminoPuntos(pts);
  }

  function caminoPuntos(pts) {
    var n = pts.length - 1, largo = [0], i;
    for (i = 1; i <= n; i++) largo.push(largo[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    var total = largo[n];
    return { total: total, esquina: total, punto: function (s) {
      var i = 1;
      while (i < n && largo[i] < s) i++;
      var a = pts[i - 1], b = pts[i], seg = (largo[i] - largo[i - 1]) || 1;
      var k = Math.max(0, Math.min(1, (s - largo[i - 1]) / seg));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k,
               tx: (b.x - a.x) / seg, ty: (b.y - a.y) / seg };
    } };
  }

  // Contorno de un rectángulo redondeado (la barra), en sentido horario desde arriba a la izquierda.
  function contorno(A, H, r, fuera) {
    var x0 = -fuera, y0 = -fuera, x1 = A + fuera, y1 = H + fuera, rr = r + fuera, pts = [];
    function arco(cx, cy, a0) {
      for (var k = 0; k <= 8; k++) {
        var a = a0 + k / 8 * Math.PI / 2;
        pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
      }
    }
    arco(x0 + rr, y0 + rr, Math.PI);
    arco(x1 - rr, y0 + rr, -Math.PI / 2);
    arco(x1 - rr, y1 - rr, 0);
    arco(x0 + rr, y1 - rr, Math.PI / 2);
    pts.push(pts[0]);
    return caminoPuntos(pts);
  }

  function bezier(a, c, b) {
    return function (t) {
      var u = 1 - t;
      return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
    };
  }

  function defs(svg, id) {
    var d = el('defs', {}, svg);
    var g;
    g = el('radialGradient', { id: id + 'baya', cx: '35%', cy: '30%', r: '70%' }, d);
    el('stop', { offset: '0', 'stop-color': '#ffd1cf' }, g);
    el('stop', { offset: '.25', 'stop-color': '#ef2b2b' }, g);
    el('stop', { offset: '1', 'stop-color': '#6d0008' }, g);
    g = el('linearGradient', { id: id + 'acebo', x1: '0', y1: '0', x2: '0', y2: '1' }, d);
    el('stop', { offset: '0', 'stop-color': '#3f9a4a' }, g);
    el('stop', { offset: '1', 'stop-color': '#145a27' }, g);
    g = el('linearGradient', { id: id + 'saten', x1: '0', y1: '0', x2: '0', y2: '1' }, d);
    el('stop', { offset: '0', 'stop-color': '#ff6b5e' }, g);
    el('stop', { offset: '.45', 'stop-color': '#d8162a' }, g);
    el('stop', { offset: '1', 'stop-color': '#7a0611' }, g);
    g = el('linearGradient', { id: id + 'cola', x1: '0', y1: '0', x2: '1', y2: '1' }, d);
    el('stop', { offset: '0', 'stop-color': '#c3121f' }, g);
    el('stop', { offset: '.5', 'stop-color': '#ff4b45' }, g);
    el('stop', { offset: '1', 'stop-color': '#8a0814' }, g);
  }

  // Ramas de pino: agujas que salen del centro de la guirnalda hacia los extremos.
  // opc (para la barra): grosor fijo, alma más fina y colores en sombra para lo de atrás.
  function ramas(svg, camino, rnd, opc) {
    opc = opc || {};
    var capas = opc.atras ? [
      { color: '#0c3a1d', ancho: 1.9, dx: 0, dy: 0, n: 3, largo: 1 },
      { color: '#17532b', ancho: 1.6, dx: 0, dy: 0, n: 3, largo: .9 },
      { color: '#2e8040', ancho: 1.2, dx: 0, dy: -.4, n: 2, largo: .7 }
    ] : [
      { color: '#0b2e19', ancho: 2.4, dx: 1.6, dy: 3, n: 3, largo: 1.05 }, // sombra en la tarjeta
      { color: '#14522b', ancho: 2,   dx: 0,   dy: 0, n: 3, largo: 1 },
      { color: '#21773a', ancho: 1.7, dx: 0,   dy: -.5, n: 3, largo: .9 },
      { color: '#5cb85a', ancho: 1.2, dx: -.4, dy: -1, n: 2, largo: .65 }    // brillo de arriba
    ];
    var total = camino.total, cen = camino.esquina;
    var trazos = capas.map(function () { return []; });
    var alma = [];
    for (var s = opc.grosor ? 0 : 2; s < total - (opc.grosor ? 0 : 2); s += opc.paso || (opc.grosor ? 1.6 : 2)) {
      var p = camino.punto(s);
      // Grosor: lleno cerca del moño y afinándose hacia las puntas.
      var u = s < cen ? s / cen : (total - s) / (total - cen);
      var gr = opc.grosor || 8 + 15 * Math.pow(Math.min(1, u * 1.15), .55);
      alma.push((alma.length ? 'L' : 'M') + r1(p.x) + ' ' + r1(p.y));
      var sentido = opc.grosor ? 1 : s < cen ? -1 : 1;   // las agujas miran hacia la punta
      var fx = p.tx * sentido, fy = p.ty * sentido;
      capas.forEach(function (c, i) {
        for (var k = 0; k < c.n; k++) {
          var lado = rnd() < .5 ? -1 : 1;
          var ang = lado * (0.45 + rnd() * 0.85);
          var ca = Math.cos(ang), sa = Math.sin(ang);
          var dx = fx * ca - fy * sa, dy = fx * sa + fy * ca;
          var off = (rnd() - .5) * gr * .55;
          var x0 = p.x - fy * off + c.dx, y0 = p.y + fx * off + c.dy;
          var L = gr * c.largo * (.6 + rnd() * .55);
          trazos[i].push('M' + r1(x0) + ' ' + r1(y0) + 'l' + r1(dx * L) + ' ' + r1(dy * L));
        }
      });
    }
    var g = el('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }, svg);
    el('path', { d: alma.join(''), stroke: opc.atras ? '#0a2f17' : '#0d3b20', 'stroke-width': opc.alma || 13 }, g);
    capas.forEach(function (c, i) {
      el('path', { d: trazos[i].join(''), stroke: c.color, 'stroke-width': c.ancho,
        opacity: i === 0 && !opc.atras ? .45 : 1 }, g);
    });
    return alma.join('');
  }

  function nieve(svg, camino, rnd) {
    var g = el('g', { fill: '#fff' }, svg);
    for (var s = 30; s < camino.total - 20; s += 30 + rnd() * 30) {
      var p = camino.punto(s);
      // La nieve se queda en la cara de arriba (o la de fuera, en el lateral).
      var nx = p.ty, ny = -p.tx;              // normal hacia arriba (o hacia fuera en el lateral)
      var x = p.x + nx * (3 + rnd() * 4), y = p.y + ny * (3 + rnd() * 4);
      el('ellipse', { cx: r1(x), cy: r1(y), rx: r1(3.5 + rnd() * 4), ry: r1(1.6 + rnd() * 1.4),
        transform: 'rotate(' + r1(Math.atan2(p.ty, p.tx) * 57.3) + ' ' + r1(x) + ' ' + r1(y) + ')',
        opacity: .92 }, g);
    }
  }

  function bayas(svg, camino, rnd, id) {
    var g = el('g', {}, svg);
    for (var s = 40; s < camino.total - 30; s += 46 + rnd() * 30) {
      if (Math.abs(s - camino.esquina) < 30) continue;    // el moño ocupa la esquina
      var p = camino.punto(s);
      for (var k = 0; k < 3; k++) {
        var x = p.x + (rnd() - .5) * 10, y = p.y + (rnd() - .5) * 10;
        el('circle', { cx: r1(x + .8), cy: r1(y + 1.6), r: 3.6, fill: '#000', opacity: .25 }, g);
        el('circle', { cx: r1(x), cy: r1(y), r: 3.4, fill: 'url(#' + id + 'baya)' }, g);
      }
    }
  }

  // Hojas de acebo junto al moño: verde brillante con nervio claro.
  function acebo(svg, camino, id) {
    var p = camino.punto(camino.esquina);
    var hoja = 'M0 0 l4 -3 l1 3.5 l4 -2.5 l0.5 3.5 l4.5 -1.5 l-1 3.5 l4 0.5 l-3 3 ' +
               'l-4 -0.5 l1 3 l-4.5 -1.5 l-0.5 3.5 l-4 -2.5 l-1 3.5 l-4 -3 Z';
    [[-4, 6, 200], [8, -4, 300], [14, 8, 20]].forEach(function (h) {
      var g = el('g', { transform: 'translate(' + r1(p.x + h[0]) + ' ' + r1(p.y + h[1]) + ') rotate(' + h[2] + ') scale(1.25)' }, svg);
      el('path', { d: hoja, fill: 'url(#' + id + 'acebo)', stroke: '#0b3a1c', 'stroke-width': .6, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M1 1.5 L22 2', stroke: '#9fd49a', 'stroke-width': .7, opacity: .8 }, g);
    });
  }

  // Moño de satén en la esquina: dos lazos, dos colas y el nudo, con filo dorado.
  function mono(svg, camino, id, mini) {
    var p = camino.punto(camino.esquina);
    // En pequeño el moño va justo sobre la esquina para no tapar el contenido de la tarjeta.
    var g = el('g', { transform: 'translate(' + r1(p.x + (mini ? 2 : 16)) + ' ' + r1(p.y + (mini ? 0 : 13)) + ') scale(1.2)',
      stroke: '#e9b949', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, svg);
    g = el('g', { class: 'gn-mono' }, g);
    el('ellipse', { cx: 3, cy: 6, rx: 30, ry: 14, fill: '#000', stroke: 'none', opacity: .18 }, g);
    // colas
    el('path', { d: 'M-2 2 C-8 16 -14 30 -22 44 L-12 40 L-8 50 C-2 34 2 18 2 4 Z', fill: 'url(#' + id + 'cola)' }, g);
    el('path', { d: 'M2 2 C10 14 20 26 32 36 L22 36 L24 46 C14 32 6 18 -1 5 Z', fill: 'url(#' + id + 'cola)' }, g);
    // lazos
    el('path', { d: 'M0 0 C-12 -20 -38 -22 -36 -6 C-34 8 -12 8 0 0 Z', fill: 'url(#' + id + 'saten)' }, g);
    el('path', { d: 'M0 0 C12 -20 38 -22 36 -6 C34 8 12 8 0 0 Z', fill: 'url(#' + id + 'saten)' }, g);
    // pliegue interior de los lazos
    el('path', { d: 'M-6 -2 C-16 -10 -26 -12 -30 -7', fill: 'none', stroke: '#8f0a16', 'stroke-width': 1.2, opacity: .7 }, g);
    el('path', { d: 'M6 -2 C16 -10 26 -12 30 -7', fill: 'none', stroke: '#8f0a16', 'stroke-width': 1.2, opacity: .7 }, g);
    // brillo del satén
    el('path', { d: 'M-8 -9 C-16 -15 -26 -16 -31 -11', fill: 'none', stroke: '#ffd6cf', 'stroke-width': 1.6, opacity: .55, 'stroke-linecap': 'round' }, g);
    el('path', { d: 'M8 -9 C16 -15 26 -16 31 -11', fill: 'none', stroke: '#ffd6cf', 'stroke-width': 1.6, opacity: .55, 'stroke-linecap': 'round' }, g);
    // nudo
    el('rect', { x: -6, y: -7, width: 12, height: 13, rx: 4, fill: 'url(#' + id + 'saten)' }, g);
    el('ellipse', { cx: -1.5, cy: -3.5, rx: 2.4, ry: 1.4, fill: '#fff', stroke: 'none', opacity: .7 }, g);
  }

  // Momento del barrido (0 a 1) en que pasa por la distancia s del recorrido.
  function momento(camino, s) { return Math.max(0, Math.min(1, s / camino.total)); }

  // Bola de cristal colgando de un hilo. Va en HTML para que todo el movimiento sea transform:
  //   .gn-colgante (balanceo suave, CSS) > .gn-golpe (empujón del mouse, JS) > .gn-entra (caída).
  function bola(cont, camino, b, espejo, ancho, i) {
    var x, y, s;
    var lat = camino.total - (ancho - (M + R)) - Math.PI * R / 2;
    if (b.x != null) { x = b.x; y = M + 2; s = lat + Math.PI * R / 2 + (b.x - M - R); }
    else { x = M + 3; y = b.y; s = lat - (b.y - (M + R)); }
    if (espejo) x = ancho - x;
    var c = document.createElement('span');
    c.className = 'gn-colgante gn-' + b.tipo;
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    c.style.setProperty('--hilo', b.hilo + 'px');
    c.style.setProperty('--d', b.d + 'px');
    // Cada bola con su propio ritmo para que no se muevan al unísono.
    c.style.setProperty('--dur', (3.1 + (i % 3) * .7 + b.d / 40).toFixed(2) + 's');
    c.style.setProperty('--ret', (-(i * 1.3)).toFixed(2) + 's');
    c.style.setProperty('--entra', (momento(camino, s) * DUR + .05).toFixed(2) + 's');
    c.style.setProperty('--brilla', (2 + i * 1.7).toFixed(2) + 's');
    c.innerHTML = '<span class="gn-golpe"><span class="gn-entra"><span class="gn-hilo"></span>' +
      '<span class="gn-tapa"></span><span class="gn-esfera"></span></span></span>';
    cont.appendChild(c);
    return { golpe: c.firstChild, x: x, y: y, hilo: b.hilo, d: b.d, ang: 0, vel: 0 };
  }

  // Luces cálidas sobre la rama: se encienden al paso del barrido y luego titilan.
  function luces(cont, camino, rnd, espejo, ancho) {
    var colores = ['calida', 'calida', 'dorada', 'roja'];
    var n = 0;
    for (var s = 12; s < camino.total - 8; s += 19 + rnd() * 9) {
      if (Math.abs(s - camino.esquina) < 30) continue;   // el moño ocupa la esquina
      var p = camino.punto(s);
      var off = (rnd() - .5) * 14;
      var x = p.x - p.ty * off, y = p.y + p.tx * off;
      if (espejo) x = ancho - x;
      var l = document.createElement('span');
      l.className = 'gn-luz gn-luz-' + colores[n++ % colores.length];
      l.style.left = r1(x) + 'px';
      l.style.top = r1(y) + 'px';
      l.style.setProperty('--entra', (momento(camino, s) * DUR).toFixed(2) + 's');
      l.style.setProperty('--tit', (1.2 + rnd() * 1.6).toFixed(2) + 's');
      l.style.setProperty('--ret', (-rnd() * 3).toFixed(2) + 's');
      cont.appendChild(l);
    }
  }

  // opc.mini (tarjetas de título de las demás páginas): solo las bolas del costado, que cuelgan
  // por fuera de la tarjeta; las de arriba taparían el título y los controles.
  function dibujar(cont, opc) {
    opc = opc || {};
    var lado = cont.getAttribute('data-guirnalda') === 'der' ? 'der' : 'izq';
    var cf = CONF[lado];
    var id = 'gn-' + lado + '-';
    var rnd = azar(cf.semilla);
    var camino = recorrido(cf.ancho, cf.alto);
    cont.style.setProperty('--gn-ancho', cf.ancho + 'px');
    cont.style.setProperty('--gn-alto', cf.alto + 'px');

    var svg = el('svg', { viewBox: '0 0 ' + cf.ancho + ' ' + cf.alto, width: cf.ancho, height: cf.alto,
      focusable: 'false', 'aria-hidden': 'true' });
    defs(svg, id);
    // La guirnalda derecha es la izquierda en espejo.
    var raiz = el('g', lado === 'der' ? { transform: 'translate(' + cf.ancho + ' 0) scale(-1 1)' } : {}, svg);
    // Barrido de entrada: un trazo grueso de la máscara recorre la rama de punta a punta.
    var mascara = el('mask', { id: id + 'barrido', maskUnits: 'userSpaceOnUse',
      x: -60, y: -60, width: cf.ancho + 120, height: cf.alto + 120 }, raiz);
    var trazo = el('path', { class: 'gn-barrido', fill: 'none', stroke: '#fff', 'stroke-width': 90,
      pathLength: 1, 'stroke-dasharray': '1.2 1.2', 'stroke-dashoffset': 0 }, mascara);
    var rama = el('g', { mask: 'url(#' + id + 'barrido)' }, raiz);
    var alma = ramas(rama, camino, rnd);
    // El trazo arranca y termina un poco más allá de las puntas para no dejar agujas cortadas.
    var a = camino.punto(0), z = camino.punto(camino.total);
    trazo.setAttribute('d', 'M' + a.x + ' ' + (a.y + 40) + 'L' + alma.slice(1) + 'L' + (z.x + 40) + ' ' + z.y);
    nieve(rama, camino, rnd);
    bayas(rama, camino, rnd, id);
    acebo(rama, camino, id);
    mono(raiz, camino, id, opc.mini);
    cont.style.setProperty('--gn-dur', DUR + 's');
    cont.style.setProperty('--gn-esquina', (momento(camino, camino.esquina) * DUR).toFixed(2) + 's');
    cont.appendChild(svg);

    luces(cont, camino, rnd, lado === 'der', cf.ancho);
    return cf.bolas.filter(function (b) { return !opc.mini || b.y != null; })
      .map(function (b, i) { return bola(cont, camino, b, lado === 'der', cf.ancho, i); });
  }

  var bolas = [];          // { golpe, x, y, hilo, d, ang, vel, cont }: todas las que se pueden empujar

  // ── Guirnalda enrollada en la barra del menú ───────────────────────────────────────────
  // Enroscada como una culebra en una rama: una espiral continua a todo lo largo de la
  // barra. Por delante pasa DEBAJO de los textos del menú (que siguen encima y se pueden
  // pulsar); por detrás solo asoma fuera del borde, donde da la vuelta.
  // Se vuelve a dibujar si cambia el ancho de la barra (el menú se arma después de cargar).
  // Medidas sin la escala de la transición de entrada de la página (getBoundingClientRect
  // incluye transform; offsetWidth no): todo se pasa a píxeles reales de la capa.
  function huecosBarra(barra, capa) {
    var r = capa.getBoundingClientRect();
    var esc = (r.width / (capa.offsetWidth || r.width)) || 1;
    r = { left: r.left, top: r.top, width: capa.offsetWidth || r.width, height: capa.offsetHeight || r.height };
    var bloques = [];
    barra.querySelectorAll('.tn > .tn-grupo, .in-iconos').forEach(function (n) {
      var b = n.getBoundingClientRect();
      if (b.width) bloques.push({ a: (b.left - r.left) / esc, z: (b.right - r.left) / esc });
    });
    bloques.sort(function (p, q) { return p.a - q.a; });
    var huecos = [], prev = 0;
    // Solo huecos donde el cruce (unos 19 px de ancho) cabe sin tocar texto ni iconos.
    bloques.forEach(function (b) {
      if (b.a - prev >= 15) huecos.push((prev + b.a) / 2);
      prev = Math.max(prev, b.z);
    });
    if (r.width - prev >= 20) huecos.push((prev + r.width) / 2);
    return { ancho: r.width, alto: r.height, huecos: huecos };
  }

  function dibujarBarra(capa, barra, animar) {
    var m = huecosBarra(barra, capa);
    var A = m.ancho, H = m.alto, rnd = azar(41);
    if (A < 200) return;
    capa.textContent = '';
    capa.classList.toggle('gnb-quieta', !animar);
    var svg = el('svg', { viewBox: '0 0 ' + A + ' ' + H, width: A, height: H, focusable: 'false', 'aria-hidden': 'true' });
    var defs = el('defs', {}, svg);
    // Recorte: lo que pasa por detrás solo se ve FUERA de la barra (su forma redondeada).
    var rr = 18, recorte = el('clipPath', { id: 'gnb-fuera' }, defs);
    el('path', { 'clip-rule': 'evenodd', d: 'M-60 -60H' + (A + 60) + 'V' + (H + 60) + 'H-60Z' +
      'M' + rr + ' 0H' + (A - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + A + ' ' + rr + 'V' + (H - rr) +
      'A' + rr + ' ' + rr + ' 0 0 1 ' + (A - rr) + ' ' + H + 'H' + rr + 'A' + rr + ' ' + rr + ' 0 0 1 0 ' + (H - rr) +
      'V' + rr + 'A' + rr + ' ' + rr + ' 0 0 1 ' + rr + ' 0Z' }, recorte);
    // Se descubre de izquierda a derecha, como si se fuera enroscando.
    var revela = el('mask', { id: 'gnb-revela', maskUnits: 'userSpaceOnUse', x: -40, y: -40, width: A + 80, height: H + 80 }, defs);
    el('rect', { class: 'gnb-revela', x: -40, y: -40, width: A + 80, height: H + 80, fill: '#fff' }, revela);
    var todo = el('g', { mask: 'url(#gnb-revela)' }, svg);
    var atras = el('g', { 'clip-path': 'url(#gnb-fuera)' }, todo), frente = el('g', {}, todo);

    // Espiral alrededor de la barra (un tubo visto de frente): ángulo th, x avanza con th,
    // y = centro − radio·sen(th) y la profundidad es cos(th): > 0 por delante, < 0 por detrás.
    // El radio es un poco mayor que media barra para que asome por arriba y por abajo al dar la vuelta.
    var paso = 96;                                        // px que avanza en cada vuelta
    var vueltas = Math.max(4, Math.round((A + 40) / paso));
    paso = (A + 40) / vueltas;
    var c = H / 2, rad = H / 2 + 5, x0 = -20;
    // Pestaña angosta: el menú se parte en dos líneas y la barra crece. Una espiral tan alta
    // cruzaría los textos, así que se enrosca solo en el borde de abajo, bajo la última línea.
    var alta = H > 80;
    if (alta) { rad = 16; c = H + 2; }
    var tramos = [], actual = null, delante = null;
    for (var k = 0; k <= vueltas * 72; k++) {
      var th = -Math.PI / 2 + k / 72 * Math.PI * 2;
      var pt = { x: x0 + (th + Math.PI / 2) / (Math.PI * 2) * paso, y: c - rad * Math.sin(th) };
      var d = Math.cos(th) >= 0;
      if (d !== delante) {
        if (actual) actual.pts.push(pt);
        actual = { delante: d, pts: [pt] };
        tramos.push(actual);
        delante = d;
      } else actual.pts.push(pt);
    }
    var n = 0;
    tramos.forEach(function (t) {
      if (t.pts.length < 3) return;
      var camino = caminoPuntos(t.pts);
      if (t.delante) {
        ramas(frente, camino, rnd, { grosor: 5, alma: 5 });
        // Tres luces por vuelta. Después de encenderse corren en ola de izquierda a derecha
        // (el retraso depende de la posición), como una serie navideña.
        [.2, .5, .8].forEach(function (f, q) {
          var p = camino.punto(camino.total * f);
          var l = document.createElement('span');
          l.className = 'gn-luz gnb-carrera gn-luz-' + ['calida', 'roja', 'dorada'][(n + q) % 3];
          l.style.left = r1(p.x) + 'px';
          l.style.top = r1(p.y) + 'px';
          l.style.setProperty('--entra', ((p.x / A) * DUR + .1).toFixed(2) + 's');
          l.style.setProperty('--ola', (-(1 - p.x / A) * 2.4).toFixed(2) + 's');
          capa.appendChild(l);
        });
        n++;
      } else {
        ramas(atras, camino, rnd, { grosor: 5, alma: 5, atras: true });
      }
    });
    capa.insertBefore(svg, capa.firstChild);

    // Destello que recorre la guirnalda cada pocos segundos (solo transform: GPU).
    var brillo = document.createElement('span');
    brillo.className = 'gnb-brillo';
    brillo.style.setProperty('--entra', (DUR + .4).toFixed(2) + 's');
    capa.appendChild(brillo);

    // Bolitas colgando de las vueltas de abajo (una sí, una no): se mecen y el mouse las empuja.
    bolas = bolas.filter(function (b) { return b.cont !== capa; });
    for (var v = 1; v < vueltas; v += 2) {
      var bx = x0 + v * paso;
      if (bx < 30 || bx > A - 30) continue;
      var tipo = (v >> 1) % 2 ? 'dorada' : 'roja', d = 13 + (v % 3);
      var cb = document.createElement('span');
      cb.className = 'gn-colgante gn-' + tipo;
      cb.style.left = r1(bx) + 'px';
      var by = alta ? c + rad + 1 : H + 2;
      cb.style.top = by + 'px';
      cb.style.setProperty('--hilo', '5px');
      cb.style.setProperty('--d', d + 'px');
      cb.style.setProperty('--dur', (2.6 + (v % 4) * .4).toFixed(2) + 's');
      cb.style.setProperty('--ret', (-v * .9).toFixed(2) + 's');
      cb.style.setProperty('--entra', ((bx / A) * DUR + .2).toFixed(2) + 's');
      cb.style.setProperty('--brilla', (3 + v * .9).toFixed(2) + 's');
      cb.innerHTML = '<span class="gn-golpe"><span class="gn-entra"><span class="gn-hilo"></span>' +
        '<span class="gn-tapa"></span><span class="gn-esfera"></span></span></span>';
      capa.appendChild(cb);
      bolas.push({ golpe: cb.firstChild, x: bx, y: by, hilo: 5, d: d, ang: 0, vel: 0, cont: capa });
    }
  }

  function iniciarBarra() {
    // La barra del menú de cualquier página del CRM (Inicio la tiene suelta; el resto, arriba del panel).
    var barra = document.querySelector('.in-head');
    if (!barra || barra.querySelector('.gnb')) return;
    var capa = document.createElement('div');
    capa.className = 'gnb';
    capa.setAttribute('aria-hidden', 'true');
    barra.appendChild(capa);
    // La entrada animada de la barra se ve una sola vez por inicio de sesión (login.js borra
    // la marca al entrar); al cambiar de página la barra aparece ya puesta, sin animación.
    var CLAVE_ANIMADA = 'crm_gnb_animada', primera = true, espera = 0, ultimoAncho = '';
    try { primera = !localStorage.getItem(CLAVE_ANIMADA); } catch (_) {}
    function redibujar(cambios) {
      if (cambios && cambios.length && cambios[0].target && capa.contains(cambios[0].target)) return;
      clearTimeout(espera);
      espera = setTimeout(function () {
        var m = huecosBarra(barra, capa), clave = Math.round(m.ancho) + '|' + Math.round(m.alto);
        if (clave === ultimoAncho) return;
        ultimoAncho = clave;
        dibujarBarra(capa, barra, primera);
        if (m.ancho >= 200 && primera) {
          primera = false;
          try { localStorage.setItem(CLAVE_ANIMADA, '1'); } catch (_) {}
        }
      }, 120);
    }
    // Cada opción del menú se vigila por separado: su ancho cambia al cargar la fuente o
    // al armarse el menú, aunque la barra mida lo mismo.
    var ro = window.ResizeObserver ? new ResizeObserver(redibujar) : null;
    function vigilar() {
      if (!ro) return;
      ro.observe(barra);
      barra.querySelectorAll('.tn > .tn-grupo, .in-iconos').forEach(function (n) { ro.observe(n); });
    }
    if (window.MutationObserver) {
      new MutationObserver(function (lista) {
        if (lista.every(function (c) { return c.target === capa || capa.contains(c.target); })) return;
        vigilar(); redibujar();
      })
        .observe(barra, { childList: true, subtree: true });
    }
    window.addEventListener('resize', redibujar);
    vigilar();
    // La primera vez (la que se anima) se espera a la fuente para medir los huecos reales.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redibujar);
    else redibujar();
  }

  // ── Interacción: el cursor empuja las bolas (péndulo amortiguado) ──────────────────────
  var corriendo = false, ultimo = 0;
  var quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function paso(t) {
    // Tiempo real transcurrido (hasta 0,1 s) en pasos fijos de 8 ms: igual en un PC lento.
    var dt = Math.min(.1, (t - (ultimo || t)) / 1000) || .016;
    ultimo = t;
    var pasos = Math.ceil(dt / .008), h = dt / pasos;
    var activo = false;
    for (var i = 0; i < bolas.length; i++) {
      var b = bolas[i];
      if (!b.ang && !b.vel) continue;
      var largo = (b.hilo + b.d * .6) / 100;               // metros «de juguete»
      for (var k = 0; k < pasos; k++) {
        b.vel += (-9.8 / largo * Math.sin(b.ang) * .6 - b.vel * 2.2) * h;
        b.ang += b.vel * h;
      }
      if (Math.abs(b.ang) < .002 && Math.abs(b.vel) < .01) { b.ang = 0; b.vel = 0; }
      else activo = true;
      b.golpe.style.transform = b.ang ? 'rotate(' + (b.ang * 57.3).toFixed(2) + 'deg)' : '';
    }
    if (activo) requestAnimationFrame(paso);
    else { corriendo = false; ultimo = 0; }
  }

  function arrancar() {
    if (!corriendo) { corriendo = true; requestAnimationFrame(paso); }
  }

  function alMover(e) {
    // Regalos: brincan cuando el cursor les pasa por encima.
    for (var j = 0; j < saltos.length; j++) {
      var sj = saltos[j];
      if (sj.classList.contains('nv-brinca')) continue;
      var rs = sj.getBoundingClientRect();
      if (e.clientX > rs.left - 4 && e.clientX < rs.right + 4 && e.clientY > rs.top - 10 && e.clientY < rs.bottom) {
        sj.classList.add('nv-brinca');
        sj.addEventListener('animationend', function fin(ev) {
          if (ev.animationName !== 'nv-brinco') return;
          this.classList.remove('nv-brinca');
          this.removeEventListener('animationend', fin);
        });
      }
    }
    var dx = e.movementX || 0;
    if (!dx) return;
    for (var i = 0; i < bolas.length; i++) {
      var b = bolas[i];
      var r = b.cont.getBoundingClientRect();
      // Escala del lienzo (el árbol se dibuja a 200 px y se reduce a su hueco).
      var esc = r.width / (b.cont.offsetWidth || r.width) || 1;
      // Centro de la bola en reposo (más el giro actual, aproximado).
      var largo = b.hilo + b.d * .65;
      var cx = r.left + (b.x + Math.sin(b.ang) * largo) * esc, cy = r.top + (b.y + Math.cos(b.ang) * largo) * esc;
      var dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      var alcance = (b.d * .6 + 14) * esc;
      if (dist < alcance) {
        var fuerza = (1 - dist / alcance) * Math.max(-40, Math.min(40, dx)) * (34 / b.d) * .09;
        b.vel = Math.max(-9, Math.min(9, b.vel + fuerza));
        arrancar();
      }
    }
  }


  // ════════════════ Escenas de abajo: regalos (Casos pendientes) y árbol (Calendario) ═══════
  // Sustituyen a navidad1.webp y arbol-navideno.webp. Se dibujan en un lienzo de tamaño fijo
  // que se escala al ancho de su hueco (ResizeObserver), así el detalle no depende de la pantalla.
  //   - Cajas de regalo en 3D real (CSS preserve-3d: frente, lados y tapa con su luz).
  //   - Ramas y árbol con el mismo pino de agujas que las guirnaldas.
  //   - Entrada lenta al cargar; después destellos, luces en carrera, estrella que gira,
  //     bolas que se empujan con el mouse y regalos que brincan si el cursor pasa encima.
  var saltos = [];        // regalos que brincan al pasar el mouse
  var nGrad = 0;          // ids únicos para los degradados de cada moño

  function span(clase, padre, estilos) {
    var n = document.createElement('span');
    n.className = clase;
    if (estilos) for (var k in estilos) n.style.setProperty(k, estilos[k]);
    if (padre) padre.appendChild(n);
    return n;
  }

  // Moño de satén (rojo o dorado) como SVG suelto, para ponerlo sobre una caja o en el árbol.
  function lazoSvg(color, ancho) {
    var id = 'nvl' + (nGrad++), oro = color === 'oro';
    var c1 = oro ? ['#fff1b8', '#e2ad3b', '#8a5b0e'] : ['#ff7a6e', '#d8162a', '#7a0611'];
    var filo = oro ? '#fff3c4' : '#f2c75c';
    var svg = el('svg', { viewBox: '-40 -26 80 64', width: ancho, height: r1(ancho * .8), 'aria-hidden': 'true', focusable: 'false' });
    var d = el('defs', {}, svg);
    var g = el('linearGradient', { id: id, x1: '0', y1: '0', x2: '0', y2: '1' }, d);
    el('stop', { offset: '0', 'stop-color': c1[0] }, g);
    el('stop', { offset: '.45', 'stop-color': c1[1] }, g);
    el('stop', { offset: '1', 'stop-color': c1[2] }, g);
    var b = el('g', { stroke: filo, 'stroke-width': 1.3, 'stroke-linejoin': 'round', fill: 'url(#' + id + ')' }, svg);
    el('path', { d: 'M-2 2 C-8 14 -14 26 -20 36 L-11 33 L-7 40 C-2 28 2 16 2 4 Z' }, b);
    el('path', { d: 'M2 2 C8 14 14 26 20 36 L11 33 L7 40 C2 28 -2 16 -2 4 Z' }, b);
    el('path', { d: 'M0 0 C-12 -22 -38 -24 -36 -6 C-34 8 -12 8 0 0 Z' }, b);
    el('path', { d: 'M0 0 C12 -22 38 -24 36 -6 C34 8 12 8 0 0 Z' }, b);
    el('path', { d: 'M-8 -10 C-16 -16 -26 -17 -31 -12', fill: 'none', stroke: '#fff', 'stroke-width': 1.8, opacity: .5, 'stroke-linecap': 'round' }, b);
    el('path', { d: 'M8 -10 C16 -16 26 -17 31 -12', fill: 'none', stroke: '#fff', 'stroke-width': 1.8, opacity: .5, 'stroke-linecap': 'round' }, b);
    el('rect', { x: -6, y: -7, width: 12, height: 13, rx: 4 }, b);
    return svg;
  }

  // Caja de regalo 3D. o = { x, abajo, w, h, p, papel, cinta, lazo, giro, entra }
  function caja(padre, o) {
    var cae = span('nv-cae', padre, { left: o.x + 'px', bottom: o.abajo + 'px', '--entra': o.entra + 's',
      width: o.w + 'px', height: o.h + 'px' });
    var salto = span('nv-salto', cae, { '--ret': (-o.entra * 2.3).toFixed(2) + 's' });
    var cj = span('nv-caja', salto, { '--w': o.w + 'px', '--h': o.h + 'px', '--p': o.p + 'px',
      '--papel': o.papel, '--cinta': o.cinta, '--giro': (o.giro || 26) + 'deg' });
    ['frente', 'izq', 'der', 'tapa'].forEach(function (c) { span('nv-cara nv-' + c, cj); });
    var lz = span('nv-lazo', cj, { '--lw': o.lazo + 'px' });
    lz.appendChild(lazoSvg(o.cinta === '#e8b23e' ? 'oro' : 'rojo', o.lazo));
    saltos.push(salto);
    return cae;
  }

  // Bola de adorno apoyada (sin hilo) o colgando del árbol.
  function bolaSuelta(padre, x, y, d, tipo, entra, clase) {
    var b = span('nv-bola gn-' + tipo + (clase ? ' ' + clase : ''), padre,
      { left: x + 'px', top: y + 'px', '--d': d + 'px', '--hilo': '0px', '--entra': entra + 's', '--brilla': (2.5 + entra) + 's' });
    b.innerHTML = '<span class="gn-tapa"></span><span class="gn-esfera"></span>';
    return b;
  }

  function lienzo(cont, ancho, alto, origen) {
    var lz = span('nv-lienzo', cont);
    lz.style.width = ancho + 'px';
    lz.style.height = alto + 'px';
    lz.style.transformOrigin = origen;
    function escalar() { lz.style.transform = 'scale(' + (cont.clientWidth / ancho).toFixed(4) + ')'; }
    escalar();
    if (window.ResizeObserver) new ResizeObserver(escalar).observe(cont);
    return lz;
  }

  function nieveMonton(svg, puntos, rnd) {
    var g = el('g', {}, svg);
    var d = el('defs', {}, svg), id = 'nvn' + (nGrad++);
    var gr = el('linearGradient', { id: id, x1: '0', y1: '0', x2: '0', y2: '1' }, d);
    el('stop', { offset: '0', 'stop-color': '#ffffff' }, gr);
    el('stop', { offset: '.6', 'stop-color': '#eef5fb' }, gr);
    el('stop', { offset: '1', 'stop-color': '#c9dcea' }, gr);
    puntos.forEach(function (p) {
      el('ellipse', { cx: p[0], cy: p[1], rx: p[2], ry: p[3], fill: 'url(#' + id + ')' }, g);
    });
    // Brillitos de escarcha
    for (var k = 0; k < 26; k++) {
      var q = puntos[k % puntos.length];
      el('circle', { cx: r1(q[0] + (rnd() - .5) * q[2] * 1.4), cy: r1(q[1] - q[3] * .5 + rnd() * q[3] * .6),
        r: r1(.5 + rnd() * .7), fill: '#fff', class: 'nv-escarcha', style: '--ret:' + (-rnd() * 3).toFixed(2) + 's' }, g);
    }
    return g;
  }

  // ── Regalos con ramas y nieve (esquina inferior izquierda de «Casos pendientes») ──────────
  function dibujarRegalos(cont) {
    var W = 230, H = 150, rnd = azar(77), T = 0.3;     // T: inicio de la entrada
    var lz = lienzo(cont, W, H, '0 100%');
    var id = 'nvr-';
    var atras = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'nv-capa', 'aria-hidden': 'true' });
    defs(atras, id);
    lz.appendChild(atras);
    // Ramas: una sube por el borde izquierdo, otra corre por abajo hacia la derecha y una corta.
    [[{ x: 6, y: 150 }, { x: -4, y: 70 }, { x: 34, y: 6 }, 11, 0],
     [{ x: 0, y: 140 }, { x: 120, y: 112 }, { x: 228, y: 128 }, 10, .5],
     [{ x: 14, y: 110 }, { x: 40, y: 60 }, { x: 84, y: 46 }, 8, .9]].forEach(function (r) {
      var g = el('g', { class: 'nv-crece', style: '--entra:' + (T + r[4]).toFixed(2) + 's' }, atras);
      var cam = caminoCurva(bezier(r[0], r[1], r[2]), 30);
      ramas(g, cam, rnd, { grosor: r[3], alma: r[3], paso: 2 });
      bayas(g, cam, rnd, id);
    });
    // Cajas (de atrás hacia delante) y bolas en la nieve.
    caja(lz, { x: 44, abajo: 16, w: 66, h: 52, p: 46, papel: '#d5172a', cinta: '#e8b23e', lazo: 54, giro: 24, entra: T + 1.2 });
    caja(lz, { x: 120, abajo: 12, w: 46, h: 34, p: 34, papel: '#c8102e', cinta: '#e8b23e', lazo: 40, giro: -22, entra: T + 1.7 });
    caja(lz, { x: 168, abajo: 8, w: 30, h: 22, p: 26, papel: '#e8b23e', cinta: '#c8102e', lazo: 28, giro: 30, entra: T + 2.1 });
    bolaSuelta(lz, 104, 112, 30, 'roja', T + 2.4, 'nv-rueda');
    bolaSuelta(lz, 32, 118, 20, 'dorada', T + 2.6, 'nv-rueda');
    bolaSuelta(lz, 184, 124, 16, 'dorada', T + 2.8, 'nv-rueda');
    // Nieve por delante: las cajas quedan hundidas en ella.
    var frente = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'nv-capa nv-nieve', 'aria-hidden': 'true',
      style: '--entra:' + (T + .9).toFixed(2) + 's' });
    lz.appendChild(frente);
    nieveMonton(frente, [[20, 150, 34, 14], [70, 152, 40, 13], [120, 150, 36, 11], [165, 152, 38, 10], [205, 153, 30, 8]], rnd);
    // Destellos sueltos
    for (var k = 0; k < 7; k++) {
      span('gn-luz nv-chispa', lz, { left: r1(20 + rnd() * 180) + 'px', top: r1(30 + rnd() * 90) + 'px',
        '--entra': (T + 2.8 + k * .15).toFixed(2) + 's', '--tit': (1.4 + rnd() * 2).toFixed(2) + 's' });
    }
  }

  // ── Árbol de Navidad (esquina inferior derecha del calendario) ────────────────────────────
  function dibujarArbol(cont) {
    var W = 200, H = 240, cx = 100, rnd = azar(13), T = 0.3;
    var arriba = 34, base = 196;
    function radio(y) { return 8 + (y - arriba) / (base - arriba) * 84; }
    var lz = lienzo(cont, W, H, '100% 100%');
    var id = 'nva-';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'nv-capa', 'aria-hidden': 'true' });
    defs(svg, id);
    var d = el('defs', {}, svg);
    var sombra = el('linearGradient', { id: id + 'luz', x1: '0', y1: '0', x2: '1', y2: '0' }, d);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': .16 }, sombra);
    el('stop', { offset: '.45', 'stop-color': '#fff', 'stop-opacity': 0 }, sombra);
    el('stop', { offset: '1', 'stop-color': '#001a08', 'stop-opacity': .38 }, sombra);
    lz.appendChild(svg);
    // Tronco
    el('rect', { x: cx - 9, y: base - 4, width: 18, height: 22, rx: 3, fill: '#5a3418' }, svg);
    el('rect', { x: cx - 9, y: base - 4, width: 7, height: 22, rx: 3, fill: '#7a4a24' }, svg);
    // Pisos de ramas, de abajo hacia arriba en el dibujo (el de arriba tapa al de abajo) pero
    // la entrada va de arriba hacia abajo.
    var cortes = [arriba, 64, 94, 126, 160, base];
    for (var t = cortes.length - 2; t >= 0; t--) {
      var yt = cortes[t] - (t ? 10 : 6), yb = cortes[t + 1], R = radio(yb) + 4;
      var piso = el('g', { class: 'nv-piso', style: '--entra:' + (T + t * .45).toFixed(2) + 's' }, svg);
      var atrasG = el('g', {}, piso), frenteG = el('g', {}, piso);
      var n = 6 + t * 2, ramasPiso = [];
      for (var k = 0; k <= n; k++) {
        var phi = -Math.PI / 2 + k / n * Math.PI + (rnd() - .5) * .15;
        ramasPiso.push({ phi: phi, delante: true });
        if (k % 2) ramasPiso.push({ phi: phi + .2, delante: false });
      }
      ramasPiso.sort(function (a, b) { return (a.delante - b.delante) || (Math.abs(Math.sin(b.phi)) - Math.abs(Math.sin(a.phi))); });
      ramasPiso.forEach(function (rm) {
        var sx = Math.sin(rm.phi), cz = Math.cos(rm.phi);
        var fin = { x: cx + R * sx, y: yb + (rm.delante ? 5 * cz : -3 * cz) };
        var ini = { x: cx + R * .12 * sx, y: yt };
        var ctl = { x: cx + R * .7 * sx, y: yt + (yb - yt) * .25 };
        ramas(rm.delante ? frenteG : atrasG, caminoCurva(bezier(ini, ctl, fin), 18), rnd,
          { grosor: 7 + t * .8, alma: 6 + t, paso: 2.2, atras: !rm.delante });
      });
      // Luz de arriba a la izquierda y sombra a la derecha sobre el piso.
      el('path', { d: 'M' + cx + ' ' + yt + 'L' + (cx + R) + ' ' + (yb + 3) + 'Q' + cx + ' ' + (yb + 10) + ' ' + (cx - R) + ' ' + (yb + 3) + 'Z',
        fill: 'url(#' + id + 'luz)', style: 'mix-blend-mode:multiply' }, piso);
    }
    // Espiral de oropel con luces alrededor del árbol (solo se ve la parte de delante).
    var oro = [], luces = [], vueltas = 3.3;
    for (var i = 0; i <= 260; i++) {
      var u = i / 260, y = arriba + 14 + u * (base - arriba - 22), ang = u * vueltas * Math.PI * 2;
      var rr = radio(y) * .9, x = cx + rr * Math.sin(ang), y2 = y + 6 * Math.cos(ang);
      var delante = Math.cos(ang) > -.05;
      oro.push({ x: x, y: y2, delante: delante, u: u });
      if (delante && i % 9 === 0) luces.push({ x: x, y: y2, u: u });
    }
    var dOro = '', abierto = false;
    oro.forEach(function (p) {
      if (p.delante) { dOro += (abierto ? 'L' : 'M') + r1(p.x) + ' ' + r1(p.y); abierto = true; }
      else abierto = false;
    });
    el('path', { d: dOro, fill: 'none', stroke: '#f4cf63', 'stroke-width': 1.6, 'stroke-linecap': 'round',
      class: 'nv-oropel', pathLength: 1, style: '--entra:' + (T + 2.4) + 's' }, svg);
    luces.forEach(function (p) {
      span('gn-luz nv-luz-arbol gn-luz-' + ['calida', 'dorada', 'roja'][Math.round(p.u * 40) % 3], lz,
        { left: r1(p.x) + 'px', top: r1(p.y) + 'px', '--entra': (T + 2.4 + p.u * 1.4).toFixed(2) + 's', '--ola': (-p.u * 2.4).toFixed(2) + 's' });
    });
    // Moños en el árbol
    [[78, 86, 20], [124, 120, 22], [86, 158, 22]].forEach(function (m, k) {
      var c = span('nv-mono-arbol', lz, { left: m[0] + 'px', top: m[1] + 'px', '--entra': (T + 3 + k * .2).toFixed(2) + 's' });
      c.appendChild(lazoSvg('rojo', m[2]));
    });
    // Bolas colgando de las puntas (se empujan con el mouse)
    var colg = [[100, 60, 11, 'roja'], [72, 100, 13, 'dorada'], [128, 96, 12, 'roja'], [104, 112, 12, 'dorada'],
      [58, 136, 14, 'roja'], [142, 140, 13, 'dorada'], [100, 146, 13, 'roja'], [48, 172, 14, 'dorada'],
      [150, 172, 14, 'roja'], [118, 178, 12, 'dorada']];
    var lista = [];
    colg.forEach(function (b, k) {
      var entra = T + .4 + ((b[1] - arriba) / (base - arriba)) * 2.2;
      var c = span('gn-colgante gn-' + b[3], lz, { left: b[0] + 'px', top: b[1] + 'px', '--hilo': '4px', '--d': b[2] + 'px',
        '--dur': (2.8 + (k % 3) * .5) + 's', '--ret': (-k * .7) + 's', '--entra': entra.toFixed(2) + 's', '--brilla': (3 + k * .8) + 's' });
      c.innerHTML = '<span class="gn-golpe"><span class="gn-entra"><span class="gn-hilo"></span>' +
        '<span class="gn-tapa"></span><span class="gn-esfera"></span></span></span>';
      lista.push({ golpe: c.firstChild, x: b[0], y: b[1], hilo: 4, d: b[2], ang: 0, vel: 0, cont: lz });
    });
    // Estrella dorada que gira sobre su eje (3D) con un halo que respira.
    var est = span('nv-estrella', lz, { left: cx + 'px', top: '20px', '--entra': (T + 2.9) + 's' });
    span('nv-halo', est);
    var giro = span('nv-estrella-giro', est);
    var se = el('svg', { viewBox: '-20 -20 40 40', width: 36, height: 36, 'aria-hidden': 'true' });
    var pts = [];
    for (var q = 0; q < 10; q++) {
      var a = -Math.PI / 2 + q * Math.PI / 5, rq = q % 2 ? 7.5 : 18;
      pts.push([r1(rq * Math.cos(a)), r1(rq * Math.sin(a))]);
    }
    for (q = 0; q < 10; q++) {           // cada punta en dos caras: una con luz y otra en sombra
      var p1 = pts[q], p2 = pts[(q + 1) % 10];
      el('path', { d: 'M0 0L' + p1[0] + ' ' + p1[1] + 'L' + p2[0] + ' ' + p2[1] + 'Z',
        fill: q % 2 ? '#e9a91f' : '#ffe27a', stroke: '#c98a12', 'stroke-width': .4 }, se);
    }
    giro.appendChild(se);
    // Regalos al pie del árbol
    caja(lz, { x: 30, abajo: 6, w: 40, h: 30, p: 30, papel: '#f4f1ec', cinta: '#c8102e', lazo: 34, giro: 28, entra: T + 3.2 });
    caja(lz, { x: 78, abajo: 2, w: 48, h: 34, p: 34, papel: '#d5172a', cinta: '#e8b23e', lazo: 42, giro: -18, entra: T + 3.5 });
    caja(lz, { x: 134, abajo: 4, w: 38, h: 28, p: 30, papel: '#e8b23e', cinta: '#c8102e', lazo: 32, giro: 26, entra: T + 3.8 });
    return lista;
  }

  // Con la pestaña angosta (≤1180px) Promociones baja al final de la cuadrícula; la guirnalda
  // derecha se pasa a la esquina superior derecha del saludo para que siga arriba.
  function reubicarDerecha() {
    var gn = document.querySelector('[data-guirnalda="der"]');
    var promo = gn && gn.parentNode;
    var hero = document.getElementById('in-hero');
    if (!gn || !hero || !window.matchMedia) return;
    var mq = window.matchMedia('(max-width:1180px)');
    function ubicar() {
      var destino = mq.matches ? hero : promo;
      if (gn.parentNode !== destino) destino.appendChild(gn);
    }
    ubicar();
    if (mq.addEventListener) mq.addEventListener('change', ubicar);
    else if (mq.addListener) mq.addListener(ubicar);
  }

  // ── Tarjetas de las demás páginas ───────────────────────────────────────────────────────
  // En páginas sin guirnaldas propias (todas menos Inicio): la tarjeta de título (la
  // primera bajo el menú) lleva las dos guirnaldas en pequeño y las demás tarjetas grandes
  // una ramita de acebo fija en una esquina, alternando el lado. Las tarjetas se pintan a
  // veces después de cargar los datos, así que se repasa unas veces (sin repetir ninguna).
  var CLAVE_TARJETAS = 'crm_gn_paginas_animadas';
  var simboloAcebo = false;

  function crearSimboloAcebo() {
    if (simboloAcebo) return;
    simboloAcebo = true;
    var svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false',
      style: 'position:absolute;width:0;height:0;overflow:hidden' });
    defs(svg, 'nva-');
    var bg = el('radialGradient', { id: 'nva-bola', cx: '35%', cy: '30%', r: '75%' }, svg.firstChild);
    el('stop', { offset: '0', 'stop-color': '#fff' }, bg);
    el('stop', { offset: '.12', 'stop-color': '#ff8a80' }, bg);
    el('stop', { offset: '.5', 'stop-color': '#d7121f' }, bg);
    el('stop', { offset: '1', 'stop-color': '#4a0006' }, bg);
    var bo = el('radialGradient', { id: 'nva-oro', cx: '35%', cy: '30%', r: '75%' }, svg.firstChild);
    el('stop', { offset: '0', 'stop-color': '#fffbe6' }, bo);
    el('stop', { offset: '.15', 'stop-color': '#fbe39a' }, bo);
    el('stop', { offset: '.55', 'stop-color': '#d6a23a' }, bo);
    el('stop', { offset: '1', 'stop-color': '#5a3a08' }, bo);
    var sim = el('symbol', { id: 'nv-acebo-sim', viewBox: '0 0 46 46', overflow: 'visible' }, svg);
    // Bola roja colgando de la ramita (por detrás de las hojas).
    el('path', { d: 'M17 16 L21 34', stroke: '#c9a24a', 'stroke-width': .8 }, sim);
    el('rect', { x: 18.6, y: 33, width: 5, height: 3.2, rx: .8, fill: '#d9b257', transform: 'rotate(-13 21 34)' }, sim);
    el('circle', { cx: 22.4, cy: 42, r: 7.4, fill: 'url(#nva-bola)' }, sim);
    el('path', { d: 'M16.5 41 q6 3 12 -1', stroke: '#f2c75c', 'stroke-width': .8, fill: 'none', opacity: .8 }, sim);
    // Mechón de pino: agujas que salen de la esquina.
    var rnd = azar(91), agujas = '';
    for (var i = 0; i < 26; i++) {
      var a = (-.15 + rnd() * 1.85), l = 13 + rnd() * 11, x0 = 6 + rnd() * 4, y0 = 6 + rnd() * 4;
      agujas += 'M' + r1(x0) + ' ' + r1(y0) + 'l' + r1(Math.cos(a) * l) + ' ' + r1(Math.sin(a) * l);
    }
    el('path', { d: agujas, stroke: '#1d6b33', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, sim);
    el('path', { d: agujas, stroke: '#4caf5c', 'stroke-width': .7, 'stroke-linecap': 'round',
      transform: 'translate(-.6 -.6)', opacity: .8 }, sim);
    // Dos hojas de acebo.
    var hoja = 'M0 0 l4 -3 l1 3.5 l4 -2.5 l0.5 3.5 l4.5 -1.5 l-1 3.5 l4 0.5 l-3 3 ' +
               'l-4 -0.5 l1 3 l-4.5 -1.5 l-0.5 3.5 l-4 -2.5 l-1 3.5 l-4 -3 Z';
    [[12, 13, 18], [13, 15, 72]].forEach(function (h) {
      var g = el('g', { transform: 'translate(' + h[0] + ' ' + h[1] + ') rotate(' + h[2] + ') scale(1.05)' }, sim);
      el('path', { d: hoja, fill: 'url(#nva-acebo)', stroke: '#0b3a1c', 'stroke-width': .6, 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M1 1.5 L22 2', stroke: '#9fd49a', 'stroke-width': .7, opacity: .8 }, g);
    });
    // Tres bayas con brillo.
    [[13, 12, 3.6], [18.5, 11, 3.2], [15, 17, 3.3]].forEach(function (b) {
      el('circle', { cx: b[0], cy: b[1], r: b[2], fill: 'url(#nva-baya)', stroke: '#5a0008', 'stroke-width': .4 }, sim);
      el('circle', { cx: b[0] - b[2] * .35, cy: b[1] - b[2] * .4, r: b[2] * .28, fill: '#fff', opacity: .75 }, sim);
    });
    document.body.appendChild(svg);
  }

  // Tira de guirnalda para el borde de arriba de las tarjetas: un azulejo de 160×30 que se
  // repite a lo ancho (imagen de fondo: no añade nodos ni anima nada). Las agujas que
  // salen por un lado se dibujan también por el otro para que no se note la costura.
  var TIRA_W = 160, TIRA_H = 30, tiraUrl = '';
  function urlTira() {
    if (tiraUrl) return tiraUrl;
    var W = TIRA_W, H = TIRA_H, cy = 10, rnd = azar(57);
    var svg = el('svg', { xmlns: NS, viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    defs(svg, 'nvt-');
    var d = el('defs', {}, svg);
    [['nvt-roja', '#ff8a80', '#d7121f', '#4a0006'], ['nvt-oro', '#fbe39a', '#d6a23a', '#5a3a08']].forEach(function (g) {
      var rg = el('radialGradient', { id: g[0], cx: '35%', cy: '30%', r: '75%' }, d);
      el('stop', { offset: '0', 'stop-color': '#fff' }, rg);
      el('stop', { offset: '.14', 'stop-color': g[1] }, rg);
      el('stop', { offset: '.55', 'stop-color': g[2] }, rg);
      el('stop', { offset: '1', 'stop-color': g[3] }, rg);
    });
    var capas = [['#0e4421', 2, 0], ['#1d6b33', 1.6, -.4], ['#3f9a4a', 1, -.9], ['#7cc47f', .6, -1.3]];
    var trazos = capas.map(function () { return ''; });
    for (var i = 0; i < 150; i++) {
      var x = rnd() * W, a = rnd() * Math.PI * 2, l = 6 + rnd() * 6, y = cy + (rnd() - .5) * 4;
      var dx = Math.cos(a) * l, dy = Math.sin(a) * l * .62;
      var k = i % capas.length;
      [-W, 0, W].forEach(function (o) {
        if (x + o + Math.abs(dx) < -2 || x + o - Math.abs(dx) > W + 2) return;
        trazos[k] += 'M' + r1(x + o) + ' ' + r1(y) + 'l' + r1(dx) + ' ' + r1(dy);
      });
    }
    capas.forEach(function (c, k) {
      el('path', { d: trazos[k], stroke: c[0], 'stroke-width': c[1], 'stroke-linecap': 'round',
        transform: 'translate(0 ' + c[2] + ')' }, svg);
    });
    // Nieve suave encima de la rama.
    for (var n = 0; n < 9; n++) {
      el('ellipse', { cx: r1(8 + n * 18 + rnd() * 6), cy: r1(cy - 4 + rnd() * 2), rx: r1(2.5 + rnd() * 2.5), ry: 1.3,
        fill: '#fff', opacity: .85 }, svg);
    }
    // Bayas y acebo.
    var hoja = 'M0 0 l4 -3 l1 3.5 l4 -2.5 l0.5 3.5 l4.5 -1.5 l-1 3.5 l4 0.5 l-3 3 ' +
               'l-4 -0.5 l1 3 l-4.5 -1.5 l-0.5 3.5 l-4 -2.5 l-1 3.5 l-4 -3 Z';
    [[34, 168], [114, 12]].forEach(function (h) {
      var g = el('g', { transform: 'translate(' + h[0] + ' ' + (cy + 1) + ') rotate(' + h[1] + ') scale(.7)' }, svg);
      el('path', { d: hoja, fill: 'url(#nvt-acebo)', stroke: '#0b3a1c', 'stroke-width': .7 }, g);
    });
    [[36, 9], [39.5, 11.5], [35, 13], [116, 9.5], [119, 12]].forEach(function (b) {
      el('circle', { cx: b[0], cy: b[1], r: 2.1, fill: 'url(#nvt-baya)', stroke: '#5a0008', 'stroke-width': .3 }, svg);
    });
    // Dos bolitas colgando y luces cálidas.
    [[70, 'nvt-roja', 5.2, 9], [146, 'nvt-oro', 4.4, 7]].forEach(function (b) {
      el('path', { d: 'M' + b[0] + ' ' + cy + 'v' + b[3], stroke: '#c9a24a', 'stroke-width': .7 }, svg);
      el('rect', { x: b[0] - 1.6, y: cy + b[3] - .5, width: 3.2, height: 2, rx: .5, fill: '#d9b257' }, svg);
      el('circle', { cx: b[0], cy: cy + b[3] + 1.5 + b[2], r: b[2], fill: 'url(#' + b[1] + ')' }, svg);
    });
    [[16, '#ffe9a8'], [54, '#ff9b8f'], [92, '#ffe9a8'], [132, '#fff3c4']].forEach(function (l) {
      el('circle', { cx: l[0], cy: cy + 1, r: 4.5, fill: l[1], opacity: .35 }, svg);
      el('circle', { cx: l[0], cy: cy + 1, r: 1.8, fill: '#fffdf2' }, svg);
    });
    tiraUrl = 'url("data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)) + '")';
    return tiraUrl;
  }

  function ponerTira(c, clase) {
    var t = document.createElement('span');
    t.className = 'nv-tira' + (clase ? ' ' + clase : '');
    t.setAttribute('aria-hidden', 'true');
    t.style.backgroundImage = urlTira();
    c.appendChild(t);
  }

  function tarjetasDeLaPagina() {
    var marco = document.querySelector('.in-marco-amplio');
    if (!marco) return [];
    return Array.prototype.filter.call(marco.querySelectorAll('.in-glass, .trf-card'), function (t) {
      if (t.closest('.in-head') || t.parentElement.closest('.in-glass, .trf-card')) return false;   // solo las de primer nivel
      if (t.closest('dialog, [role="dialog"], .modal, [hidden]')) return false;
      var r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function paginaYaAnimada() {
    var ruta = location.pathname;
    try {
      var lista = JSON.parse(localStorage.getItem(CLAVE_TARJETAS) || '[]');
      if (lista.indexOf(ruta) >= 0) return true;
      lista.push(ruta);
      localStorage.setItem(CLAVE_TARJETAS, JSON.stringify(lista.slice(-60)));
    } catch (_) {}
    return false;
  }

  var tituloHecho = false, nAcebo = 0;
  function decorarTarjetas() {
    if (document.querySelector('[data-guirnalda]:not(.gn-mini)')) return;   // Inicio ya tiene las suyas
    var tarjetas = tarjetasDeLaPagina();
    if (!tarjetas.length) return;
    // La tarjeta de título (la primera ancha arriba de la página): guirnaldas en sus dos
    // esquinas de arriba.
    var t = tituloHecho ? null : tarjetas.filter(function (c) {
      var q = c.getBoundingClientRect();
      return q.width >= 420 && q.height >= 44 && q.top + window.scrollY < 420;
    })[0];
    if (t) {
      {
        tituloHecho = true;
        t.classList.add('nv-anfitrion');
        var quieta = paginaYaAnimada();
        ['izq', 'der'].forEach(function (lado) {
          var g = document.createElement('div');
          g.className = 'gn gn-mini' + (quieta ? ' gn-quieta' : '');
          g.setAttribute('data-guirnalda', lado);
          g.setAttribute('aria-hidden', 'true');
          t.appendChild(g);
          dibujar(g, { mini: true }).forEach(function (b) { b.cont = g; bolas.push(b); });
        });
        ponerTira(t, 'nv-tira-titulo');
        t.setAttribute('data-nv', '1');
      }
    }
    // El resto: guirnalda en el borde de arriba de las tarjetas grandes y un adorno de acebo
    // con bola en una esquina (alternando el lado). Solo las que dejan ver fuera de su borde.
    tarjetas.forEach(function (c) {
      if (c.hasAttribute('data-nv')) return;
      var r = c.getBoundingClientRect();
      if (r.width < 160 || r.height < 90) return;
      if (getComputedStyle(c).overflow !== 'visible') { c.setAttribute('data-nv', '0'); return; }
      if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
      ponerTira(c, r.width < 300 ? 'nv-tira-chica' : '');
      // Las tarjetas chicas (cifras) solo llevan la guirnalda: el adorno taparía su icono.
      if (r.width < 220 || nAcebo >= 10) { c.setAttribute('data-nv', '1'); return; }
      crearSimboloAcebo();
      var lado = nAcebo % 2 ? 'der' : 'izq';
      var s = el('svg', { class: 'nv-acebo nv-acebo-' + lado, viewBox: '0 0 46 46', 'aria-hidden': 'true', focusable: 'false' });
      el('use', { href: '#nv-acebo-sim' }, s);
      // Pequeña variación de giro y tamaño para que no se vean calcadas.
      var giro = [-8, 6, -3, 10, 0][nAcebo % 5], tam = [1, .9, 1.08, .95][nAcebo % 4];
      s.style.rotate = giro + 'deg';
      s.style.scale = String(tam);
      c.appendChild(s);
      c.setAttribute('data-nv', '1');
      nAcebo++;
    });
  }

  function iniciar() {
    var nodos = document.querySelectorAll('[data-guirnalda]');
    for (var i = 0; i < nodos.length; i++) {
      if (nodos[i].firstChild) continue;
      var cont = nodos[i];
      dibujar(cont).forEach(function (b) { b.cont = cont; bolas.push(b); });
    }
    reubicarDerecha();
    iniciarBarra();
    document.querySelectorAll('[data-navidad]').forEach(function (cont) {
      if (cont.firstChild) return;
      if (cont.getAttribute('data-navidad') === 'arbol') dibujarArbol(cont).forEach(function (b) { bolas.push(b); });
      else dibujarRegalos(cont);
    });
    decorarTarjetas();
    // Las tarjetas que llegan con los datos se decoran al aparecer.
    [1200, 3500, 8000].forEach(function (ms) { setTimeout(decorarTarjetas, ms); });
    var ligero = document.documentElement.classList.contains('modo-ligero');
    if (!quieto && !ligero) {
      // Solo se escucha el mouse sobre las tarjetas que tienen guirnalda (y su entorno cercano).
      document.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'mouse') alMover(e);
      }, { passive: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
