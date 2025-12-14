// Consolidated ranking page script
// This file contains helpers, ranking loaders, promo media handlers and init logic
(function(){
  'use strict';

  // Utilities
  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const escapeAttr = (value) => escapeHtml(value).replace(/`/g, '&#96;');

  const sanitizeAvatarUrl = (rawUrl) => {
    const url = (rawUrl == null ? '' : String(rawUrl)).trim();
    if (!url) return '';
    if (/^data:image\//i.test(url)) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/\//.test(url)) {
      try { return `${window.location.protocol}${url}`; } catch (_) { return `https:${url}`; }
    }
    if (url.startsWith('/')) return url;
    if (/^uploads\//i.test(url)) return `/${url}`;
    return '';
  };

  const maybeProxyMedia = (rawUrl) => {
    const url = (rawUrl == null ? '' : String(rawUrl)).trim();
    if (!url) return '';
    if (/^data:/i.test(url)) return url;
    if (/^\/media\/proxy/i.test(url)) return url;
    if (/^https?:\/\//i.test(url)) {
      if (/^https?:\/\/res\.cloudinary\.com\//i.test(url)) {
        return `/media/proxy?url=${encodeURIComponent(url)}`;
      }
      return url;
    }
    if (url.startsWith('//')) {
      const absolute = `${window.location.protocol}${url}`;
      if (/^https?:\/\/res\.cloudinary\.com\//i.test(absolute)) {
        return `/media/proxy?url=${encodeURIComponent(absolute)}`;
      }
      return absolute;
    }
    return url;
  };

  const toTimestamp = (value) => {
    if (!value && value !== 0) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'object' && value !== null) {
      if (value.$date) {
        const parsed = Date.parse(value.$date);
        return Number.isNaN(parsed) ? null : parsed;
      }
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.getTime();
      }
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const avatarsEnabled = () => true;

  const buildAgentAvatarUrl = (agent) => {
    if (!avatarsEnabled()) return '';
    if (!agent) return '';
    const raw = agent.avatarUrl || agent.imageUrl || '';
    const sanitized = sanitizeAvatarUrl(raw);
    if (!sanitized) return '';
    if (sanitized.includes('v=')) return maybeProxyMedia(sanitized);
    const timestamp = toTimestamp(agent.avatarUpdatedAt || agent.avatarUpdatedAtMs);
    let finalUrl = sanitized;
    if (timestamp) {
      const sep = sanitized.includes('?') ? '&' : '?';
      finalUrl = `${sanitized}${sep}v=${timestamp}`;
    }
    return maybeProxyMedia(finalUrl);
  };

  function resolveDisplayName(agent) {
    if (!agent) return '—';
    const usernameCandidates = [
      agent.username,
      agent.usuario?.username,
      agent.user?.username,
      agent.usuario?.userName,
      agent.userName
    ];
    for (const candidate of usernameCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    const nameCandidates = [
      agent.nombre,
      agent.name,
      agent.fullName,
      agent.displayName,
      agent.usuario?.name,
      agent.user?.name
    ];
    for (const candidate of nameCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return '—';
  }

  const renderAvatarHtml = (agent, altText = 'Avatar') => {
    if (!avatarsEnabled()) return '<i class="fas fa-user"></i>';
    const url = buildAgentAvatarUrl(agent);
    if (url) {
      const fallbackSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="100%" height="100%" fill="#e2e8f0"/><circle cx="60" cy="45" r="26" fill="#f8fafc"/><rect x="15" y="80" width="90" height="22" rx="10" fill="#f8fafc"/></svg>');
      return `<img src="${escapeAttr(url)}" alt="${escapeAttr(altText)}" class="avatar-photo" loading="lazy" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,${fallbackSvg}'">`;
    }
    return '<i class="fas fa-user"></i>';
  };

  // Intersection Observer para lazy-load de avatares
  const avatarObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const src = img.dataset.src;
        if (src && !img.src) {
          img.src = src;
        }
        avatarObserver.unobserve(img);
      }
    });
  }, { rootMargin: '50px' });

  const applyAvatarToElement = (imgEl, agent, options = {}) => {
    const { allowPhoto = true } = options;
    if (!imgEl) return;
    if (!imgEl.dataset.defaultSrc) {
      imgEl.dataset.defaultSrc = imgEl.getAttribute('src') || '';
    }
    if (!imgEl.dataset.defaultAlt) {
      imgEl.dataset.defaultAlt = imgEl.getAttribute('alt') || 'Avatar';
    }
    const shouldUsePhoto = allowPhoto && avatarsEnabled() && agent;
    if (!shouldUsePhoto) {
      if (imgEl.dataset.defaultSrc) {
        imgEl.src = imgEl.dataset.defaultSrc;
      }
      imgEl.classList.remove('avatar-photo');
      if (imgEl.dataset.defaultAlt) {
        imgEl.alt = imgEl.dataset.defaultAlt;
      }
      if (!allowPhoto) {
        imgEl.removeAttribute('loading');
      }
      avatarObserver.unobserve(imgEl);
      return;
    }
    const url = buildAgentAvatarUrl(agent);
    if (url) {
      imgEl.dataset.src = url;
      imgEl.alt = resolveDisplayName(agent) || 'Avatar';
      imgEl.classList.add('avatar-photo');
      imgEl.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23e2e8f0" width="100" height="100"/></svg>')`;
      avatarObserver.observe(imgEl);
      const fallbackSvgStr = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="100%" height="100%" fill="#e2e8f0"/><circle cx="60" cy="45" r="26" fill="#f8fafc"/><rect x="15" y="80" width="90" height="22" rx="10" fill="#f8fafc"/></svg>');
      imgEl.onerror = function(){ this.onerror = null; this.src = fallbackSvgStr; };
    } else {
      imgEl.classList.remove('avatar-photo');
      if (imgEl.dataset.defaultSrc) {
        imgEl.src = imgEl.dataset.defaultSrc;
      }
    }
  };

  async function getUser(){
    try {
      const storedUser = sessionStorage.getItem('user') || localStorage.getItem('user');
      if (storedUser) {
        try { return JSON.parse(storedUser); } catch (e) { console.warn('Error parseando usuario guardado:', e); }
      }
      const res = await fetch('/api/auth/verify', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.user) sessionStorage.setItem('user', JSON.stringify(data.user));
      return data.user;
    } catch(error){ console.error('Error obteniendo usuario:', error); return null; }
  }

  // Ranking cache
  const RANKING_CACHE = new Map();
  const RANKING_CACHE_TTL = 5 * 60 * 1000;
  function getCachedRanking(key) {
    const cached = RANKING_CACHE.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > RANKING_CACHE_TTL) { RANKING_CACHE.delete(key); return null; }
    return cached.data;
  }
  function setCachedRanking(key, data) { RANKING_CACHE.set(key, { data, timestamp: Date.now() }); }

  // Helpers for scores
  const parseNumberLenient = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = Number(String(v).replace(/,/g, '.'));
    return isFinite(n) ? n : null;
  };

  function formatScore(n) {
    if (n == null) return '0';
    const toNum = (v) => {
      if (typeof v === 'number') return isFinite(v) ? v : NaN;
      const s = String(v).trim().replace(/,/g, '.');
      const num = Number(s);
      return isFinite(num) ? num : NaN;
    };
    const num = toNum(n);
    if (!isFinite(num)) return '0';
    const rounded = Math.round((num + Number.EPSILON) * 100) / 100;
    if (rounded === Math.floor(rounded)) return String(rounded);
    return rounded.toFixed(2).replace(/\.?0+$/, '');
  }

  function getScoreFromItem(item) {
    if (!item) return 0;
    const s = parseNumberLenient(item.sumPuntaje);
    if (s != null) return s;
    const p = parseNumberLenient(item.puntos);
    if (p != null) return p;
    const pr = parseNumberLenient(item.promedio);
    if (pr != null) return pr;
    return 0;
  }

  // Loaders and renderers
  async function loadRankingTop3(){
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const fechaInicio = `${y}-${m}-01`;
      const fechaFin = `${y}-${m}-${d}`;
      const cacheKey = `top3-${fechaInicio}`;
      let data = getCachedRanking(cacheKey);
      if (!data) {
        const url = `/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&limit=50`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('Respuesta no OK en /api/ranking');
        data = await res.json();
        setCachedRanking(cacheKey, data);
      }
      const list = Array.isArray(data?.ranking) ? data.ranking : [];
      if (list.length === 0) return;
      const top1 = list[0]; const top2 = list[1]; const top3 = list[2];
      const setSlot = (selectorBase, item) => {
        if (!item) return;
        const nameEl = document.querySelector(`${selectorBase} .astronaut-name`);
        const scoreEl = document.querySelector(`${selectorBase} .astronaut-score`);
        const imgEl = document.querySelector(`${selectorBase} .astronaut-image`);
        try {
          const rawScore = getScoreFromItem(item);
          if (nameEl) nameEl.textContent = resolveDisplayName(item);
          if (scoreEl) scoreEl.textContent = formatScore(rawScore);
        } catch (e) { console.warn('[RANKING][DEBUG] setSlot error', selectorBase, e); }
        if (imgEl) applyAvatarToElement(imgEl, item, { allowPhoto: false });
      };
      const clearSlot = (selectorBase) => {
        const nameEl = document.querySelector(`${selectorBase} .astronaut-name`);
        const scoreEl = document.querySelector(`${selectorBase} .astronaut-score`);
        const imgEl = document.querySelector(`${selectorBase} .astronaut-image`);
        if (nameEl) nameEl.textContent = '—';
        if (scoreEl) scoreEl.textContent = '0';
        if (imgEl) applyAvatarToElement(imgEl, null, { allowPhoto: false });
      };
      clearSlot('.first-pos'); clearSlot('.second-pos'); clearSlot('.third-pos');
      setSlot('.first-pos', top1); setSlot('.second-pos', top2); setSlot('.third-pos', top3);
      window.__rankFullList = list;

      const container = document.getElementById('rank-list-dynamic');
      if (container) {
        const viewAll = !!window.__rankViewAll;
        const topN = viewAll ? list : list.slice(0, 10);
        const rest = topN.length > 3 ? topN.slice(3) : topN;
        container.innerHTML = '';
        rest.forEach((agent, idx) => {
          const li = document.createElement('div'); li.className = 'rank-item';
          const position = agent.position || agent.posicion || (idx + 4);
          const name = escapeHtml(resolveDisplayName(agent));
          const role = escapeHtml(agent.cargo || '');
          const pointsValue = formatScore(getScoreFromItem(agent));
          const salesValue = Number(agent.ventas || 0);
          const avatarMarkup = renderAvatarHtml(agent, resolveDisplayName(agent) || 'Avatar');
          li.innerHTML = `\n                  <span class="rank-number">${position}</span>\n                  <div class="agent-info">\n                    <div class="agent-avatar">${avatarMarkup}</div>\n                    <div class="agent-details">\n                      <h4>${name}</h4>\n                      <p>${role}</p>\n                    </div>\n                  </div>\n                  <div class="agent-stats">\n                    <span class="points">${escapeHtml(pointsValue)} pts</span>\n                    <span class="sales">${escapeHtml(salesValue.toString())} ventas</span>\n                  </div>`;
          container.appendChild(li);
        });
      }

      const table = document.getElementById('full-rank-table');
      if (table) {
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';
        const dataForTable = (window.__rankViewAll ? list : list.slice(0,10));
        dataForTable.forEach((agent, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `\n                  <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${agent.position || agent.posicion || (idx + 1)}</td>\n                  <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${escapeHtml(resolveDisplayName(agent))}</td>\n                  <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right;">${agent.ventas ?? 0}</td>\n                  <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700;">${formatScore((agent.sumPuntaje ?? agent.puntos ?? 0))}</td>\n                `;
          tbody.appendChild(tr);
        });
      }

      // Configure 'Ver todos' button
      const btn = document.getElementById('btn-open-full-ranking');
      if (btn) {
        const currentUser = await getUser();
        const userRole = ((currentUser && (currentUser.role || currentUser.usuario?.role || currentUser.userRole)) || '').toString().toLowerCase();
        const canViewAll = ['admin','administrador','supervisor','supervisor team lineas','backoffice','agente'].includes(userRole);
        btn.style.display = canViewAll ? 'inline-block' : 'none';
        btn.onclick = async () => {
          window.__rankViewAll = !window.__rankViewAll;
          btn.textContent = window.__rankViewAll ? 'Ver menos' : 'Ver todos';
          if (window.__rankViewAll) {
            try {
              const now = new Date();
              const y = now.getFullYear();
              const m = String(now.getMonth() + 1).padStart(2, '0');
              const d = String(now.getDate()).padStart(2, '0');
              const fechaInicio = `${y}-${m}-01`;
              const fechaFin = `${y}-${m}-${d}`;
              const urlAll = `/api/ranking?all=1&fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`;
              const resAll = await fetch(urlAll, { credentials: 'include' });
              if (resAll.ok) {
                const dataAll = await resAll.json();
                const full = Array.isArray(dataAll?.ranking) ? dataAll.ranking : [];
                window.__rankFullList = full.length ? full : (window.__rankFullList || []);
              }
            } catch (e) { console.warn('[RANKING] No se pudo obtener lista completa:', e); }
          }
          const listSaved = window.__rankFullList || [];
          const container2 = document.getElementById('rank-list-dynamic');
          if (container2) {
            const source = window.__rankViewAll ? listSaved : listSaved.slice(0,10);
            const rest2 = source.length > 3 ? source.slice(3) : source;
            container2.innerHTML = '';
            rest2.forEach((agent, idx) => {
              const li = document.createElement('div'); li.className = 'rank-item';
              const position = agent.position || agent.posicion || (idx + 4);
              const name = escapeHtml(resolveDisplayName(agent));
              const role = escapeHtml(agent.cargo || '');
              const pointsValue = formatScore(getScoreFromItem(agent));
              const salesValue = Number(agent.ventas || 0);
              const avatarMarkup = renderAvatarHtml(agent, resolveDisplayName(agent) || 'Avatar');
              li.innerHTML = `\n                    <span class="rank-number">${position}</span>\n                    <div class="agent-info">\n                      <div class="agent-avatar">${avatarMarkup}</div>\n                      <div class="agent-details">\n                        <h4>${name}</h4>\n                        <p>${role}</p>\n                      </div>\n                    </div>\n                    <div class="agent-stats">\n                      <span class="points">${escapeHtml(pointsValue)} pts</span>\n                      <span class="sales">${escapeHtml(salesValue.toString())} ventas</span>\n                    </div>`;
              container2.appendChild(li);
            });
          }
          const table2 = document.getElementById('full-rank-table');
          if (table2) {
            const tbody2 = table2.querySelector('tbody'); tbody2.innerHTML = '';
            const data2 = window.__rankViewAll ? listSaved : listSaved.slice(0, 10);
            data2.forEach((agent, idx) => {
              const tr = document.createElement('tr');
              tr.innerHTML = `\n                      <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${agent.position || agent.posicion || (idx + 1)}</td>\n                      <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${escapeHtml(resolveDisplayName(agent))}</td>\n                      <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right;">${agent.ventas ?? 0}</td>\n                      <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700;">${formatScore((agent.sumPuntaje ?? agent.puntos ?? 0))}</td>\n                    `;
              tbody2.appendChild(tr);
            });
          }
        };
      }

      console.log('[RANKING] ✅ Podio actualizado desde BD');
    } catch (err) { console.error('[RANKING] ❌ Error cargando top 3:', err); }
  }

  // Additional helpers and period/month navigation
  function monthBounds(y, m){
    const start = new Date(y, m, 1);
    const now = new Date();
    const isCurrent = (y === now.getFullYear() && m === now.getMonth());
    const end = isCurrent ? now : new Date(y, m + 1, 0);
    const yyyy = start.getFullYear();
    const mm = String(start.getMonth()+1).padStart(2,'0');
    const ddEnd = String(end.getDate()).padStart(2,'0');
    return { fechaInicio: `${yyyy}-${mm}-01`, fechaFin: `${yyyy}-${mm}-${ddEnd}`, isCurrent };
  }

  async function loadRankingByMonth(y,m){
    const {fechaInicio,fechaFin,isCurrent}=monthBounds(y,m);
    try{
      const cacheKey = `month-${fechaInicio}`;
      let data = getCachedRanking(cacheKey);
      if (!data) {
        const fieldParam = isCurrent ? '' : '&field=createdAt';
        const url=`/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&limit=100${fieldParam}`;
        const res=await fetch(url,{credentials:'include'});
        if(!res.ok) throw new Error('HTTP '+res.status);
        data=await res.json();
        const list=Array.isArray(data?.ranking)?data.ranking:[];
        if (list.length < 5) {
          const urlAll=`/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&all=1${fieldParam}`;
          try { const resAll=await fetch(urlAll,{credentials:'include'}); if(resAll.ok) data=await resAll.json(); } catch(e){}
        }
        setCachedRanking(cacheKey, data);
      }
      const list=Array.isArray(data?.ranking)?data.ranking:[];
      updateRankingUI(list);
    }catch(e){ console.warn('[RANKING] No se pudo cargar mes', y,m,e); }
  }

  // updateRankingUI implementation (idempotent)
  function updateRankingUI(list){
    try{
      const safe = Array.isArray(list) ? list : [];
      const [top1, top2, top3] = [safe[0]||{}, safe[1]||{}, safe[2]||{}];
      const getScore = (it)=> getScoreFromItem(it);
      const fmt = (n)=> formatScore(n);
      const setSlot=(sel,it)=>{
        const nameEl=document.querySelector(`${sel} .astronaut-name`);
        const scoreEl=document.querySelector(`${sel} .astronaut-score`);
        const imgEl=document.querySelector(`${sel} .astronaut-image`);
        try{
          const raw = getScore(it);
          if(nameEl) nameEl.textContent = resolveDisplayName(it);
          if(scoreEl) scoreEl.textContent = fmt(raw);
        }catch(e){ console.warn('[RANKING][DEBUG] setSlot error', e); }
        if(imgEl) applyAvatarToElement(imgEl, it, { allowPhoto: false });
      };
      ['.first-pos','.second-pos','.third-pos'].forEach(sel=>{
        const nameEl=document.querySelector(`${sel} .astronaut-name`);
        const scoreEl=document.querySelector(`${sel} .astronaut-score`);
        const imgEl=document.querySelector(`${sel} .astronaut-image`);
        if(nameEl) nameEl.textContent='—'; if(scoreEl) scoreEl.textContent='0'; if(imgEl) applyAvatarToElement(imgEl, null, { allowPhoto: false });
      });
      setSlot('.first-pos', top1); setSlot('.second-pos', top2); setSlot('.third-pos', top3);
      const container=document.getElementById('rank-list-dynamic');
      if(container){
        const rest=safe.slice(3, 13);
        container.innerHTML='';
        rest.forEach((agent,idx)=>{
          const li=document.createElement('div'); li.className='rank-item';
          const position = agent.position||agent.posicion||(idx+4);
          const name = escapeHtml(resolveDisplayName(agent));
          const role = escapeHtml(agent.cargo||'');
          const pointsValue = fmt(getScore(agent));
          const salesValue = Number(agent.ventas||0);
          const avatarMarkup = renderAvatarHtml(agent, resolveDisplayName(agent) || 'Avatar');
          li.innerHTML=`\n                  <span class="rank-number">${position}</span>\n                  <div class="agent-info">\n                    <div class="agent-avatar">${avatarMarkup}</div>\n                    <div class="agent-details">\n                      <h4>${name}</h4>\n                      <p>${role}</p>\n                    </div>\n                  </div>\n                  <div class="agent-stats">\n                    <span class="points">${escapeHtml(pointsValue)} pts</span>\n                    <span class="sales">${escapeHtml(salesValue.toString())} ventas</span>\n                  </div>`;
          container.appendChild(li);
        });
      }
      const table=document.getElementById('full-rank-table');
      if(table){
        const tbody=table.querySelector('tbody'); if(tbody){ tbody.innerHTML=''; (safe.slice(0,10)).forEach((agent,idx)=>{ const tr=document.createElement('tr'); tr.innerHTML=`\n                    <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${agent.position||agent.posicion||(idx+1)}</td>\n                    <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${escapeHtml(resolveDisplayName(agent))}</td>\n                    <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right;">${agent.ventas??0}</td>\n                    <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700;">${fmt(getScore(agent))}</td>`; tbody.appendChild(tr); }); }
      }
    }catch(e){ console.warn('[RANKING] update UI error', e); }
  }

  // Promo rendering helpers (renderPromo, loadLatestMedia, handleUpload, fixMediaDates)
  function renderPromo(container, file){
    container.innerHTML = '';
    if (!file || !file.url){ container.innerHTML = '<div class="promo-placeholder">Sin promoción. Sube una imagen o video.</div>'; return; }
    const isVideo = (file.type||'').startsWith('video/');
    const versionedUrl = (() => { const base = file.url || ''; if (!base) return ''; const sep = base.includes('?') ? '&' : '?'; return `${base}${sep}t=${Date.now()}`; })();
    const mediaUrl = maybeProxyMedia(versionedUrl || file.url || '');
    const applyFit = (mediaEl, naturalW, naturalH) => {
      const box = container; const boxW = box.clientWidth || 1100; const ratio = naturalW && naturalH ? (naturalW / naturalH) : (16/9); let targetH = Math.min(420, Math.max(200, Math.round(boxW / ratio))); box.style.height = targetH + 'px'; box.classList.toggle('contain', ratio < 1.6);
    };
    if (isVideo){
      const v = document.createElement('video'); v.src = mediaUrl || versionedUrl; v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true; v.controls = true; v.addEventListener('loadedmetadata', () => applyFit(v, v.videoWidth, v.videoHeight)); v.addEventListener('error', () => { container.innerHTML = '<div class="promo-placeholder">Archivo multimedia no disponible</div>'; }); container.appendChild(v);
    } else {
      const img = document.createElement('img'); img.src = mediaUrl || versionedUrl; img.alt = file.name || 'Promoción'; img.addEventListener('load', () => applyFit(img, img.naturalWidth, img.naturalHeight)); img.addEventListener('error', () => { container.innerHTML = '<div class="promo-placeholder">Archivo multimedia no disponible</div>'; }); container.appendChild(img);
    }
  }

  async function loadLatestMedia(){
    const mediaBox = document.getElementById('promo-media'); if (!mediaBox) return;
    try {
      const url = `/api/media?category=marketing&limit=1&sort=desc&orderBy=uploadDate&t=${Date.now()}`;
      const res = await fetch(url, { credentials: 'include' }); if (!res.ok) throw new Error('Server response not OK');
      const list = await res.json(); const last = Array.isArray(list) && list.length ? list[0] : null;
      if (!last || !last.url) { mediaBox.innerHTML = '<div class="promo-placeholder">📭 Sin promoción disponible</div>'; return; }
      const headUrl = maybeProxyMedia(last.url) || last.url;
      const fileResponse = await fetch(headUrl, { method: 'HEAD' }); if (!fileResponse.ok) { mediaBox.innerHTML = '<div class="promo-placeholder">📭 Archivo no encontrado</div>'; return; }
      renderPromo(mediaBox, last);
    } catch(e){ console.error('[PROMO] Error cargando multimedia:', e); mediaBox.innerHTML = '<div class="promo-placeholder">❌ Error al cargar promoción</div>'; }
  }

  async function handleUpload(e){
    const input = e.target; const file = input.files[0]; if (!file) return; const formData = new FormData(); formData.append('file', file); formData.append('category', 'marketing');
    try {
      const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: { 'x-media-category': 'marketing' }, body: formData });
      if (!res.ok) throw new Error('upload failed');
      const result = await res.json(); setTimeout(async () => { await loadLatestMedia(); }, 500);
    } catch(err){ console.error('[PROMO] ❌ Error en upload:', err); alert('No se pudo subir el archivo: ' + (err.message||err)); } finally { input.value = ''; }
  }

  async function fixMediaDates() {
    if (!confirm('¿Estás seguro de que quieres corregir las fechas de los archivos multimedia?')) return;
    try {
      const res = await fetch('/api/media/fix-dates', { method: 'POST', credentials: 'include' }); const result = await res.json(); alert(result.message || 'Proceso completado.'); if (result.success) { loadLatestMedia(); }
    } catch (error) { console.error('Error al ejecutar la corrección:', error); alert('Falló la corrección: ' + error.message); }
  }

  // Initialization
  async function initRankingPage(){
    try{
      if (typeof window.__rankYear === 'undefined') { window.__rankYear = (new Date()).getFullYear(); }
      if (typeof window.__rankMonth === 'undefined') { window.__rankMonth = (new Date()).getMonth(); }
      if (typeof window.__rankViewAll === 'undefined') window.__rankViewAll = false;

      const user = await getUser();
      const promoActions = document.getElementById('promo-actions');
      const promoFileInput = document.getElementById('promo-file');
      const promoHero = document.querySelector('.promo-hero');
      if (promoHero) promoHero.style.display = 'flex';
      try { await loadLatestMedia(); } catch(_) {}
      const allowUpload = user && ['admin','administrador','supervisor','backoffice'].includes(((user.role||'')+'').toString().toLowerCase());
      if (promoActions) promoActions.style.display = allowUpload ? 'flex' : 'none';
      if (allowUpload && promoFileInput) promoFileInput.addEventListener('change', handleUpload);

      try { await loadRankingTop3(); } catch(e){ console.warn('[RANKING] No se pudo cargar el top 3 en init:', e); }
      // Load current month
      loadRankingByMonth(window.__rankYear, window.__rankMonth);

      // Event listeners
      let _rankNavT;
      document.addEventListener('rank-nav', (ev)=>{ clearTimeout(_rankNavT); _rankNavT = setTimeout(() => { const dir = Number(ev?.detail?.dir)||0; if(!dir) return; let y=window.__rankYear, m=window.__rankMonth; m += dir; if(m<0){ m=11; y-=1; } else if(m>11){ m=0; y+=1; } window.__rankYear=y; window.__rankMonth=m; loadRankingByMonth(y,m); }, 240); });

      let _resizeT;
      window.addEventListener('resize', () => { clearTimeout(_resizeT); _resizeT = setTimeout(() => { const media = document.querySelector('#promo-media img, #promo-media video'); const box = document.getElementById('promo-media'); if (media && box) { const isVideo = media.tagName === 'VIDEO'; const naturalW = isVideo ? media.videoWidth : media.naturalWidth; const naturalH = isVideo ? media.videoHeight : media.naturalHeight; const boxW = box.clientWidth || 1100; const ratio = naturalW && naturalH ? (naturalW / naturalH) : (16/9); let targetH = Math.min(420, Math.max(200, Math.round(boxW / ratio))); box.style.height = targetH + 'px'; box.classList.toggle('contain', ratio < 1.6); } }, 200); });

    }catch(e){ console.error('[INIT] Error inicializando ranking page:', e); }
  }

  // Role bar renderer (keeps same logic as before)
  (async function renderRoleBar(){
    try{
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const opts = { method: 'GET', credentials: 'include', headers: Object.assign({'Content-Type':'application/json'}, token?{ 'Authorization': `Bearer ${token}` }:{}) };
      let users = [];
      try {
        const resp = await fetch('/api/users/admin-list', opts);
        if (resp && resp.ok) {
          const json = await resp.json();
          users = Array.isArray(json.users) ? json.users : (Array.isArray(json.data) ? json.data : []);
        } else {
          const resp2 = await fetch('/api/users/agents', opts);
          if (resp2 && resp2.ok) {
            const j2 = await resp2.json(); users = Array.isArray(j2.agents) ? j2.agents : [];
          }
        }
      } catch(e){ console.warn('[RoleBar] error fetching users', e); }

      const byRole = { backoffice: [], supervisor: [], admin: [] };
      users.forEach(u => {
        const role = (u.role||'').toString().toLowerCase();
        if (role.includes('back')) byRole.backoffice.push(u);
        else if (role.includes('supervisor')) byRole.supervisor.push(u);
        else if (role.includes('admin')) byRole.admin.push(u);
      });

      if (!byRole.admin.length) {
        try{ const me = JSON.parse(localStorage.getItem('user')||sessionStorage.getItem('user')||'{}'); if (me && (me.role||'').toString().toLowerCase().includes('admin')) byRole.admin.push({ id: me.id || me._id, username: me.username, name: me.name || me.username, avatarUrl: me.avatarUrl }); }catch(e){}
      }

      const renderAvatars = (elId, arr) => {
        const container = document.getElementById(elId); if (!container) return; container.innerHTML = ''; arr.slice(0,8).forEach(u=>{
          const a = document.createElement('div'); a.className='role-avatar'; let url = null;
          if (u.avatarFileId) { url = `/api/user-avatars/${u.avatarFileId}`; }
          else if (u.avatarUrl || u.photo || u.picture || u.imageUrl || u.avatar) { url = u.avatarUrl || u.photo || u.picture || u.imageUrl || u.avatar; }
          else if (u._id || u.id) { const uid = u._id || u.id; url = `/api/user-avatars/${uid}`; }
          if (url) {
            const img = document.createElement('img'); img.src = url; img.alt = u.name || u.username || ''; img.onerror = function(){ this.style.display = 'none'; const initials = (u.name || u.username || '').split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase(); const span = document.createElement('div'); span.className='initials'; span.textContent = initials || '?'; a.appendChild(span); };
            a.appendChild(img);
          } else {
            const initials = (u.name || u.username || '').split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase(); const span = document.createElement('div'); span.className='initials'; span.textContent = initials || '?'; a.appendChild(span);
          }
          a.title = u.name || u.username || '';
          container.appendChild(a);
        });
        const countEl = document.getElementById(elId.replace('Avatars','Count'));
        if (countEl) countEl.textContent = `${arr.length} usuarios`;
      };

      renderAvatars('backofficeAvatars', byRole.backoffice);
      renderAvatars('supervisorAvatars', byRole.supervisor);
      renderAvatars('adminAvatars', byRole.admin);
      if (!byRole.backoffice.length && !byRole.supervisor.length && !byRole.admin.length) {
        const rb = document.getElementById('roleBar'); if (rb) rb.style.display = 'none';
      }
    }catch(err){ console.error('[RoleBar] error', err); }
  })();

  // Expose certain functions globally for head-time calls
  window.updateRankingUI = window.updateRankingUI || updateRankingUI;

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRankingPage);
  } else {
    initRankingPage();
  }

})();
