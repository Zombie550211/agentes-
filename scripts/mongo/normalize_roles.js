const { MongoClient } = require('mongodb');

const ROLE_MAP = {
  // lowercased input -> canonical role
  'admin': 'Administrador',
  'administrador': 'Administrador',
  'administrator': 'Administrador',
  'backoffice': 'Backoffice',
  'back-office': 'Backoffice',
  'supervisor': 'Supervisor',
  'agente': 'Agente',
  'agent': 'Agente'
};

const PERMISSIONS_MAP = {
  'Administrador': ['ALL'],
  'Backoffice': ['LEADS_READ', 'LEADS_WRITE'],
  'Supervisor': ['TEAM_READ', 'TEAM_WRITE'],
  'Agente': ['LEADS_READ']
};

function parseArgs() {
  const args = require('minimist')(process.argv.slice(2));
  return {
    uri: args.uri || process.env.MONGO_URI,
    collection: args.collection || 'users',
    dryRun: args.dry || args.dryRun || false
  };
}

function ensureUriString(uri) {
  if (typeof uri === 'string') return uri;
  if (Array.isArray(uri) && uri.length > 0) return String(uri[0]);
  if (uri == null) return '';
  return String(uri);
}

function maskUri(uri) {
  try {
    if (!uri) return '<empty>';
    const s = String(uri);
    return s.length > 20 ? s.slice(0, 12) + '...(' + s.length + ' chars)' : s;
  } catch (e) {
    return '<unprintable>';
  }
}

(async function main(){
  const { uri, collection, dryRun } = parseArgs();
  if (!uri) {
    console.error('Missing MONGO URI. Provide --uri or set MONGO_URI');
    process.exit(2);
  }
  const connStr = ensureUriString(uri);
  let finalConn = connStr;
  const args = require('minimist')(process.argv.slice(2));
  const dnsServer = args.dnsServer || process.env.DNS_SERVER;
  if (dnsServer && connStr.startsWith('mongodb+srv://')) {
    try {
      const { resolveSrvToDirectUri } = require('./srv_helper');
      finalConn = await resolveSrvToDirectUri(connStr, dnsServer);
      console.log('[normalize_roles] resolved SRV via', dnsServer, '-> using direct uri:', maskUri(finalConn));
    } catch (err) {
      console.warn('[normalize_roles] SRV fallback failed:', err && err.message ? err.message : err);
    }
  }
  console.log('[normalize_roles] using uri:', maskUri(finalConn));
  const clientOptions = {};
  if (process.env.TLS_INSECURE === '1' || args.insecure) {
    clientOptions.tls = true;
    clientOptions.tlsAllowInvalidCertificates = true;
  }
  const client = new MongoClient(finalConn, clientOptions);
  try {
    await client.connect();
    const db = client.db();
    const coll = db.collection(collection);
    const cursor = coll.find({ role: { $exists: true } });
    let changed = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const current = (doc.role || '').toString().trim();
      const key = current.toLowerCase();
      const canonical = ROLE_MAP[key];
      if (!canonical) continue;
      const newPermissions = PERMISSIONS_MAP[canonical] || [];
      const patch = { role: canonical, permissions: newPermissions };
      if (dryRun) {
        console.log('[dry] would update', doc._id.toString(), 'from', doc.role, '->', canonical);
      } else {
        const res = await coll.updateOne({ _id: doc._id }, { $set: patch });
        if (res.modifiedCount) {
          changed++;
          console.log('[update] ', doc._id.toString(), '->', canonical);
        }
      }
    }
    console.log('[normalize_roles] done. changed:', changed);
  } catch (err) {
    console.error('[normalize_roles] error', err && err.message ? err.message : err);
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || /querySrv/i.test(err.message || ''))) {
      console.error('[normalize_roles] connection failed. Check your MONGO_URI and network/DNS. Example URIs:');
      console.error('  SRV (Atlas): mongodb+srv://user:pass@cluster0.mongodb.net/dbname');
      console.error('  Direct:     mongodb://user:pass@host:27017/dbname');
    }
  } finally {
    await client.close();
  }
})();
