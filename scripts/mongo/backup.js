const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = require('minimist')(process.argv.slice(2));
  return {
    uri: args.uri || process.env.MONGO_URI,
    collections: args.collections ? args.collections.split(',') : (args.collection ? [args.collection] : []),
    outDir: args.outDir || path.join(__dirname, '..', '..', 'backups')
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
  const { uri, collections, outDir } = parseArgs();
  if (!uri) {
    console.error('Missing MONGO URI. Provide --uri or set MONGO_URI');
    process.exit(2);
  }
  if (!collections || collections.length === 0) {
    console.error('Please provide --collections or --collection (comma separated)');
    process.exit(2);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const connStr = ensureUriString(uri);
  let finalConn = connStr;
  // support --dnsServer to resolve SRV and fallback to direct mongodb:// string
  const args = require('minimist')(process.argv.slice(2));
  const dnsServer = args.dnsServer || process.env.DNS_SERVER;
  if (dnsServer && connStr.startsWith('mongodb+srv://')) {
    try {
      const { resolveSrvToDirectUri } = require('./srv_helper');
      finalConn = await resolveSrvToDirectUri(connStr, dnsServer);
      console.log('[backup] resolved SRV via', dnsServer, '-> using direct uri:', maskUri(finalConn));
    } catch (err) {
      console.warn('[backup] SRV fallback failed:', err && err.message ? err.message : err);
    }
  }
  console.log('[backup] using uri:', maskUri(finalConn));
  const clientOptions = {};
  if (process.env.TLS_INSECURE === '1' || args.insecure) {
    clientOptions.tls = true;
    clientOptions.tlsAllowInvalidCertificates = true;
  }
  const client = new MongoClient(finalConn, clientOptions);
  try {
    await client.connect();
    const db = client.db();
    for (const collName of collections) {
      console.log('[backup] exporting', collName);
      const coll = db.collection(collName);
      const docs = await coll.find({}).toArray();
      const file = path.join(outDir, `${collName}.${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(docs, null, 2), 'utf8');
      console.log('[backup] wrote', file, 'documents:', docs.length);
    }
    console.log('[backup] completed');
  } catch (err) {
    console.error('[backup] error', err && err.message ? err.message : err);
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || /querySrv/i.test(err.message || ''))) {
      console.error('[backup] connection failed. Check your MONGO_URI and network/DNS. Example URIs:');
      console.error('  SRV (Atlas): mongodb+srv://user:pass@cluster0.mongodb.net/dbname');
      console.error('  Direct:     mongodb://user:pass@host:27017/dbname');
    }
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
