const fetch = require('node-fetch');
(async()=>{
  try {
    const login = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username: 'perf_tester', password: 'Password123!' }) });
    const lj = await login.json();
    const token = lj.token;
    const id = process.argv[2] || '693a15e144e19104feffa64d';
    const url = `http://localhost:3000/api/leads?_id=${id}`;
    console.log('[DEBUG] fetching', url);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
  } catch(e) {
    console.error(e);
  }
})();
