const fetch = require('node-fetch');
const urlBase = process.env.URL_BASE || 'http://localhost:3000';

async function run(){
  const username = process.env.PERF_USER || 'perf_tester';
  const password = process.env.PERF_PASS || 'Password123!';

  let token = null;
  try{
    const resLogin = await fetch(`${urlBase}/api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username, password }) });
    if (resLogin.ok){ const j = await resLogin.json(); token = j.token; }
  }catch(e){ /* ignore */ }

  const header = token ? { 'Authorization': `Bearer ${token}` } : {};

  const agent = process.argv[2] || 'Roxana Martinez';
  const date = process.argv[3] || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const url = `${urlBase}/api/leads?fechaInicio=${date}&fechaFin=${date}&limit=5000&skipDate=1`;
  console.log('[DEBUG-LEADS] Fetching', url, 'for agent', agent);
  try{
    const r = await fetch(url, { headers: Object.assign({ 'Content-Type':'application/json' }, header) });
    const j = await r.json();
    const leads = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : (Array.isArray(j.leads) ? j.leads : []));
    console.log('[DEBUG-LEADS] total leads returned:', leads.length);
    // Filter by agent name matching 
    const hits = leads.filter(l => (l.agenteNombre || l.agente || '').toLowerCase().includes(agent.toLowerCase()));
    console.log(`[DEBUG-LEADS] filtered for ${agent}:`, hits.length);
    hits.forEach(h => console.log(`  - _id=${h._id} agenteNombre=${h.agenteNombre} dia_venta=${h.dia_venta} createdAt=${h.createdAt} puntaje=${h.puntaje} status=${h.status}`));
    // if not found, print some leads that could be Roxana with different fields
    if (hits.length === 0) {
      const fuzzy = leads.filter(l => String(l.nombre_cliente || l.customerName || '').toLowerCase().includes(agent.split(' ')[0].toLowerCase()));
      console.log('[DEBUG-LEADS] fuzzy matches:', fuzzy.length);
      fuzzy.slice(0,10).forEach(h => console.log(`    fuzzy _id=${h._id} agente=${h.agenteNombre} cliente=${h.nombre_cliente} dia_venta=${h.dia_venta}`));
    }
  }catch(e){ console.error('[DEBUG-LEADS] Error', e); }
}
run().catch(e=>console.error(e));
