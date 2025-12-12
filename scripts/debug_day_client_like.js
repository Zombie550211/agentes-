const fetch = require('node-fetch');
const urlBase = process.env.URL_BASE || 'http://localhost:3000';

function pad2(n){ return String(n).padStart(2,'0'); }
function tryDateFrom(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [yy,mm,dd] = s.split('-').map(Number); return new Date(yy, mm-1, dd, 12, 0, 0); }
    if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(s)) { const [dd,mm,yy] = s.split(/[\/\-]/).map(Number); return new Date(yy, mm-1, dd, 12, 0, 0); }
  }
  const dt = new Date(val);
  return isNaN(dt) ? null : dt;
}
function onlyDigits(value) { return (value || '').toString().replace(/\D+/g,''); }
function sanitize(value) { return (value || '').toString().trim().toUpperCase(); }

async function run(){
  const date = process.argv[2] || '2025-12-10';
  const idToCheck = process.argv[3] || '693a15e144e19104feffa64d';
  const [y,m,d] = date.split('-');
  const start = `${y}-${m}-${d}`;
  const end = `${y}-${m}-${d}`;
  try {
    const login = await fetch(`${urlBase}/api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username: 'perf_tester', password: 'Password123!' })});
    let token = null;
    if (login.ok) { const j = await login.json(); token = j.token; }
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const url = `${urlBase}/api/leads?fechaInicio=${start}&fechaFin=${end}&skipDate=1`;
    console.log('Fetching', url);
    const r = await fetch(url, { headers });
    if (!r.ok) { console.error('Bad status', r.status); const t = await r.text(); console.error(t); return; }
    const j = await r.json();
    const leads = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : (Array.isArray(j.leads) ? j.leads : []));
    console.log('Total leads fetched:', leads.length);

    const createdPaths = ['dia_venta','diaVenta','fecha_contratacion','creadoEn','fecha_creacion','fechaCreacion','createdAt','created_at','createdon','createdOn','fecha'];
    const ymd = `${y}-${m}-${d}`;
    const dmyNoPad = `${Number(d)}/${Number(m)}/${y}`;
    const dmyPad = `${pad2(d)}/${pad2(m)}/${y}`;
    const engMonth = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m)-1];
    const engRegex = new RegExp(`\\b${engMonth}\\b\\s+${Number(d)}\\s+${y}`, 'i');
    const startLocal = new Date(Number(y), Number(m)-1, Number(d), 0, 0, 0, 0);
    const endExclusive = new Date(Number(y), Number(m)-1, Number(d) + 1, 0, 0, 0, 0);
    function sameLocalDay(dt) { return dt && dt >= startLocal && dt < endExclusive; }
    function isSameDayAny(val) {
      if (!val && val !== 0) return false;
      if (val instanceof Date) return sameLocalDay(val);
      if (typeof val === 'number') return sameLocalDay(new Date(val < 1e12 ? val*1000 : val));
      const s = String(val).trim();
      if (!s) return false;
      if (s === ymd || s === dmyNoPad || s === dmyPad) return true;
      if (engRegex.test(s)) return true;
      const dt = tryDateFrom(s);
      return sameLocalDay(dt);
    }

    const deduped = [];
    const dedupeMap = new Map();
    const groups = new Map();
    for (const lead of leads) {
      // find first created path
      let v;
      for (const p of createdPaths) { if (lead[p] !== undefined && lead[p] !== null && lead[p] !== '') { v = lead[p]; break; } }
      const inDay = isSameDayAny(v);
      const numeroCuenta = sanitize(lead.numero_cuenta || lead.numeroCuenta || lead.accountNumber);
      const telefono = onlyDigits(lead.telefono_principal || lead.telefono || lead.telefonoPrincipal);
      const diaVenta = sanitize(lead.dia_venta || lead.diaVenta || lead.fecha_contratacion || lead.fecha);
      const servicio = sanitize(lead.producto || lead.servicio || lead.servicios || lead.servicios_texto || lead.tipo_servicio || lead.tipo_servicios);
      let key;
      if (numeroCuenta || telefono || diaVenta || servicio) key = [numeroCuenta, telefono, diaVenta, servicio].filter(Boolean).join('|');
      else key = sanitize(lead._id || lead.id || JSON.stringify(lead));
      if (!inDay) {
        console.log(`SKIP (not in day) id=${lead._id || lead.id} key=${key} dia_venta=${lead.dia_venta} createdAt=${lead.createdAt}`);
        continue;
      }
      if (!key) { deduped.push(lead); continue; }
      const current = dedupeMap.get(key);
      if (!current) { dedupeMap.set(key, lead); groups.set(key, { kept: lead._id || lead.id, dropped: [] }); continue; }
      const scoreA = Number(current.puntaje || current.score || 0);
      const scoreB = Number(lead.puntaje || lead.score || 0);
      if (scoreB > scoreA) { dedupeMap.set(key, lead); groups.get(key).dropped.push(current._id || current.id); groups.get(key).kept = lead._id || lead.id; continue; }
      if (scoreB < scoreA) { groups.get(key).dropped.push(lead._id || lead.id); continue; }
      const dateA = new Date(current.fecha_creacion || current.creadoEn || current.createdAt || current.creado || 0).getTime() || 0;
      const dateB = new Date(lead.fecha_creacion || lead.creadoEn || lead.createdAt || lead.creado || 0).getTime() || 0;
      if (dateB >= dateA) { dedupeMap.set(key, lead); groups.get(key).dropped.push(current._id || current.id); groups.get(key).kept = lead._id || lead.id; }
      else { groups.get(key).dropped.push(lead._id || lead.id); }
    }

    for (const v of dedupeMap.values()) deduped.push(v);
    console.log('Deduped length:', deduped.length);
    // Print groups that had duplicates
    for (const [k, info] of groups.entries()) {
      if (!info || (!info.kept && (!info.dropped || info.dropped.length === 0))) continue;
      console.log('Group dup key:', k, 'kept:', info.kept, 'dropped:', (info.dropped || []).join(','));
    }
    const exists = deduped.some(l => String(l._id || l.id || '') === idToCheck);
    console.log('Lead included in dedupedDay?', exists);
    if (!exists) {
      // Find if present in fetched but excluded by dedupe
      const found = leads.find(l => String(l._id || l.id || '') === idToCheck);
      if (found) {
        console.log('Lead fetched but excluded. Detail:');
        console.log(JSON.stringify(found, null, 2));
      } else {
        console.log('Lead not found in fetched results.');
      }
    } else {
      console.log('Lead present in deduped set.');
    }

    // If present in deduped: print minimal info
    const entry = deduped.find(l => String(l._id || l.id || '') === idToCheck);
    if (entry) console.log('Entry:', { _id: entry._id, dia_venta: entry.dia_venta, createdAt: entry.createdAt, numero_cuenta: entry.numero_cuenta, telefono: entry.telefono || entry.telefono_principal, agente: entry.agente || entry.agenteNombre, status: entry.status });

    // If target was dropped, print info about the key and which id was kept
    for (const [k, info] of groups.entries()) {
      if (info && Array.isArray(info.dropped) && info.dropped.includes(idToCheck)) {
        console.log(`Target ${idToCheck} was dropped in key ${k}. Kept id: ${info.kept}`);
        const keptLead = leads.find(l => String(l._id || l.id || '') === info.kept);
        if (keptLead) console.log('Kept entry detail:', { _id: keptLead._id, agente: keptLead.agente || keptLead.agenteNombre, creadoEn: keptLead.creadoEn || keptLead.fecha_creacion || keptLead.createdAt, fecha_contratacion: keptLead.fecha_contratacion || keptLead.dia_venta || keptLead.fecha, numero_cuenta: keptLead.numero_cuenta, telefono: keptLead.telefono || keptLead.telefono_principal, status: keptLead.status });
      }
    }

  } catch (e) { console.error(e); }
}

run();
