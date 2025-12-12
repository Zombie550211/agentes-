/*
Simple perf test for /api/ranking endpoints
Usage: node scripts/perf_test_ranking.js
It will measure average response times for top3/month/all+month (debug=1) requests.
Requires server running at http://localhost:3000 and that you are logged in or cookies are not required.
*/

const fetch = require('node-fetch');
const urlBase = process.env.URL_BASE || 'http://localhost:3000';

function t() { return Date.now(); }

async function run() {
  console.log('\n[PERF] Running performance tests on', urlBase);
  // Ensure we have a token for authenticated endpoints
  let token = null;
  try {
    const username = process.env.PERF_USER || 'perf_tester';
    const password = process.env.PERF_PASS || 'Password123!';
    // Try register (ignore if exists)
    try {
      await fetch(`${urlBase}/api/auth/register`, { method: 'POST', body: JSON.stringify({ username, password, role: 'admin' }), headers: { 'Content-Type': 'application/json' } });
    } catch (e) {}
    // Login
    const resLogin = await fetch(`${urlBase}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }), headers: { 'Content-Type': 'application/json' } });
    if (resLogin.ok) {
      const data = await resLogin.json();
      token = data?.token || null;
      if (token) console.log('[PERF] Auth token obtained');
    } else {
      console.log('[PERF] Could not login (status ' + resLogin.status + ') — endpoints will likely 401');
    }
  } catch (e) { console.warn('[PERF] Auth error', e); }

  // Helper that times a fetch
  async function timeFetch(url, opts = {}) {
    const start = t();
    try {
      const headers = (opts.headers || {});
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { method: 'GET', headers });
      const text = await res.text();
      const end = t();
      return { ok: res.ok, status: res.status, ms: end - start, size: text.length, text };
    } catch (e) {
      const end = t();
      return { ok: false, status: 0, ms: end - start, size: 0, err: String(e) };
    }
  }

  // Top3 (without all) - 5 runs
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const fechaInicio = `${y}-${m}-01`;
  const fechaFin = `${y}-${m}-${d}`;

  console.log('\n[PERF] Testing top3 (no all)');
  let sums = 0, count = 0;
  for (let i = 0; i < 5; i++) {
    const url = `${urlBase}/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&limit=50&t=${Date.now()}`;
    const r = await timeFetch(url);
    console.log(`  Run ${i+1}: time=${r.ms}ms, ok=${r.ok}, status=${r.status}, size=${r.size}`);
    sums += r.ms; count++;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  console.log(`  Avg: ${(sums / count).toFixed(1)}ms`);

  // By month (no all) - 5 runs
  console.log('\n[PERF] Testing month (no all) limit=100');
  sums = 0; count = 0;
  for (let i = 0; i < 5; i++) {
    const url = `${urlBase}/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&limit=100&t=${Date.now()}`;
    const r = await timeFetch(url);
    console.log(`  Run ${i+1}: time=${r.ms}ms, ok=${r.ok}, status=${r.status}, size=${r.size}`);
    sums += r.ms; count++;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  console.log(`  Avg: ${(sums / count).toFixed(1)}ms`);

  // Month with all=1 and debug=1 - 3 runs
  console.log('\n[PERF] Testing month with all=1 (debug=1)');
  sums = 0; count = 0;
  for (let i = 0; i < 3; i++) {
    const url = `${urlBase}/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&all=1&limit=500&debug=1&t=${Date.now()}`;
    const r = await timeFetch(url);
    console.log(`  Run ${i+1}: time=${r.ms}ms, ok=${r.ok}, status=${r.status}, size=${r.size}`);
    if (r.ok) {
      try {
        const obj = JSON.parse(r.text);
        console.log('    meta.attempts:', (obj.meta && obj.meta.attempts) ? obj.meta.attempts.map(x=>({collection:x.collection,count:x.count})) : 'no meta.attempts');
        console.log('    meta.count:', obj.meta && obj.meta.count);
      } catch(e) { }
    }
    sums += r.ms; count++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log(`  Avg: ${(sums / count).toFixed(1)}ms`);

  // Test all=1 without debug to see cache effect
  console.log('\n[PERF] Testing month with all=1 (no debug)');
  sums = 0; count = 0;
  for (let i = 0; i < 3; i++) {
    const url = `${urlBase}/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&all=1&limit=500`;
    const r = await timeFetch(url);
    console.log(`  Run ${i+1}: time=${r.ms}ms, ok=${r.ok}, status=${r.status}, size=${r.size}`);
    sums += r.ms; count++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log(`  Avg: ${(sums / count).toFixed(1)}ms`);

  // Test cache hit: call the same URL twice (no `t`) to verify server-side cache
  console.log('\n[PERF] Testing month with all=1 (cache verification) — same request twice');
  try {
    const urlCached = `${urlBase}/api/ranking?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&all=1&limit=500`;
    const first = await timeFetch(urlCached);
    console.log(`  First (populate cache): time=${first.ms}ms, ok=${first.ok}, status=${first.status}`);
    const second = await timeFetch(urlCached);
    console.log(`  Second (should hit cache): time=${second.ms}ms, ok=${second.ok}, status=${second.status}`);
  } catch(e){ console.warn('[PERF] Cache verification failed', e); }

  console.log('\n[PERF] Completed tests');
}

run().catch(e => console.error(e));
