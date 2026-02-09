// dashboard.js - KPIs de Inicio (ventas, puntos, mejor team, mejor vendedor)
 (function(){
  'use strict';

  function authHeaders(){
    const h = { 'Accept': 'application/json' };
    const t = localStorage.getItem('token') || sessionStorage.getItem('token');
    if(t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  async function getCurrentUser(){
    try{
      const r = await fetch('/api/auth/verify-server', { credentials: 'include', headers: authHeaders() });
      if(!r.ok) throw new Error('auth verify failed');
      const j = await r.json();
      return j?.user || j;
    }catch(e){ console.warn('[dashboard] user fallback:', e?.message); return {}; }
  }

  function normStr(v){ return (v==null?'':String(v)).trim(); }
  function toNum(x){ const n = Number(x); return isFinite(n)? n : 0; }

  async function fetchMonthLeads(){
    // /api/leads ya filtra por mes actual por defecto (para todos los roles)
    try{
      const user = await getCurrentUser();
      const uname = (user?.username||'').toString().trim();
      const role = (user?.role||'').toString().trim().toLowerCase();
      // 1) intento base
      const useAgentParam = ['agente','agent'].includes(role);
      const r = await fetch('/api/leads' + (useAgentParam && uname?`?agente=${encodeURIComponent(uname)}`:''), { credentials: 'include', headers: authHeaders() });
      if(!r.ok) throw new Error('leads fetch error');
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : (Array.isArray(j?.leads) ? j.leads : []));
      if(arr.length){ console.log('[dashboard] leads mes actual:', arr.length); return arr; }
      // Fallback: intentar sin filtro de fecha (diagnóstico)
      const r2 = await fetch('/api/leads?skipDate=1' + (uname?`&agente=${encodeURIComponent(uname)}`:''), { credentials: 'include', headers: authHeaders() });
      if(r2.ok){ const j2 = await r2.json(); const arr2 = Array.isArray(j2)?j2:(Array.isArray(j2?.data)?j2.data:(Array.isArray(j2?.leads)?j2.leads:[])); console.warn('[dashboard] fallback skipDate=1, leads:', arr2.length); return arr2; }
      return arr;
    }catch(e){ console.error('[dashboard] fetchMonthLeads error:', e?.message); return []; }
  }

  async function fetchRankingTop(){
    try{
      const r = await fetch('/api/ranking?all=1&limit=50', { credentials: 'include', headers: authHeaders() });
      if(!r.ok) throw new Error('ranking fetch error');
      const j = await r.json();
      const arr = Array.isArray(j?.ranking) ? j.ranking : (Array.isArray(j?.data?.ranking) ? j.data.ranking : []);
      return arr;
    }catch(e){ console.warn('[dashboard] ranking fallback:', e?.message); return []; }
  }

  function pickBestSellerFromRanking(r){
    return (Array.isArray(r) && r[0] && r[0].nombre) ? r[0].nombre : '-';
  }

  function pickBestTeam(leads){
    const byTeam = new Map();
    for(const l of leads){
      const team = normStr(l.team || l.Team || l.supervisor || l.Supervisor || '');
      if(!team) continue;
      byTeam.set(team, (byTeam.get(team) || 0) + 1);
    }
    let best = { name: '-', count: -Infinity };
    for(const [name, c] of byTeam){ if(c > best.count){ best = { name, count: c }; } }
    return best.name || '-';
  }

  function updateText(id, value){ const el = document.getElementById(id); if(el) el.textContent = value; }

  function buildProductsDataset(leads){
    const m = new Map();
    leads.forEach(l=>{
      const label = normStr(l.servicios_texto || l.tipo_servicios || l.servicios || l.producto || 'Otro');
      const key = label || 'Otro';
      m.set(key, (m.get(key)||0)+1);
    });
    return { labels: Array.from(m.keys()), data: Array.from(m.values()) };
  }

  function buildTeamsDataset(leads){
    const m = new Map();
    leads.forEach(l=>{
      const key = normStr(l.team || l.Team || l.supervisor || 'Sin equipo') || 'Sin equipo';
      m.set(key, (m.get(key)||0)+1);
    });
    return { labels: Array.from(m.keys()), data: Array.from(m.values()) };
  }

  function drawCharts(leads){
    if(typeof Chart === 'undefined') { console.warn('[dashboard] Chart.js no disponible'); return; }
    // Preparar cache global de charts
    if(!window.__dashboardCharts) window.__dashboardCharts = { products:null, teams:null };
    const prod = buildProductsDataset(leads);
    const teams = buildTeamsDataset(leads);
    try{
      const ctx1 = document.getElementById('productsChart');
      if(ctx1){
        // Destruir instancia previa si existe
        try{ if(window.__dashboardCharts.products){ window.__dashboardCharts.products.destroy(); } }catch(_){ }
        const inst1 = new Chart(ctx1, {
          type: 'bar',
          data: { labels: prod.labels, datasets: [{ label: 'Productos', data: prod.data, backgroundColor: '#6366f1' }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
        window.__dashboardCharts.products = inst1;
      }
    }catch(e){ console.warn('[dashboard] error chart productos:', e?.message); }
    try{
      const ctx2 = document.getElementById('teamsChart');
      if(ctx2){
        try{ if(window.__dashboardCharts.teams){ window.__dashboardCharts.teams.destroy(); } }catch(_){ }
        const inst2 = new Chart(ctx2, {
          type: 'doughnut',
          data: { labels: teams.labels, datasets: [{ data: teams.data, backgroundColor: ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#94a3b8'] }] },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
        window.__dashboardCharts.teams = inst2;
      }
    }catch(e){ console.warn('[dashboard] error chart teams:', e?.message); }
  }

  let __loading = false;
  async function loadKPIs(){
    if(__loading){ return; }
    __loading = true;
    try{
      const [user, leads, ranking] = await Promise.all([ getCurrentUser(), fetchMonthLeads(), fetchRankingTop() ]);
      const role = (user?.role||'').toString().trim().toLowerCase();
      const isAgent = ['agente','agent'].includes(role);

      let totalPoints = 0;
      // Solo agentes: actualizar KPIs propios. Para admins/BO/supervisor, Inicio maneja los totales.
      if (isAgent) {
        updateText('month-sales-count', String(leads.length));
        totalPoints = leads.reduce((acc,l)=> acc + toNum(l.puntaje || l.Puntaje || l.points || l.score || 0), 0);
        updateText('month-points-total', totalPoints.toFixed(2));
        const bestTeam = pickBestTeam(leads);
        updateText('best-team-name', bestTeam || '-');
        updateText('best-seller-name', pickBestSellerFromRanking(ranking));
      }

      console.log('[dashboard] KPIs cargados:', { ventas: leads.length, puntos: totalPoints });
    }catch(e){ console.error('[dashboard] Error cargando KPIs:', e); }
    finally { __loading = false; }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', loadKPIs);
  } else {
    loadKPIs();
  }

  document.addEventListener('user:authenticated', loadKPIs);
  window.loadKPIs = loadKPIs;
})();
