const dns = require('dns').promises;
const { URL } = require('url');

function parseTxtRecords(txtRecords) {
  // txtRecords is array of arrays or strings depending on resolver
  try {
    const flat = txtRecords.map(r => Array.isArray(r) ? r.join('') : String(r)).join('');
    // TXT from Atlas often looks like: "authSource=admin&replicaSet=...&tls=true"
    const pairs = flat.split(/&|;/).map(s => s.trim()).filter(Boolean);
    const res = {};
    for (const p of pairs) {
      const idx = p.indexOf('=');
      if (idx === -1) continue;
      const k = decodeURIComponent(p.slice(0, idx));
      const v = decodeURIComponent(p.slice(idx + 1));
      res[k] = v;
    }
    return res;
  } catch (e) {
    return {};
  }
}

function parseSrvHost(uri) {
  // uri: mongodb+srv://user:pass@host/db?opts
  try {
    const m = uri.match(/^mongodb\+srv:\/\/(?:[^@]+@)?([^/\?]+)(?:\/([^\?]*))?(\?.*)?$/i);
    if (!m) return null;
    return { host: m[1], db: m[2] || '', opts: m[3] || '' };
  } catch (e) { return null; }
}

async function resolveSrvToDirectUri(uri, dnsServer) {
  if (!uri || !uri.startsWith('mongodb+srv://')) return uri;
  const parsed = parseSrvHost(uri);
  if (!parsed) return uri;
  const { host, db, opts } = parsed;

  const resolver = new dns.Resolver();
  if (dnsServer) resolver.setServers([dnsServer]);

  const srvName = `_mongodb._tcp.${host}`;
  const records = await resolver.resolveSrv(srvName);
  if (!records || records.length === 0) throw new Error('No SRV records');

  // Build host:port list preserving hostnames
  const hosts = records.map(r => `${r.name}:${r.port}`);

  // Extract credentials and path/options from original uri
  // Use URL to parse userinfo and query
  let userinfo = '';
  try {
    const fake = uri.replace('mongodb+srv://', 'mongodb://');
    const u = new URL(fake);
    if (u.username) {
      userinfo = u.username;
      if (u.password) userinfo += `:${u.password}`;
      userinfo += '@';
    }
  } catch (e) {
    // ignore
  }

  // Merge TXT options (if present) with opts from original uri
  let txtOpts = {};
  try {
    const txt = await resolver.resolveTxt(host);
    txtOpts = parseTxtRecords(txt || []);
  } catch (e) {
    // ignore missing TXT
    txtOpts = {};
  }

  // parse opts (query string) from original
  const urlOpts = {};
  if (opts && opts.startsWith('?')) {
    const q = opts.slice(1);
    q.split('&').forEach(pair => {
      const [k, v] = pair.split('='); if (!k) return; urlOpts[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
  }

  // Merge preference: urlOpts (explicit in URI) > txtOpts (from TXT)
  const merged = Object.assign({}, txtOpts, urlOpts);
  const queryPairs = Object.keys(merged).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(merged[k])}`);
  const optsPart = queryPairs.length ? `?${queryPairs.join('&')}` : '';
  const dbPart = db ? `/${db}` : '';
  const direct = `mongodb://${userinfo}${hosts.join(',')}${dbPart}${optsPart}`;
  return direct;
}

module.exports = { resolveSrvToDirectUri };
