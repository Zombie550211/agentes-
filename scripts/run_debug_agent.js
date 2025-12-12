const fetch = require('node-fetch');
const urlBase = process.env.URL_BASE || 'http://localhost:3000';

async function run() {
  const username = process.env.PERF_USER || 'perf_tester';
  const password = process.env.PERF_PASS || 'Password123!';
  console.log('[DEBUG-AGENT] Using base URL', urlBase);

  let token = null;
  try {
    // Try to login
    const resLogin = await fetch(`${urlBase}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' } });
    if (resLogin.ok) {
      const j = await resLogin.json();
      token = j.token;
      console.log('[DEBUG-AGENT] Logged in, token obtained');
    } else {
      // try register
      try {
        await fetch(`${urlBase}/api/auth/register`, { method: 'POST', body: JSON.stringify({ username, password, role: 'admin' }), headers: { 'Content-Type': 'application/json' } });
      } catch (e) { /* ignore */ }
      const resLogin2 = await fetch(`${urlBase}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' } });
      if (resLogin2.ok) {
        const j = await resLogin2.json();
        token = j.token;
        console.log('[DEBUG-AGENT] Registered and logged in, token obtained');
      } else {
        console.warn('[DEBUG-AGENT] Could not obtain token; proceeding without auth');
      }
    }
  } catch (e) {
    console.warn('[DEBUG-AGENT] Auth error', e);
  }

  const header = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const fechaInicio = `${y}-${m}-01`;
  const fechaFin = `${y}-${m}-${d}`;

  const agents = ['Julio Chavez', 'Kimberly Iglesias', 'Alexander Rivera'];
  for (const agent of agents) {
    const enc = encodeURIComponent(agent);
    const url = `${urlBase}/api/ranking/debug-agent?name=${enc}&fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&all=1`;
    console.log('\n[DEBUG-AGENT] Requesting for', agent, url);
    try {
      const r = await fetch(url, { headers: header });
      if (!r.ok) {
        console.warn('[DEBUG-AGENT] HTTP', r.status);
        const txt = await r.text();
        console.warn('[DEBUG-AGENT] Body:', txt);
        continue;
      }
      const json = await r.json();
      console.log('[DEBUG-AGENT] Result for', agent, 'totals=', json.totals);
      if (Array.isArray(json.debugCollections)) {
        for (const c of json.debugCollections) {
          console.log(`  - ${c.collection}: count=${c.count}, ventas=${c.ventas}, cancels=${c.cancels}, sum=${c.sum}`);
          (c.docs || []).slice(0,3).forEach(d => {
            console.log(`      doc _id=${d._id && (d._id.$oid || d._id) ? (d._id.$oid ? d._id.$oid : d._id) : ''} numero_cuenta=${d.numero_cuenta || ''} telefono=${d.telefono || d.telefono_principal || ''} nombre_cliente=${d.nombre_cliente || ''} dia_venta=${d.dia_venta || ''} puntaje=${d.puntaje || d.Puntaje || ''}`);
          });
        }
      }

      // Check duplicate doc IDs across collections
      const idMap = new Map();
      (json.debugCollections || []).forEach(c => {
        (c.docs || []).forEach(d => {
          const id = d._id && (d._id.$oid || d._id) ? (d._id.$oid ? d._id.$oid : d._id) : JSON.stringify(d);
          const list = idMap.get(id) || [];
          list.push(c.collection);
          idMap.set(id, list);
        });
      });
      const dupes = Array.from(idMap.entries()).filter(([k, v]) => v.length > 1);
      if (dupes.length) {
        console.log('[DEBUG-AGENT] Duplicate doc IDs across collections found:');
        dupes.forEach(([id, colls]) => console.log(`  - ${id}: ${colls.join(', ')}`));
      } else {
        console.log('[DEBUG-AGENT] No duplicate doc IDs across checked collections');
      }

    } catch (e) {
      console.warn('[DEBUG-AGENT] Request failed for', agent, e);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n[DEBUG-AGENT] Now fetching aggregated /api/ranking with all=1 to compare results');
  const rUrl = `${urlBase}/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&all=1&limit=500&debug=1`;
  try {
    const r = await fetch(rUrl, { headers: header });
    if (!r.ok) {
      console.warn('[DEBUG-AGENT] ranking HTTP', r.status);
      const t = await r.text();
      console.warn('[DEBUG-AGENT] body', t.slice(0,400));
    } else {
      const json = await r.json();
      const arr = Array.isArray(json.ranking) ? json.ranking : [];
      console.log('[DEBUG-AGENT] /api/ranking returned', arr.length, 'items');
      agents.forEach(a => {
        const match = arr.find(it => (it.nombre || '').toLowerCase().includes(a.toLowerCase().split(' ')[0]));
        if (match) console.log('  - Ranking match for', a, ': puntos=', match.puntos, 'ventas=', match.ventas, 'name=', match.nombre);
        else console.log('  - no ranking item for', a);
      });
      // print top 6
      console.log('[DEBUG-AGENT] Top 6:');
      arr.slice(0,6).forEach((it, idx) => console.log(`   ${idx+1}. ${it.nombre} pts=${it.puntos} ventas=${it.ventas} origins=${it.originCollections}`));
    }
  } catch(e) { console.warn('[DEBUG-AGENT] ranking request failed', e); }

  console.log('\n[DEBUG-AGENT] Complete');
}

run().catch(e => { console.error(e); process.exit(1); });
