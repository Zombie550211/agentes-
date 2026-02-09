(function(){
  'use strict';

  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(n){
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString('es-MX');
  }

  function formatScore(n){
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return '0';
    const rounded = Math.round((num + Number.EPSILON) * 100) / 100;
    return (rounded === Math.floor(rounded)) ? String(rounded) : rounded.toFixed(2).replace(/\.0+$/,'').replace(/(\.\d)0$/,'$1');
  }

  function isCancelledStatus(lead){
    const s = String(lead?.status || lead?._raw?.status || '').trim().toUpperCase();
    return s.includes('CANCEL');
  }

  function getAgentName(lead){
    return String(
      lead?.agenteNombre ||
      lead?.nombreAgente ||
      lead?.agente ||
      lead?.agentName ||
      lead?.agent ||
      lead?.usuario ||
      lead?._raw?.agenteNombre ||
      lead?._raw?.agente ||
      'Sin asignar'
    ).trim() || 'Sin asignar';
  }

  function getPoints(lead){
    const candidates = [
      lead?.puntaje,
      lead?.puntos,
      lead?.score,
      lead?.points,
      lead?._raw?.puntaje,
      lead?._raw?.puntos
    ];
    for (const c of candidates) {
      const num = Number(String(c ?? '').replace(/,/g,'.'));
      if (Number.isFinite(num)) return num;
    }
    return 0;
  }

  function isAttLead(lead){
    const hay = [
      lead?.tipo_servicios,
      lead?.tipo_servicio,
      lead?.servicios_texto,
      lead?.sistema,
      lead?.mercado,
      lead?._raw?.tipo_servicios,
      lead?._raw?.tipo_servicio,
      lead?._raw?.servicios_texto,
      lead?._raw?.sistema,
      lead?._raw?.mercado
    ].map(v => String(v || '').toUpperCase());

    // Heurística base: ATT / AT&T / AT T / AT&T AIR
    return hay.some(s => s.includes('AT&T') || s.includes('ATT') || s.includes('AT T'));
  }

  async function fetchRankingsTabs(month){
    const activationScope = (window.__rankingsActivationScope === 'team') ? 'team' : 'agent';
    const url = `/api/ranking/tabs?month=${encodeURIComponent(month)}&activationGroup=${encodeURIComponent(activationScope)}&limit=200`;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const opts = {
      method: 'GET',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      throw new Error(`No se pudo cargar /api/ranking/tabs (${res.status}). ${txt.slice(0,180)}`);
    }
    const data = await res.json();
    const d = data?.data || {};
    return {
      month: String(data?.month || month),
      activation: Array.isArray(d.activation) ? d.activation : [],
      sales: Array.isArray(d.sales) ? d.sales : [],
      att: Array.isArray(d.att) ? d.att : [],
      meta: data?.meta || null
    };
  }

  async function fetchAllLeadsForMonth(month){
    // NOTA: usamos /api/leads con limit alto. Si tu backend limita, ajustamos luego.
    const limit = 50000;
    const url = `/api/leads?page=1&limit=${encodeURIComponent(limit)}&month=${encodeURIComponent(month)}`;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const opts = {
      method: 'GET',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      throw new Error(`No se pudo cargar /api/leads (${res.status}). ${txt.slice(0,180)}`);
    }
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.leads) ? data.leads : []));
    const meta = {
      total: Number(data?.total) || (Array.isArray(arr) ? arr.length : 0),
      pages: Number(data?.pages) || 1,
      page: Number(data?.page) || 1
    };
    return { arr, meta };
  }

  function buildRanking(leads, opts){
    const {
      onlyAtt = false,
      countBySales = true,
      pointsOnly = false
    } = opts || {};

    const map = new Map();

    for (const lead of (leads || [])) {
      if (!lead) continue;
      if (isCancelledStatus(lead)) continue;
      if (onlyAtt && !isAttLead(lead)) continue;

      const agent = getAgentName(lead);
      const pts = getPoints(lead);

      const ex = map.get(agent) || { agent, ventas: 0, puntos: 0 };
      ex.ventas += 1;
      ex.puntos += pts;
      map.set(agent, ex);
    }

    const list = Array.from(map.values());

    list.sort((a,b) => {
      if (pointsOnly) {
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
        if (b.ventas !== a.ventas) return b.ventas - a.ventas;
      } else if (countBySales) {
        if (b.ventas !== a.ventas) return b.ventas - a.ventas;
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      } else {
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
        if (b.ventas !== a.ventas) return b.ventas - a.ventas;
      }
      return String(a.agent).localeCompare(String(b.agent));
    });

    return list.map((row, idx) => ({ ...row, pos: idx + 1 }));
  }

  function setKpis(containerId, kpis){
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    (kpis || []).forEach(k => {
      const card = document.createElement('div');
      card.className = 'kpi';
      card.innerHTML = `<div class="kpi-label">${escapeHtml(k.label)}</div><div class="kpi-value">${escapeHtml(k.value)}</div>`;
      el.appendChild(card);
    });
  }

  function setMeta(metaId, text){
    const el = document.getElementById(metaId);
    if (el) el.textContent = text || '';
  }

  function fillTable(tableId, emptyId, rows, cols){
    const table = document.getElementById(tableId);
    const empty = document.getElementById(emptyId);
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = 'No hay datos para el mes seleccionado.';
      }
      return;
    }
    if (empty) empty.style.display = 'none';

    list.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map(c => {
        const val = typeof c.value === 'function' ? c.value(r) : (r[c.key] ?? '');
        const cls = c.className ? ` class="${c.className}"` : '';
        return `<td${cls}>${escapeHtml(val)}</td>`;
      }).join('');
      tbody.appendChild(tr);
    });
  }

  function setActiveTab(tabKey){
    $all('.tab-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tabKey));
    $all('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === tabKey));
  }

  function setActivationScope(scope){
    const normalized = (scope === 'team') ? 'team' : 'agent';
    window.__rankingsActivationScope = normalized;

    const root = document.getElementById('activationScope');
    if (root) {
      Array.from(root.querySelectorAll('.seg-btn')).forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute('data-scope') === normalized);
      });
    }

    // Update label in header table
    const th = document.querySelector('#table-activation thead th:nth-child(2)');
    if (th) th.textContent = normalized === 'team' ? 'Team' : 'Agente';
  }

  function bindActivationScopeToggle(){
    const root = document.getElementById('activationScope');
    if (!root) return;
    root.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.seg-btn') : null;
      if (!btn) return;
      const scope = btn.getAttribute('data-scope');
      setActivationScope(scope);
      refresh();
    });
  }

  function getCurrentMonthValue(){
    const el = document.getElementById('rankMonth');
    if (!el) return '';
    return String(el.value || '').trim();
  }

  function setDefaultMonth(){
    const el = document.getElementById('rankMonth');
    if (!el) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2,'0');
    el.value = `${y}-${m}`;
  }

  async function refresh(){
    const btn = document.getElementById('rankRefresh');
    const month = getCurrentMonthValue();
    if (!month) return;

    if (btn) btn.disabled = true;

    try {
      // Sidebar
      try { if (typeof window.loadSidebar === 'function') await window.loadSidebar(); } catch(_){ }

      const tabs = await fetchRankingsTabs(month);

      const activationScope = (window.__rankingsActivationScope === 'team') ? 'team' : 'agent';

      const rankActivation = (tabs.activation || []).map((r, idx) => ({
        pos: idx + 1,
        agent: r.nombre || r.agent || r.name || 'Sin asignar',
        ventas: Number(r.ventas || 0) || 0,
        puntos: Number(r.puntos ?? r.sumPuntaje ?? 0) || 0
      }));

      setMeta('meta-activation', `Mes ${tabs.month} — ${activationScope === 'team' ? 'Agrupado por Team' : 'Agrupado por Agente'} — orden: puntos, desempate ventas — Puntos solo COMPLETED`);
      if (activationScope === 'team') {
        const topByPoints = rankActivation.reduce((best, cur) => {
          if (!best) return cur;
          if ((cur.puntos || 0) !== (best.puntos || 0)) return (cur.puntos || 0) > (best.puntos || 0) ? cur : best;
          if ((cur.ventas || 0) !== (best.ventas || 0)) return (cur.ventas || 0) > (best.ventas || 0) ? cur : best;
          return best;
        }, null);
        setKpis('kpi-activation', [
          { label: 'Teams con ventas', value: formatNumber(rankActivation.length) },
          { label: 'Top 1 (Puntos)', value: topByPoints ? `${topByPoints.agent}` : '—' },
          { label: 'Puntaje Top 1', value: topByPoints ? formatScore(topByPoints.puntos) : '0' }
        ]);
      } else {
        const topByPoints = rankActivation.reduce((best, cur) => {
          if (!best) return cur;
          if ((cur.puntos || 0) !== (best.puntos || 0)) return (cur.puntos || 0) > (best.puntos || 0) ? cur : best;
          if ((cur.ventas || 0) !== (best.ventas || 0)) return (cur.ventas || 0) > (best.ventas || 0) ? cur : best;
          return best;
        }, null);
        setKpis('kpi-activation', [
          { label: 'Agentes con ventas', value: formatNumber(rankActivation.length) },
          { label: 'Top 1 (Puntos)', value: topByPoints ? `${topByPoints.agent}` : '—' },
          { label: 'Puntaje Top 1', value: topByPoints ? formatScore(topByPoints.puntos) : '0' }
        ]);
      }
      fillTable('table-activation', 'empty-activation', rankActivation.slice(0, 50), [
        { key: 'pos', value: r => String(r.pos), className: '' },
        { key: 'agent', value: r => r.agent, className: '' },
        { key: 'ventas', value: r => formatNumber(r.ventas), className: 'num' },
        { key: 'puntos', value: r => formatScore(r.puntos), className: 'num' }
      ]);

      const rankSales = (tabs.sales || []).map((r, idx) => ({
        pos: idx + 1,
        agent: r.nombre || r.agent || r.name || 'Sin asignar',
        ventas: Number(r.ventas || 0) || 0,
        puntos: Number(r.puntos ?? r.sumPuntaje ?? 0) || 0
      }));

      setMeta('meta-sales', `Mes ${tabs.month} — orden: ventas, desempate puntos`);
      const topSalesByPoints = rankSales.reduce((best, cur) => {
        if (!best) return cur;
        if ((cur.puntos || 0) !== (best.puntos || 0)) return (cur.puntos || 0) > (best.puntos || 0) ? cur : best;
        if ((cur.ventas || 0) !== (best.ventas || 0)) return (cur.ventas || 0) > (best.ventas || 0) ? cur : best;
        return best;
      }, null);
      setKpis('kpi-sales', [
        { label: 'Agentes con ventas', value: formatNumber(rankSales.length) },
        { label: 'Top 1 (Puntos)', value: topSalesByPoints ? `${topSalesByPoints.agent}` : '—' },
        { label: 'Puntaje Top 1', value: topSalesByPoints ? formatScore(topSalesByPoints.puntos) : '0' }
      ]);
      fillTable('table-sales', 'empty-sales', rankSales.slice(0, 50), [
        { key: 'pos', value: r => String(r.pos) },
        { key: 'agent', value: r => r.agent },
        { key: 'ventas', value: r => formatNumber(r.ventas), className: 'num' },
        { key: 'puntos', value: r => formatScore(r.puntos), className: 'num' }
      ]);

      // AT&T + Frontier: desde BD, filtrado por tipo_servicio y orden ventas desc + puntos desc
      const rankAtt = (tabs.att || []).map((r, idx) => ({
        pos: idx + 1,
        agent: r.nombre || r.agent || r.name || 'Sin asignar',
        ventasAtt: Number(r.ventasAtt || 0) || 0,
        ventasFrontier: Number(r.ventasFrontier || 0) || 0,
        ventasTotal: (Number(r.ventasAtt || 0) || 0) + (Number(r.ventasFrontier || 0) || 0),
        puntos: Number(r.puntos ?? r.sumPuntaje ?? 0) || 0
      }));

      setMeta('meta-att', `Mes ${tabs.month} — AT&T + Frontier por tipo_servicio | orden: ventas, desempate puntos`);
      const topAttByPoints = rankAtt.reduce((best, cur) => {
        if (!best) return cur;
        if ((cur.puntos || 0) !== (best.puntos || 0)) return (cur.puntos || 0) > (best.puntos || 0) ? cur : best;
        const curVentas = (cur.ventasAtt || 0) + (cur.ventasFrontier || 0);
        const bestVentas = (best.ventasAtt || 0) + (best.ventasFrontier || 0);
        if (curVentas !== bestVentas) return curVentas > bestVentas ? cur : best;
        return best;
      }, null);
      setKpis('kpi-att', [
        { label: 'Agentes con AT&T + Frontier', value: formatNumber(rankAtt.length) },
        { label: 'Total de ventas', value: formatNumber(rankAtt.reduce((sum, r) => sum + (r.ventasTotal || 0), 0)) },
        { label: 'Top 1 (Puntos)', value: topAttByPoints ? `${topAttByPoints.agent}` : '—' },
        { label: 'Puntaje Top 1', value: topAttByPoints ? formatScore(topAttByPoints.puntos) : '0' }
      ]);
      fillTable('table-att', 'empty-att', rankAtt.slice(0, 50), [
        { key: 'pos', value: r => String(r.pos) },
        { key: 'agent', value: r => r.agent },
        { key: 'ventasAtt', value: r => formatNumber(r.ventasAtt), className: 'num' },
        { key: 'ventasFrontier', value: r => formatNumber(r.ventasFrontier), className: 'num' },
        { key: 'ventasTotal', value: r => formatNumber(r.ventasTotal), className: 'num' },
        { key: 'puntos', value: r => formatScore(r.puntos), className: 'num' }
      ]);

    } catch (e) {
      console.error('[Rankings] Error:', e);
      const msg = e?.message || String(e);
      setMeta('meta-activation', `Error: ${msg}`);
      setMeta('meta-sales', `Error: ${msg}`);
      setMeta('meta-att', `Error: ${msg}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindTabs(){
    $all('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.tab;
        if (key) setActiveTab(key);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    try { setDefaultMonth(); } catch(_) {}
    bindTabs();
    bindActivationScopeToggle();
    setActivationScope('agent');

    const refreshBtn = document.getElementById('rankRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => refresh());

    const monthEl = document.getElementById('rankMonth');
    if (monthEl) monthEl.addEventListener('change', () => refresh());

    // load sidebar + data
    refresh();
  });
})();
