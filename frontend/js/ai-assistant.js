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
  var _busy = false;

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
          + '<button class="aiw-close" id="aiw-close-btn" aria-label="Cerrar">✕</button></div>'
        + '<div class="aiw-body" id="aiw-body"></div>'
        + '<div class="aiw-foot">'
          + '<textarea class="aiw-input" id="aiw-input" rows="1" placeholder="Preguntá algo, ej. ¿cuántas ventas hay este mes?"></textarea>'
          + '<button class="aiw-send" id="aiw-send-btn"><i class="fas fa-paper-plane"></i></button>'
        + '</div>'
      + '</div>';
    document.body.appendChild(root);

    var toggleBtn = document.getElementById('aiw-toggle-btn');
    var closeBtn  = document.getElementById('aiw-close-btn');
    var panel     = document.getElementById('aiw-panel');
    var input     = document.getElementById('aiw-input');
    var sendBtn   = document.getElementById('aiw-send-btn');

    toggleBtn.addEventListener('click', function () {
      panel.classList.toggle('aiw-open');
      if (panel.classList.contains('aiw-open')) input.focus();
    });
    closeBtn.addEventListener('click', function () { panel.classList.remove('aiw-open'); });

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

  function appendMsg(role, text) {
    var body = document.getElementById('aiw-body');
    var div = document.createElement('div');
    div.className = 'aiw-msg ' + (role === 'user' ? 'user' : role === 'error' ? 'err' : 'bot');
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
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
    consultar_ranking: 'Consultando ranking…',
    consultar_productividad_equipos: 'Consultando productividad de equipos…',
  };

  async function sendMessage(text) {
    _busy = true;
    document.getElementById('aiw-send-btn').disabled = true;
    appendMsg('user', text);
    setStatus('Pensando…');

    var answered = false;
    try {
      var res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: _history }),
      });
      if (!res || !res.body) throw new Error('sin respuesta');

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
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
            appendMsg('bot', payload.text);
            _history.push({ role: 'user', content: text });
            _history.push({ role: 'assistant', content: payload.text });
            if (_history.length > 20) _history = _history.slice(-20);
            answered = true;
          } else if (payload.type === 'error') {
            setStatus('');
            appendMsg('error', payload.message || 'El asistente no está disponible en este momento.');
            answered = true;
          }
        }
      }
      if (!answered) {
        setStatus('');
        appendMsg('error', 'El asistente no respondió. Probá de nuevo en un momento.');
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
