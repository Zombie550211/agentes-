/**
 * Asistente de IA del CRM — widget flotante (solo lectura, v1).
 *
 * Se auto-inyecta (botón + panel + CSS) igual que sidebar-static.js hace con el
 * toggle móvil, para no tener que tocar el HTML de cada página. Se carga vía
 * sidebar-static.js, que ya está incluido en todas las páginas autenticadas.
 *
 * Consume POST /api/ai/chat, que responde como stream SSE (no es un GET, así que no
 * se puede usar EventSource nativo: se lee el body con fetch + un ReadableStream).
 */
(function () {
  'use strict';

  if (document.getElementById('aiw-root')) return; // ya inyectado

  var _history = [];
  var _transcript = []; // todo lo mostrado en pantalla (incluye saludo/errores, no solo Q&A)
  var _busy = false;
  var _userFirstName = null; // cacheado, se pide una sola vez por carga de página
  // Si ya se mostró el saludo inicial en esta sesión. OJO: esto NO se puede inferir de
  // `_history.length===0` — un intercambio "solo saludo" (ver esSoloSaludo) responde sin
  // tocar _history a propósito (para no gastar una llamada al modelo por un "hola"), así
  // que si se usara _history como proxy, el saludo grande volvía a aparecer en la
  // PRÓXIMA pregunta real de la misma sesión (isFirst seguía dando true).
  var _greeted = false;

  /* Persistencia entre páginas: el widget se re-inyecta desde cero en cada carga (es
   * un sitio multi-página, no una SPA), así que sin esto el chat se "borraba" cada vez
   * que el agente navegaba a otra pantalla. sessionStorage sobrevive la navegación y
   * se limpia solo al cerrar la pestaña. */
  var STORAGE_KEY = 'aiw_chat_state';
  function saveState(isOpen) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        history: _history, transcript: _transcript, open: !!isOpen, greeted: _greeted,
      }));
    } catch (_) {}
  }
  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  /* Saludo instantáneo (sin pasar por el modelo — 0 latencia) en el primer mensaje de
   * la sesión: hora real del navegador del usuario + su nombre, mientras el pedido
   * lento (tools + IA) corre en paralelo. */
  async function getUserFirstName() {
    if (_userFirstName !== null) return _userFirstName;
    try {
      var r = await fetch('/api/auth/verify-server', { credentials: 'include' });
      if (r.ok) {
        var d = await r.json();
        var full = (d && d.user && d.user.name) || '';
        _userFirstName = full.trim().split(/\s+/)[0] || '';
        return _userFirstName;
      }
    } catch (_) {}
    _userFirstName = '';
    return _userFirstName;
  }
  function saludoSegunHora() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Buenos días';
    if (h >= 12 && h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  // Si el mensaje es SOLO un saludo (sin ninguna pregunta real), no tiene sentido
  // arrancar todo el circuito lento de IA+tools solo para que el modelo diga "¡Hola!" —
  // se responde al toque, sin pasar por el backend ni mostrar "Pensando…".
  var SOLO_SALUDO_RE = /^(holi+s?|hola+s?|hey+|hi+|hello|buen[ao]s?(\s*(d[ií]as|tardes|noches))?|qu[ée]\s*tal|saludos)[\s!.,¡¿?]*$/i;
  function esSoloSaludo(text) {
    return SOLO_SALUDO_RE.test(text.trim());
  }

  function injectStyles() {
    var css = ''
      + '#aiw-root{position:fixed;bottom:22px;right:22px;z-index:9999;font-family:inherit}'
      + '.aiw-toggle{width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;'
      + 'border:none;box-shadow:0 6px 18px rgba(37,99,235,.4);cursor:pointer;display:flex;'
      + 'align-items:center;justify-content:center;font-size:1.4rem;transition:transform .15s}'
      + '.aiw-toggle:hover{transform:scale(1.06)}'
      + '.aiw-panel{position:fixed;bottom:90px;right:22px;width:340px;max-width:calc(100vw - 32px);'
      + 'height:460px;max-height:calc(100vh - 120px);background:#ffffff;border-radius:16px;'
      + 'box-shadow:0 12px 40px rgba(15,23,42,.22);display:none;flex-direction:column;overflow:hidden;'
      + 'border:1px solid #e5e7eb}'
      + '.aiw-panel.aiw-open{display:flex}'
      + '.aiw-head{background:#2563eb;color:#fff;padding:14px 16px;font-weight:700;font-size:.86rem;'
      + 'display:flex;align-items:center;justify-content:space-between}'
      + '.aiw-head-sub{font-weight:400;font-size:.66rem;opacity:.85;margin-top:2px}'
      + '.aiw-close{background:none;border:none;color:#fff;cursor:pointer;font-size:1rem;opacity:.85}'
      + '.aiw-close:hover{opacity:1}'
      + '.aiw-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;'
      + 'background:#f8fafc}'
      + '.aiw-msg{max-width:85%;padding:8px 12px;border-radius:12px;font-size:.78rem;line-height:1.45;'
      + 'white-space:pre-wrap;word-break:break-word}'
      + '.aiw-msg.user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:3px}'
      + '.aiw-msg.bot{align-self:flex-start;background:#eef2ff;color:#1e293b;border-bottom-left-radius:3px}'
      + '.aiw-msg.err{align-self:flex-start;background:#fee2e2;color:#991b1b;border-bottom-left-radius:3px}'
      + '.aiw-status{align-self:flex-start;font-size:.68rem;color:#64748b;font-style:italic;padding:2px 4px}'
      + '.aiw-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}'
      + '.aiw-input{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:.78rem;'
      + 'font-family:inherit;resize:none;outline:none}'
      + '.aiw-input:focus{border-color:#2563eb}'
      + '.aiw-send{background:#2563eb;color:#fff;border:none;border-radius:10px;padding:0 14px;'
      + 'cursor:pointer;font-size:.8rem}'
      + '.aiw-send:disabled{opacity:.5;cursor:not-allowed}'
      + '@media (max-width:480px){.aiw-panel{right:12px;bottom:86px;width:calc(100vw - 24px)}'
      + '#aiw-root{right:12px;bottom:14px}}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectDom() {
    var root = document.createElement('div');
    root.id = 'aiw-root';
    root.innerHTML = ''
      + '<button class="aiw-toggle" id="aiw-toggle-btn" title="Asistente del CRM" aria-label="Abrir asistente">'
      + '<i class="fas fa-robot"></i></button>'
      + '<div class="aiw-panel" id="aiw-panel">'
        + '<div class="aiw-head"><div><div>Asistente del CRM</div>'
          + '<div class="aiw-head-sub">Responde solo con datos que ya podés ver</div></div>'
          + '<div style="display:flex;align-items:center;gap:10px">'
            + '<button class="aiw-close" id="aiw-clear-btn" title="Borrar conversación" aria-label="Borrar conversación"><i class="fas fa-trash"></i></button>'
            + '<button class="aiw-close" id="aiw-close-btn" aria-label="Cerrar">✕</button>'
          + '</div></div>'
        + '<div class="aiw-body" id="aiw-body"></div>'
        + '<div class="aiw-foot">'
          + '<textarea class="aiw-input" id="aiw-input" rows="1" placeholder="Preguntá algo, ej. ¿cuántas ventas hay este mes?"></textarea>'
          + '<button class="aiw-send" id="aiw-send-btn"><i class="fas fa-paper-plane"></i></button>'
        + '</div>'
      + '</div>';
    document.body.appendChild(root);

    var toggleBtn = document.getElementById('aiw-toggle-btn');
    var closeBtn  = document.getElementById('aiw-close-btn');
    var clearBtn  = document.getElementById('aiw-clear-btn');
    var panel     = document.getElementById('aiw-panel');
    var input     = document.getElementById('aiw-input');
    var sendBtn   = document.getElementById('aiw-send-btn');

    toggleBtn.addEventListener('click', function () {
      panel.classList.toggle('aiw-open');
      if (panel.classList.contains('aiw-open')) input.focus();
      saveState(isPanelOpen());
    });
    closeBtn.addEventListener('click', function () {
      panel.classList.remove('aiw-open');
      saveState(false);
    });
    clearBtn.addEventListener('click', function () {
      _history = [];
      _transcript = [];
      _greeted = false;
      document.getElementById('aiw-body').innerHTML = '';
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
    });

    // Restaurar conversación previa (si el agente venía de otra página, no de recién
    // abrir el CRM): repinta cada burbuja guardada y reabre el panel si estaba abierto.
    var saved = loadState();
    if (saved) {
      _history = Array.isArray(saved.history) ? saved.history : [];
      (saved.transcript || []).forEach(function (m) { renderMsg(m.role, m.text); });
      _transcript = saved.transcript || [];
      _greeted = !!saved.greeted;
      if (saved.open) panel.classList.add('aiw-open');
    }

    function send() {
      var text = input.value.trim();
      if (!text || _busy) return;
      input.value = '';
      sendMessage(text);
    }
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  function renderMsg(role, text) {
    var body = document.getElementById('aiw-body');
    var div = document.createElement('div');
    div.className = 'aiw-msg ' + (role === 'user' ? 'user' : role === 'error' ? 'err' : 'bot');
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }
  function appendMsg(role, text) {
    var div = renderMsg(role, text);
    _transcript.push({ role: role, text: text });
    saveState(isPanelOpen());
    return div;
  }
  function isPanelOpen() {
    var panel = document.getElementById('aiw-panel');
    return !!(panel && panel.classList.contains('aiw-open'));
  }

  function setStatus(text) {
    var body = document.getElementById('aiw-body');
    var el = document.getElementById('aiw-status-line');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'aiw-status-line';
      el.className = 'aiw-status';
      body.appendChild(el);
    }
    el.textContent = text;
    body.scrollTop = body.scrollHeight;
  }

  var TOOL_LABELS = {
    consultar_leads: 'Consultando leads/ventas…',
    consultar_mis_ventas: 'Consultando tus ventas…',
    consultar_ranking: 'Consultando ranking…',
    consultar_productividad_equipos: 'Consultando productividad de equipos…',
    consultar_empleado_del_mes: 'Consultando empleado del mes…',
    consultar_premios_activos: 'Consultando premios/promociones…',
    consultar_permisos_activos: 'Consultando permisos activos…',
    consultar_facturacion: 'Consultando facturación…',
    consultar_comisiones: 'Consultando comisiones…',
  };

  /* Un intento de pedir la respuesta. Devuelve {done, retryText}:
   *  - done=true  → ya se mostró la respuesta final en pantalla, no hay que hacer nada más.
   *  - done=false → no se resolvió (stream cortado sin avisar, o un error que puede ser
   *    transitorio como el timeout del túnel gratuito ~100s). retryText trae el mensaje
   *    a mostrar SI el reintento también falla — no se pinta nada todavía, para poder
   *    reintentar en silencio primero. */
  async function attemptChat(text) {
    var res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: _history }),
    });
    if (!res) return { done: false, retryText: null };
    if (!res.ok) {
      // Un error HTTP real (401/403/500/etc.) NO es lo mismo que "se cortó el stream":
      // hay que mostrarlo tal cual, no reintentar a ciegas.
      var detail = '';
      try {
        var body = await res.text();
        try { detail = (JSON.parse(body).detail) || body; } catch (_) { detail = body; }
      } catch (_) {}
      appendMsg('error', 'Error del asistente (' + res.status + ')' + (detail ? ': ' + String(detail).slice(0, 200) : '.'));
      return { done: true, retryText: null };
    }
    if (!res.body) return { done: false, retryText: null };

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var result = { done: false, retryText: null };
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim();
        if (!line.startsWith('data:')) continue;
        var payload;
        try { payload = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
        if (payload.type === 'tool_start') {
          setStatus(TOOL_LABELS[payload.tool] || ('Consultando ' + payload.tool + '…'));
        } else if (payload.type === 'tool_end') {
          setStatus('Pensando…');
        } else if (payload.type === 'answer') {
          setStatus('');
          _history.push({ role: 'user', content: text });
          _history.push({ role: 'assistant', content: payload.text });
          if (_history.length > 20) _history = _history.slice(-20);
          appendMsg('bot', payload.text); // guarda el estado ya con el turno completo
          result = { done: true, retryText: null };
        } else if (payload.type === 'error') {
          // Errores del backend (gateway/túnel caído, timeout, etc.) suelen ser
          // transitorios — no se muestran todavía, se reintenta en silencio una vez
          // y solo se pintan si el reintento también falla.
          setStatus('');
          result = { done: false, retryText: payload.message || 'El asistente no está disponible en este momento.' };
        }
      }
    }
    return result;
  }

  async function sendMessage(text) {
    _busy = true;
    document.getElementById('aiw-send-btn').disabled = true;
    appendMsg('user', text);

    try {
      var isFirst = !_greeted;
      var soloSaludo = esSoloSaludo(text);

      if (isFirst) {
        _greeted = true;
        var nombre = await getUserFirstName();
        var saludo = saludoSegunHora() + (nombre ? ', ' + nombre : '');
        if (soloSaludo) {
          // Nada más que un saludo: no tiene sentido gastar 30-100s de IA para que
          // diga "¡Hola!" — se responde al toque, sin tocar el backend.
          appendMsg('bot', saludo + '. ¿En qué te puedo ayudar?');
          return;
        }
        appendMsg('bot', saludo + '. Con gusto te ayudo, dame unos segundos…');
      } else if (soloSaludo) {
        appendMsg('bot', '¡Hola de nuevo! ¿En qué más te puedo ayudar?');
        return;
      }

      setStatus('Pensando…');
      var r = await attemptChat(text);
      if (!r.done) {
        // No se resolvió (stream cortado, o un error que puede ser transitorio como el
        // timeout del túnel gratuito). Reintenta una vez en silencio antes de rendirse.
        setStatus('Casi listo, un momento más…');
        r = await attemptChat(text);
      }
      if (!r.done) {
        setStatus('');
        appendMsg('error', r.retryText || 'El asistente no respondió. Probá de nuevo en un momento.');
      }
    } catch (e) {
      setStatus('');
      appendMsg('error', 'No se pudo conectar con el asistente.');
    } finally {
      _busy = false;
      document.getElementById('aiw-send-btn').disabled = false;
    }
  }

  function init() {
    injectStyles();
    injectDom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
