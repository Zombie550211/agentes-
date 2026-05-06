/* chat-page.js — CRM Chat en tiempo real */
(function () {
  'use strict';

  /* ── Estado ── */
  let socket = null;
  let currentUser = null;
  let activePeer = null;       // { username, name, avatarUrl }
  let allUsers = [];
  let conversations = [];
  let toRecipients = [];       // destinatarios del modal redactar
  let typingTimer = null;
  let currentCat = 'chats';
  let notifPanelOpen = false;
  let notifTab = 'all';

  /* ── Helpers ── */
  const $ = id => document.getElementById(id);
  const token = () => sessionStorage.getItem('token') || localStorage.getItem('token');
  const authHeader = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

  function initials(name = '') {
    return name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase() || '?';
  }

  // Para listas de conversaciones: muestra "Ayer" o fecha corta
  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
  }

  // Para bubbles del chat: siempre muestra HH:MM (+ fecha si es de otro día)
  function formatBubbleTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return time;
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + time;
  }

  function avatarEl(name, url, size = 38) {
    const div = document.createElement('div');
    div.className = 'chat-avatar';
    div.style.cssText = `width:${size}px;height:${size}px;font-size:${size*.35}px;`;
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = name;
      img.onerror = () => { img.remove(); div.textContent = initials(name); };
      div.appendChild(img);
    } else {
      div.textContent = initials(name);
    }
    return div;
  }

  function showToast(msg, dur = 2500) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
  }

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, { headers: authHeader(), ...opts });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ── Inicialización ── */
  async function init() {
    const raw = sessionStorage.getItem('user') || localStorage.getItem('user');
    if (!raw) { window.location.replace('/login.html'); return; }
    currentUser = JSON.parse(raw);

    await loadUsers();
    await loadConversations();
    await loadUnreadCount();
    renderChatList();
    initSocket();
    bindEvents();
  }

  /* ── Socket.io ── */
  function initSocket() {
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('register', {
        username: currentUser.username,
        role: currentUser.role,
        agenteId: currentUser.id
      });
    });

    socket.on('chat:message', msg => {
      // Actualizar conversación activa si coincide
      if (activePeer && (msg.from === activePeer.username || msg.to === activePeer.username)) {
        // No re-agregar mensajes propios (ya se hizo el append optimista)
        if (msg.from !== currentUser.username) {
          appendMessage(msg);
          scrollToBottom();
        }
        // Marcar como leído si somos el destinatario
        if (msg.to === currentUser.username) {
          apiFetch(`/api/chat/messages/${msg._id}/read`, { method: 'PATCH' }).catch(() => {});
        }
      } else if (msg.to === currentUser.username) {
        // Notificación de nuevo mensaje (conversación no activa)
        loadUnreadCount();
        showToast(`Nuevo mensaje de ${msg.fromName}`);
        addNotifItem(msg);
        // Tarjeta de notificación CRM global
        if (window.showCRMNotif) {
          const tipo = msg.type === 'email' ? 'email' : 'chat';
          const preview = String(msg.body || '').replace(/<[^>]+>/g, '').slice(0, 80);
          window.showCRMNotif(tipo, {
            cliente: msg.fromName || msg.from || 'Alguien',
            actor:   msg.fromName || msg.from || '',
            detalle: preview || '(mensaje sin texto)',
            extra:   msg.subject ? 'Asunto: ' + msg.subject : ''
          });
        }
      }
      // Actualizar lista de conversaciones
      updateConvPreview(msg);
    });

    socket.on('chat:typing', ({ from, typing }) => {
      if (activePeer && from === activePeer.username) {
        const ind = $('typingIndicator');
        $('typingName').textContent = activePeer.name;
        ind.classList.toggle('show', typing);
      }
    });

    socket.on('chat:presence', ({ username, online }) => {
      // Actualizar indicador de presencia en la lista
      const dot = document.querySelector(`.presence-dot[data-user="${username}"]`);
      if (dot) dot.classList.toggle('online', online);
      // Actualizar header de conversación activa
      if (activePeer && activePeer.username === username) {
        $('convStatus').textContent = online ? 'En línea' : 'Desconectado';
      }
    });
  }

  /* ── Cargar datos ── */
  async function loadUsers() {
    try {
      const data = await apiFetch('/api/chat/users');
      allUsers = data.users || [];
    } catch (e) { allUsers = []; }
  }

  async function loadConversations() {
    try {
      const data = await apiFetch('/api/chat/conversations');
      conversations = data.conversations || [];
    } catch (e) { conversations = []; }
  }

  async function loadUnreadCount() {
    try {
      const data = await apiFetch('/api/chat/unread-count');
      const count = data.count || 0;
      const badge = $('badge-unread');
      const notifCount = $('notifCount');
      badge.textContent = count;
      badge.classList.toggle('show', count > 0);
      notifCount.textContent = count;
      notifCount.classList.toggle('show', count > 0);
    } catch (e) {}
  }

  /* ── Render lista de chats ── */
  function renderChatList(filter = '') {
    const list = $('chatList');
    list.innerHTML = '';

    // Construir lista a partir de allUsers + conversations
    const convMap = new Map(conversations.map(c => [c.peer, c]));
    let items = allUsers.map(u => {
      const conv = convMap.get(u.username);
      return {
        username: u.username,
        name: u.name || u.username,
        avatarUrl: u.avatarUrl || '',
        role: u.role,
        lastMessage: conv?.lastMessage || '',
        lastTime: conv?.lastTime || null,
        unread: conv?.unread || 0
      };
    });

    // Ordenar: con mensajes primero, luego por tiempo
    items.sort((a, b) => {
      if (a.lastTime && b.lastTime) return new Date(b.lastTime) - new Date(a.lastTime);
      if (a.lastTime) return -1;
      if (b.lastTime) return 1;
      return a.name.localeCompare(b.name);
    });

    if (filter) {
      // Con búsqueda activa: mostrar TODOS los usuarios que coincidan
      const q = filter.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q) || i.username.toLowerCase().includes(q));
    } else {
      // Sin búsqueda: solo usuarios con actividad en los últimos 30 días
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      items = items.filter(item =>
        item.unread > 0 ||
        (item.lastTime && new Date(item.lastTime).getTime() >= cutoff)
      );
    }

    const labelEl = $('chatListLabel');
    if (labelEl) labelEl.textContent = filter ? 'Resultados' : 'Recientes';

    if (!items.length) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:.82rem;">${filter ? 'Sin resultados para "' + filter + '"' : 'Sin actividad reciente'}</div>`;
      return;
    }

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = `chat-item${item.unread ? ' unread' : ''}${activePeer?.username === item.username ? ' active' : ''}`;
      el.dataset.username = item.username;

      const av = avatarEl(item.name, item.avatarUrl, 38);
      const presenceDot = document.createElement('div');
      presenceDot.className = 'presence-dot';
      presenceDot.dataset.user = item.username;
      av.appendChild(presenceDot);

      el.innerHTML = `
        <div class="chat-item-info">
          <div class="chat-item-top">
            <span class="chat-item-name">${item.name}</span>
            <span class="chat-item-time">${item.lastTime ? formatTime(item.lastTime) : ''}</span>
          </div>
          <div class="chat-item-preview">${item.lastMessage || item.role || ''}</div>
        </div>
        <div class="unread-dot"></div>
      `;
      el.insertBefore(av, el.firstChild);

      el.addEventListener('click', () => openConversation(item));
      list.appendChild(el);
    });
  }

  /* ── Abrir conversación ── */
  async function openConversation(peer) {
    activePeer = peer;

    // Actualizar UI izquierda
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const chatItem = document.querySelector(`.chat-item[data-username="${peer.username}"]`);
    if (chatItem) { chatItem.classList.add('active'); chatItem.classList.remove('unread'); chatItem.querySelector('.unread-dot').style.display = 'none'; }

    // Mostrar panel derecho
    $('chatEmpty').style.display = 'none';
    $('inboxView').classList.remove('active');
    const convView = $('conversationView');
    convView.classList.add('active');

    // Header
    const convAvatar = $('convAvatar');
    convAvatar.innerHTML = '';
    if (peer.avatarUrl) {
      const img = document.createElement('img');
      img.src = peer.avatarUrl; img.alt = peer.name;
      img.onerror = () => { img.remove(); convAvatar.textContent = initials(peer.name); };
      convAvatar.appendChild(img);
    } else {
      convAvatar.textContent = initials(peer.name);
    }
    $('convName').textContent = peer.name;
    $('convStatus').textContent = 'Cargando…';

    // Cerrar búsqueda al cambiar de conversación
    closeConvSearch();

    // Limpiar mensajes
    const msgContainer = $('convMessages');
    msgContainer.innerHTML = '<div class="typing-indicator" id="typingIndicator"><div class="typing-dots"><span></span><span></span><span></span></div><span id="typingName"></span> está escribiendo…</div>';

    // Cargar mensajes
    try {
      const data = await apiFetch(`/api/chat/messages/${peer.username}`);
      renderMessages(data.messages || []);
      $('convStatus').textContent = 'En línea'; // se actualizará con presencia real
    } catch (e) {
      $('convStatus').textContent = 'Error al cargar';
    }

    loadUnreadCount();
    $('convInput').focus();
  }

  /* ── Render mensajes ── */
  function renderMessages(msgs) {
    const container = $('convMessages');
    const typingEl = document.getElementById('typingIndicator');

    // Limpiar pero preservar typing indicator
    Array.from(container.children).forEach(el => {
      if (el.id !== 'typingIndicator') el.remove();
    });

    let lastDate = null;
    msgs.forEach(msg => {
      const msgDate = new Date(msg.timestamp).toDateString();
      if (msgDate !== lastDate) {
        const sep = document.createElement('div');
        sep.className = 'msg-date-sep';
        sep.innerHTML = `<span>${new Date(msg.timestamp).toLocaleDateString('es', { weekday:'long', day:'numeric', month:'long' })}</span>`;
        container.insertBefore(sep, typingEl);
        lastDate = msgDate;
      }
      appendMessage(msg);
    });
    scrollToBottom();
  }

  function appendMessage(msg) {
    const container = $('convMessages');
    const typingEl = document.getElementById('typingIndicator');
    const isMine = msg.from === currentUser.username;

    const row = document.createElement('div');
    row.className = `msg-row ${isMine ? 'mine' : 'theirs'}`;
    row.dataset.id = msg._id;

    row.innerHTML = `
      <div class="msg-bubble">${escapeHtml(msg.body)}</div>
      <span class="msg-time">${formatBubbleTime(msg.timestamp)}</span>
    `;
    container.insertBefore(row, typingEl);
  }

  function escapeHtml(str = '') {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function scrollToBottom() {
    const c = $('convMessages');
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
  }

  function updateConvPreview(msg) {
    const peer = msg.from === currentUser.username ? msg.to : msg.from;
    const peerName = msg.from === currentUser.username ? msg.toName : msg.fromName;
    const idx = conversations.findIndex(c => c.peer === peer);
    const entry = { peer, peerName, lastMessage: msg.body, lastTime: msg.timestamp, unread: msg.to === currentUser.username && !activePeer ? 1 : 0 };
    if (idx >= 0) conversations[idx] = { ...conversations[idx], ...entry };
    else conversations.unshift(entry);
    renderChatList($('searchInput').value);
  }

  /* ── Enviar mensaje ── */
  async function sendMessage() {
    const input = $('convInput');
    const body = input.value.trim();
    if (!body || !activePeer) return;

    input.value = '';
    input.style.height = 'auto';

    // Optimistic UI
    appendMessage({ from: currentUser.username, to: activePeer.username, body, timestamp: new Date() });
    scrollToBottom();

    try {
      await apiFetch('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ to: activePeer.username, toName: activePeer.name, body, type: 'chat' })
      });
    } catch (e) {
      showToast('Error al enviar el mensaje');
    }
  }

  /* ── Vistas de bandeja ── */
  async function showInboxView(type) {
    $('chatEmpty').style.display = 'none';
    $('conversationView').classList.remove('active');
    const view = $('inboxView');
    view.classList.add('active');

    const titles = { unread: 'No leídos', sent: 'Enviados', received: 'Recibidos y leídos', followup: 'Seguimiento', chats: 'Bandeja de entrada' };
    $('inboxTitle').textContent = titles[type] || 'Bandeja';

    let msgs = [];
    try {
      const endpoints = { unread: '/api/chat/unread', sent: '/api/chat/sent', received: '/api/chat/inbox', followup: '/api/chat/followup', chats: '/api/chat/inbox' };
      const data = await apiFetch(endpoints[type] || '/api/chat/inbox');
      msgs = data.messages || [];
      if (type === 'received') msgs = msgs.filter(m => m.isRead);
    } catch (e) {}

    renderInboxList(msgs, type);
  }

  function renderInboxList(msgs, type) {
    const list = $('inboxList');
    if (!msgs.length) {
      list.innerHTML = '<div class="notif-empty">Sin mensajes en esta categoría</div>';
      return;
    }

    list.innerHTML = '';
    msgs.forEach(msg => {
      const isMine = msg.from === currentUser.username;
      const peerName = isMine ? msg.toName : msg.fromName;
      const peerAvatar = msg.fromAvatar || '';

      const el = document.createElement('div');
      el.className = `inbox-item${!msg.isRead && !isMine ? ' unread' : ''}`;

      const av = document.createElement('div');
      av.className = 'inbox-avatar';
      if (peerAvatar) { const img = document.createElement('img'); img.src = peerAvatar; av.appendChild(img); }
      else av.textContent = initials(peerName);

      el.innerHTML = `
        <div class="inbox-check"></div>
        <div class="inbox-info">
          <div class="inbox-from">${escapeHtml(peerName)}</div>
          <div class="inbox-subject">${escapeHtml(msg.subject || msg.body.slice(0,60))}</div>
        </div>
        <div class="inbox-meta">
          <span class="inbox-time">${formatTime(msg.timestamp)}</span>
          <div class="inbox-tags">
            ${!msg.isRead && !isMine ? '<span class="tag-unread">No leído</span>' : ''}
            ${msg.isFollowup ? '<span class="tag-followup">Seguimiento</span>' : ''}
          </div>
        </div>
      `;
      el.insertBefore(av, el.children[1]);

      el.addEventListener('click', () => {
        const peer = isMine
          ? allUsers.find(u => u.username === msg.to)
          : allUsers.find(u => u.username === msg.from);
        if (peer) openConversation({ username: peer.username, name: peer.name || peer.username, avatarUrl: peer.avatarUrl || '' });
      });

      list.appendChild(el);
    });
  }

  /* ── Panel de notificaciones ── */
  async function loadNotifPanel() {
    const list = $('notifList');
    list.innerHTML = '<div class="notif-empty">Cargando…</div>';
    try {
      const endpoints = { all: '/api/chat/inbox', unread: '/api/chat/unread', followup: '/api/chat/followup' };
      const data = await apiFetch(endpoints[notifTab]);
      const msgs = data.messages || [];
      if (!msgs.length) { list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>'; return; }
      list.innerHTML = '';
      msgs.slice(0, 20).forEach(msg => addNotifItemToList(list, msg));
    } catch (e) { list.innerHTML = '<div class="notif-empty">Error al cargar</div>'; }
  }

  function addNotifItem(msg) {
    if (!notifPanelOpen) return;
    if (notifTab === 'unread' || notifTab === 'all') {
      addNotifItemToList($('notifList'), msg, true);
    }
  }

  function addNotifItemToList(list, msg, prepend = false) {
    const isMine = msg.from === currentUser.username;
    const peerName = isMine ? msg.toName : msg.fromName;
    const peerAvatar = msg.fromAvatar || '';

    const el = document.createElement('div');
    el.className = `notif-item${!msg.isRead && !isMine ? ' unread' : ''}`;

    const av = document.createElement('div');
    av.className = 'notif-item-avatar';
    if (peerAvatar) { const img = document.createElement('img'); img.src = peerAvatar; av.appendChild(img); }
    else av.textContent = initials(peerName);

    el.innerHTML = `
      <div class="notif-unread-dot"></div>
      <div class="notif-item-body">
        <div class="notif-item-from">${escapeHtml(peerName)}</div>
        <div class="notif-item-preview">${escapeHtml(msg.subject || msg.body)}</div>
      </div>
      <span class="notif-item-time">${formatTime(msg.timestamp)}</span>
    `;
    el.insertBefore(av, el.children[1]);

    el.addEventListener('click', () => {
      const peer = isMine ? allUsers.find(u => u.username === msg.to) : allUsers.find(u => u.username === msg.from);
      if (peer) { openConversation({ username: peer.username, name: peer.name || peer.username, avatarUrl: peer.avatarUrl || '' }); toggleNotifPanel(false); }
    });

    if (prepend) list.insertBefore(el, list.firstChild);
    else list.appendChild(el);
  }

  function toggleNotifPanel(force) {
    notifPanelOpen = force !== undefined ? force : !notifPanelOpen;
    $('notifPanel').classList.toggle('open', notifPanelOpen);
    if (notifPanelOpen) loadNotifPanel();
  }

  /* ── Modal Redactar ── */
  function openCompose(prefillUser = null) {
    $('composeOverlay').classList.add('open');
    $('toTags').innerHTML = '';
    $('toInput').value = '';
    $('composeSubject').value = '';
    $('composeBody').innerHTML = '';
    toRecipients = [];
    if (prefillUser) addToTag(prefillUser);
    $('toInput').focus();
  }

  function closeCompose() { $('composeOverlay').classList.remove('open'); }

  function addToTag(user) {
    if (toRecipients.find(r => r.username === user.username)) return;
    toRecipients.push(user);
    const tag = document.createElement('span');
    tag.className = 'to-tag';
    tag.innerHTML = `${escapeHtml(user.name || user.username)}<button data-u="${user.username}">✕</button>`;
    tag.querySelector('button').addEventListener('click', () => {
      toRecipients = toRecipients.filter(r => r.username !== user.username);
      tag.remove();
    });
    $('toTags').appendChild(tag);
    $('toInput').value = '';
    $('toDropdown').classList.remove('open');
  }

  function filterToDropdown(q) {
    const drop = $('toDropdown');
    const results = allUsers.filter(u =>
      (u.name || u.username).toLowerCase().includes(q.toLowerCase()) &&
      !toRecipients.find(r => r.username === u.username)
    ).slice(0, 8);

    if (!results.length || !q) { drop.classList.remove('open'); return; }
    drop.innerHTML = '';
    results.forEach(u => {
      const opt = document.createElement('div');
      opt.className = 'to-option';
      const av = document.createElement('div');
      av.className = 'to-option-avatar';
      if (u.avatarUrl) { const img = document.createElement('img'); img.src = u.avatarUrl; av.appendChild(img); }
      else av.textContent = initials(u.name || u.username);
      opt.innerHTML = `<div class="to-option-info"><div class="to-option-name">${escapeHtml(u.name || u.username)}</div><div class="to-option-role">${escapeHtml(u.role || '')}</div></div>`;
      opt.insertBefore(av, opt.firstChild);
      opt.addEventListener('mousedown', e => { e.preventDefault(); addToTag(u); });
      drop.appendChild(opt);
    });
    drop.classList.add('open');
  }

  async function sendCompose() {
    const body = $('composeBody').innerHTML.trim();
    const subject = $('composeSubject').value.trim();
    if (!toRecipients.length || !body) { showToast('Completa el destinatario y el mensaje'); return; }

    const btn = $('btnSendCompose');
    btn.disabled = true;
    try {
      for (const r of toRecipients) {
        await apiFetch('/api/chat/messages', {
          method: 'POST',
          body: JSON.stringify({ to: r.username, toName: r.name || r.username, body, subject, type: 'email' })
        });
      }
      showToast('Mensaje enviado');
      closeCompose();
      await loadConversations();
      renderChatList();
    } catch (e) {
      showToast('Error al enviar');
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Bind Events ── */
  function bindEvents() {
    // Buscar
    $('searchInput').addEventListener('input', e => renderChatList(e.target.value));

    // Categorías
    document.querySelectorAll('.cat-item').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        currentCat = el.dataset.cat;
        if (currentCat === 'chats') {
          renderChatList();
          $('chatEmpty').style.display = '';
          $('conversationView').classList.remove('active');
          $('inboxView').classList.remove('active');
          activePeer = null;
        } else {
          showInboxView(currentCat);
        }
      });
    });

    // Enviar mensaje (Enter)
    $('convInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    $('convInput').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      // Typing indicator
      if (socket && activePeer) {
        socket.emit('chat:typing', { to: activePeer.username, from: currentUser.username, typing: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          socket.emit('chat:typing', { to: activePeer.username, from: currentUser.username, typing: false });
        }, 1500);
      }
    });
    $('btnSend').addEventListener('click', sendMessage);

    // Botón componer
    $('btnCompose').addEventListener('click', () => openCompose());
    $('btnCloseCompose').addEventListener('click', closeCompose);
    $('btnDeleteCompose').addEventListener('click', closeCompose);
    $('composeOverlay').addEventListener('click', e => { if (e.target === $('composeOverlay')) closeCompose(); });

    // Toolbar formato
    document.querySelectorAll('.toolbar-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        $('composeBody').focus();
      });
    });
    $('btnLink').addEventListener('click', () => {
      const url = prompt('URL del enlace:');
      if (url) document.execCommand('createLink', false, url);
    });

    // Destinatario
    $('toInput').addEventListener('input', e => filterToDropdown(e.target.value));
    $('toInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const first = $('toDropdown').querySelector('.to-option'); if (first) first.dispatchEvent(new MouseEvent('mousedown')); }
      if (e.key === 'Backspace' && !e.target.value && toRecipients.length) {
        const last = toRecipients[toRecipients.length - 1];
        toRecipients.pop();
        const tags = $('toTags').querySelectorAll('.to-tag');
        if (tags.length) tags[tags.length - 1].remove();
      }
    });

    // Enviar correo
    $('btnSendCompose').addEventListener('click', sendCompose);

    // Notificaciones
    $('btnNotif').addEventListener('click', () => toggleNotifPanel());
    document.addEventListener('click', e => {
      if (notifPanelOpen && !$('notifPanel').contains(e.target) && !$('btnNotif').contains(e.target)) toggleNotifPanel(false);
    });
    $('btnMarkAll').addEventListener('click', async () => {
      try {
        const data = await apiFetch('/api/chat/unread');
        const ids = (data.messages || []).map(m => m._id);
        if (ids.length) await apiFetch('/api/chat/messages/read-all', { method: 'PATCH', body: JSON.stringify({ ids }) });
        loadUnreadCount();
        loadNotifPanel();
        showToast('Mensajes marcados como leídos');
      } catch (e) {}
    });

    // Tabs notificaciones
    document.querySelectorAll('.notif-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        notifTab = tab.dataset.tab;
        loadNotifPanel();
      });
    });

    // Búsqueda dentro del chat
    $('btnSearchInChat').addEventListener('click', () => openConvSearch());
    $('btnConvSearchClose').addEventListener('click', () => closeConvSearch());
    $('convSearchInput').addEventListener('input', e => filterConvMessages(e.target.value));
    $('convSearchInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeConvSearch(); });

    // Bandeja completa
    $('btnOpenInbox').addEventListener('click', () => {
      document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
      $('cat-received').classList.add('active');
      showInboxView('received');
    });
  }

  /* ── Búsqueda dentro del chat activo ── */
  function filterConvMessages(q) {
    const container = $('convMessages');
    const resultsEl = $('convSearchResults');
    const rows = container.querySelectorAll('.msg-row');
    const seps = container.querySelectorAll('.msg-date-sep');

    // Limpiar highlights previos
    rows.forEach(r => {
      const b = r.querySelector('.msg-bubble');
      if (b) b.innerHTML = b.textContent; // strip marks
    });

    if (!q) {
      rows.forEach(r => r.style.display = '');
      seps.forEach(s => s.style.display = '');
      if (resultsEl) resultsEl.textContent = '';
      return;
    }

    const lq = q.toLowerCase();
    let count = 0;

    rows.forEach(r => {
      const b = r.querySelector('.msg-bubble');
      if (!b) { r.style.display = 'none'; return; }
      const text = b.textContent;
      if (text.toLowerCase().includes(lq)) {
        r.style.display = '';
        count++;
        // Highlight: escapar el texto y luego marcar coincidencias
        const safeText = escapeHtml(text);
        const reEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        b.innerHTML = safeText.replace(new RegExp(reEscaped, 'gi'), m => `<mark>${m}</mark>`);
      } else {
        r.style.display = 'none';
      }
    });

    // Ocultar separadores de fecha sin mensajes visibles
    seps.forEach(sep => {
      let next = sep.nextElementSibling;
      let hasVisible = false;
      while (next && !next.classList.contains('msg-date-sep')) {
        if (next.style.display !== 'none') { hasVisible = true; break; }
        next = next.nextElementSibling;
      }
      sep.style.display = hasVisible ? '' : 'none';
    });

    if (resultsEl) resultsEl.textContent = count ? `${count} resultado${count !== 1 ? 's' : ''}` : 'Sin resultados';
  }

  function openConvSearch() {
    const bar = $('convSearchBar');
    bar.style.display = '';
    $('convSearchInput').value = '';
    $('convSearchInput').focus();
    filterConvMessages('');
  }

  function closeConvSearch() {
    $('convSearchBar').style.display = 'none';
    $('convSearchInput').value = '';
    filterConvMessages('');
  }

  /* ── Reloj en tiempo real ── */
  function startClock() {
    function update() {
      const now = new Date();
      const dEl = $('clockDate');
      const tEl = $('clockTime');
      if (dEl) dEl.textContent = now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      if (tEl) tEl.textContent = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    update();
    setInterval(update, 1000);
  }

  /* ── Emoji picker ── */
  function initEmojiPicker() {
    const wrap = $('emojiPickerWrap');
    const btn  = $('btnEmojiToggle');
    if (!wrap || !btn) return;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      wrap.classList.toggle('open');
    });

    const picker = document.getElementById('mainEmojiPicker');
    if (picker) {
      picker.addEventListener('emoji-click', e => {
        const emoji = e.detail.unicode;
        const input = $('convInput');
        const start = input.selectionStart ?? input.value.length;
        const end   = input.selectionEnd   ?? input.value.length;
        input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
        // No cerramos el picker — el usuario puede seguir seleccionando emojis
        input.dispatchEvent(new Event('input'));
      });
    }

    document.addEventListener('click', e => {
      if (!wrap.classList.contains('open')) return;
      if (!wrap.contains(e.target) && e.target !== btn) wrap.classList.remove('open');
    });
  }

  /* ── Arrancar ── */
  document.addEventListener('DOMContentLoaded', () => {
    init();
    startClock();
    initEmojiPicker();
  });
})();
