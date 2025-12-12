const fetch = require('node-fetch');
const urlBase = process.env.URL_BASE || 'http://localhost:3000';

async function run(){
  const date = process.argv[2] || '2025-12-10';
  const url = `${urlBase}/api/equipos/estadisticas?fechaInicio=${date}&fechaFin=${date}&scope=day&forceAll=1`;
  console.log('[DEBUG-DAY-STATS] Fetching', url);
  try {
    const t = await fetch(`${urlBase}/api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username: 'perf_tester', password: 'Password123!' })});
    let token = null; if (t.ok) { const j = await t.json(); token = j.token; }
    const headers = token ? { 'Authorization' : `Bearer ${token}` } : {};
    const r = await fetch(url, { headers });
    const j = await r.json();
    console.log('Status:', r.status, 'OK?', r.ok);
    console.log('Has success:', j && j.success);
    if (j && j.success) {
      console.log('Teams:', (j.data || []).map(t => ({ name: t.TEAM || t.team, Total: t.Total, ACTIVAS: t.ACTIVAS, Puntaje: t.Puntaje }))); 
      console.log('Lineas:', (j.lineas || []).map(l => ({ name: l.name || l.TEAM, ICON: l.ICON }))); 
    } else {
      console.log('Response:', j);
    }
  } catch(e) { console.error(e); }
}
run();
