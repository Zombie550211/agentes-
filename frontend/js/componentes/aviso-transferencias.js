/* aviso-transferencias.js — avisos de transferencias en todas las páginas del CRM.
 *
 * Llegan por el centro de notificaciones (canal personal de cada usuario) y se muestran
 * abajo a la derecha hasta que se cierran:
 *   - «transferencia_asignada»: al agente que le acaban de asignar una transferencia
 *     (routers/transferencias.py → crear). Suena un aviso y, con la pestaña en segundo
 *     plano y permiso del navegador, también sale una notificación del sistema.
 *   - «transferencias_libres»: a todo el departamento destino cuando transferencias suyas
 *     cumplen 24 h sin gestionar (bucle_liberadas) y se pueden tomar.
 */
(function () {
  'use strict';
  if (window.__avisoTransferencias || !window.CRMNotificaciones || window.PORTAL) return;
  window.__avisoTransferencias = true;

  // Quién soy (lo guarda el login): para distinguir «te asignaron» de «se asignó a otro»,
  // que es lo que ven los administradores (reciben todas por el canal rol:admin).
  function yo() {
    try {
      var u = JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || '{}');
      return String(u.username || '').trim().toLowerCase();
    } catch (e) { return ''; }
  }
  function esMia(agente) { return !agente || String(agente).trim().toLowerCase() === yo(); }
  var vistos = {};   // id de transferencia ya avisada (al admin-agente le llega por dos canales)

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function estilos() {
    if (document.getElementById('aviso-trf-css')) return;
    var st = document.createElement('style');
    st.id = 'aviso-trf-css';
    st.textContent =
      '.aviso-trf-pila{position:fixed;right:16px;bottom:16px;z-index:1500;display:flex;flex-direction:column;gap:10px;' +
        'width:min(360px,calc(100vw - 32px))}' +
      '.aviso-trf{position:relative;padding:16px;background:#fff;color:#0f172a;border:1px solid rgb(0 112 152 / .22);' +
        'box-shadow:0 12px 32px rgb(0 112 152 / .18);font:13px/1.45 Inter,system-ui,sans-serif}' +
      '.aviso-trf.nueva{border-left:4px solid #007098}' +
      '.aviso-trf h3{margin:0 28px 6px 0;font-size:14px;font-weight:600}' +
      '.aviso-trf p{margin:0 0 10px;color:#475569}' +
      '.aviso-trf p b{color:#0f172a}' +
      '.aviso-trf ul{margin:0 0 12px;padding-left:18px;color:#334155}' +
      '.aviso-trf a{display:inline-block;padding:7px 12px;background:#007098;color:#fff;text-decoration:none;font-weight:600}' +
      '.aviso-trf a:hover{background:#004e6b}' +
      '.aviso-trf a:focus-visible,.aviso-trf button:focus-visible{outline:2px solid #007098;outline-offset:2px}' +
      '.aviso-trf button{position:absolute;top:10px;right:10px;width:26px;height:26px;border:0;background:transparent;' +
        'font-size:18px;line-height:1;color:#64748b;cursor:pointer}' +
      '@media (prefers-reduced-motion:no-preference){.aviso-trf{animation:avisoTrf .25s ease-out}}' +
      '@keyframes avisoTrf{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}';
    document.head.appendChild(st);
  }

  function pila() {
    var p = document.querySelector('.aviso-trf-pila');
    if (!p) {
      p = document.createElement('div');
      p.className = 'aviso-trf-pila';
      p.setAttribute('aria-live', 'polite');
      document.body.appendChild(p);
    }
    return p;
  }

  function mostrar(clase, html) {
    estilos();
    var p = pila();
    var caja = document.createElement('div');
    caja.className = 'aviso-trf ' + clase;
    caja.setAttribute('role', 'status');
    caja.innerHTML = '<button type="button" aria-label="Cerrar aviso">×</button>' + html;
    caja.querySelector('button').addEventListener('click', function () { caja.remove(); });
    p.appendChild(caja);
    while (p.children.length > 3) p.firstElementChild.remove();
  }

  function pagina(seccion) {
    return '/' + (seccion === 'lineas' ? 'lineas' : 'residencial') + '/transferencia.html#trf-hist-title';
  }

  // Aviso sonoro: tres tonos cortos (sin archivo de audio). Los navegadores no dejan sonar
  // nada hasta que la persona interactúa con la página, así que el AudioContext se crea y se
  // «desbloquea» con el primer clic o tecla; desde ahí cualquier aviso suena al llegar.
  var audio = null;
  function contexto() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!audio) { try { audio = new C(); } catch (e) { return null; } }
    if (audio.state === 'suspended') { try { audio.resume(); } catch (e) { /* sigue bloqueado */ } }
    return audio;
  }
  ['pointerdown', 'keydown'].forEach(function (t) {
    document.addEventListener(t, function () { contexto(); }, { capture: true, passive: true });
  });
  var pendiente = false;   // llegó un aviso con el audio bloqueado: suena al primer clic
  // Los mismos tres tonos como WAV para un <audio>: el navegador lo deja sonar al llegar a la
  // página desde un clic en el mismo sitio, sin esperar a que se toque la página.
  var urlTonos = null;
  function wavTonos() {
    if (urlTonos) return urlTonos;
    var sr = 22050, n = Math.floor(sr * 0.62), d = new Float32Array(n);
    [784, 988, 1319].forEach(function (f, i) {
      var i0 = Math.floor((0.02 + i * 0.16) * sr);
      for (var k = 0; k < 0.24 * sr && i0 + k < n; k++) {
        var t = k / sr, a = t < 0.02 ? 0.35 * t / 0.02 : 0.35 * Math.pow(0.0001 / 0.35, (t - 0.02) / 0.2);
        d[i0 + k] += a * Math.sin(2 * Math.PI * f * t);
      }
    });
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function txt(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    urlTonos = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return urlTonos;
  }
  function sonar() {
    try {
      var a = new Audio(wavTonos());
      a.volume = 0.9;
      a.play().catch(function () { sonarContexto(); });
      return;
    } catch (e) { /* sin <audio>: AudioContext */ }
    sonarContexto();
  }
  function sonarContexto() {
    var ctx = contexto();
    if (!ctx || ctx.state !== 'running') {
      if (!pendiente) {
        pendiente = true;
        var luego = function () {
          document.removeEventListener('pointerdown', luego, true);
          document.removeEventListener('keydown', luego, true);
          pendiente = false;
          setTimeout(sonarContexto, 50);
        };
        document.addEventListener('pointerdown', luego, true);
        document.addEventListener('keydown', luego, true);
      }
      return;
    }
    try {
      var t0 = ctx.currentTime + 0.02;
      [784, 988, 1319].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.16;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + 0.24);
      });
    } catch (e) { /* sin audio */ }
  }


  // Hasta qué momento (UTC, «AAAA-MM-DD HH:MM:SS») ya se mostraron asignaciones en este navegador.
  var VISTO = 'crm_trf_asignadas_vistas';
  function ahoraUTC() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
  function leerVisto() { try { return localStorage.getItem(VISTO) || ''; } catch (e) { return ''; } }
  function marcarVisto(f) { try { if (f > leerVisto()) localStorage.setItem(VISTO, f); } catch (e) { /* sin storage */ } }

  function avisoAsignada(cliente, de, seccion, horas) {
    mostrar('nueva',
      '<h3>Te asignaron una transferencia</h3>' +
      '<p>Cliente: <b>' + esc(cliente) + '</b>' + (de ? '<br>La transfirió: ' + esc(de) : '') +
        '<br>Tienes ' + (horas || 24) + ' h para gestionarla.</p>' +
      '<a href="' + pagina(seccion) + '">Ver transferencia</a>');
  }

  // Al abrir cualquier página: las asignadas en la última hora que este navegador no mostró
  // (por ejemplo, si llegaron con la página cerrada o sin conexión en vivo).
  fetch('/api/notificaciones/status', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var hace1h = new Date(Date.now() - 3600e3).toISOString().replace('T', ' ').slice(0, 19);
      var visto = leerVisto();
      var nuevas = ((d && d.items) || []).filter(function (n) {
        var f = String(n.fecha).slice(0, 19);
        return n.old_status === 'TRANSFERENCIA' && esMia(n.agente) && f > hace1h && f > visto;
      });
      nuevas.slice(0, 3).reverse().forEach(function (n) { avisoAsignada(n.cliente, n.actor, n.seccion, 24); });
      if (nuevas.length) sonar();
      if (nuevas.length) marcarVisto(String(nuevas[0].fecha).slice(0, 19));
    })
    .catch(function () { /* la campana también las muestra */ });

  window.CRMNotificaciones.on('transferencia_asignada', function (ev) {
    if (ev.id && vistos[ev.id]) return;
    if (ev.id) vistos[ev.id] = true;
    var horas = ev.horas || 24;
    if (!esMia(ev.agente)) {   // administrador: aviso de una asignación a otro agente
      mostrar('',
        '<h3>Transferencia asignada</h3>' +
        '<p>Cliente: <b>' + esc(ev.cliente) + '</b><br>Asignada a: <b>' + esc(ev.agente) + '</b>' +
          (ev.de ? '<br>La transfirió: ' + esc(ev.de) : '') + '</p>' +
        '<a href="' + pagina(ev.seccion) + '">Ver transferencias</a>');
      sonar();
      return;
    }
    marcarVisto(ahoraUTC());
    avisoAsignada(ev.cliente, ev.de, ev.seccion, horas);
    sonar();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification('Te asignaron una transferencia', {
          body: (ev.cliente || '') + (ev.de ? ' · de ' + ev.de : ''), tag: 'trf-' + ev.id });
        n.onclick = function () { window.focus(); location.href = pagina(ev.seccion); n.close(); };
      } catch (e) { /* sin notificación del sistema */ }
    }
  });

  // Demostración (la usa transferencia-form.js con los administradores, una vez).
  window.CRMAvisoTransferencias = {
    demo: function () {
      mostrar('nueva',
        '<h3>Te asignaron una transferencia</h3>' +
        '<p><b>Ejemplo:</b> así llega el aviso al agente, con esta alerta sonora, en cualquier pantalla del CRM.' +
          '<br>Cliente: <b>CLIENTE DE EJEMPLO</b><br>Tienes 24 h para gestionarla.</p>');
      sonar();
    }
  };

  window.CRMNotificaciones.on('transferencias_libres', function (ev) {
    var depto = ev.seccion === 'lineas' ? 'Líneas' : 'Residencial';
    var n = ev.cantidad || 0;
    mostrar('',
      '<h3>' + n + (n === 1 ? ' transferencia quedó libre' : ' transferencias quedaron libres') + '</h3>' +
      '<p>Pasaron 24 h sin gestionarse. Cualquier agente de ' + depto + ' puede tomarlas.</p>' +
      (ev.clientes && ev.clientes.length
        ? '<ul>' + ev.clientes.slice(0, 5).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
      '<a href="' + pagina(ev.seccion) + '">Ver y tomar</a>');
  });
})();
