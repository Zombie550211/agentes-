const { MongoClient } = require('mongodb');

function parseArgs() {
  const args = require('minimist')(process.argv.slice(2));
  return {
    uri: args.uri || process.env.MONGO_URI,
    collection: args.collection || 'users'
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
  const { uri, collection } = parseArgs();
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
      console.log('[create_indexes] resolved SRV via', dnsServer, '-> using direct uri:', maskUri(finalConn));
    } catch (err) {
      console.warn('[create_indexes] SRV fallback failed:', err && err.message ? err.message : err);
    }
  }
  console.log('[create_indexes] using uri:', maskUri(finalConn));
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
    console.log('[indexes] creating index email:1 unique');
    try {
      await coll.createIndex({ email: 1 }, { unique: true, background: true });
      console.log('[indexes] email index created');
    } catch (err) {
      console.warn('[indexes] email index creation may have failed (duplicates?):', err.message);
    }
    console.log('[indexes] creating index role:1');
    await coll.createIndex({ role: 1 }, { background: true });
    console.log('[indexes] role index created');
  } catch (err) {
    console.error('[create_indexes] error', err && err.message ? err.message : err);
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || /querySrv/i.test(err.message || ''))) {
      console.error('[create_indexes] connection failed. Check your MONGO_URI and network/DNS. Example URIs:');
      console.error('  SRV (Atlas): mongodb+srv://user:pass@cluster0.mongodb.net/dbname');
      console.error('  Direct:     mongodb://user:pass@host:27017/dbname');
    }
  } finally {
    await client.close();
  }
})();
