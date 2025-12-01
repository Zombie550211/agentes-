const { MongoClient } = require('mongodb');

function parseArgs() {
  const args = require('minimist')(process.argv.slice(2));
  return {
    uri: args.uri || process.env.MONGO_URI,
    collection: args.collection || 'users',
    key: args.key || 'email',
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
  const { uri, collection, key, dryRun } = parseArgs();
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
      console.log('[dedupe] resolved SRV via', dnsServer, '-> using direct uri:', maskUri(finalConn));
    } catch (err) {
      console.warn('[dedupe] SRV fallback failed:', err && err.message ? err.message : err);
    }
  }
  console.log('[dedupe] using uri:', maskUri(finalConn));
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
    console.log('[dedupe] scanning', collection, 'by key', key);
    // Aggregate duplicates
    const pipeline = [
      { $match: { [key]: { $exists: true, $ne: null } } },
      { $group: { _id: `$${key}`, ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ];
    const cursor = coll.aggregate(pipeline, { allowDiskUse: true });
    let totalRemoved = 0;
    while (await cursor.hasNext()) {
      const group = await cursor.next();
      const ids = group.ids;
      // keep the first id, remove rest
      const keep = ids[0];
      const remove = ids.slice(1);
      if (dryRun) {
        console.log('[dry] would remove', remove.length, 'docs for', group._id);
      } else {
        const res = await coll.deleteMany({ _id: { $in: remove } });
        console.log('[removed]', res.deletedCount, 'duplicates for', group._id.toString());
        totalRemoved += res.deletedCount || 0;
      }
    }
    console.log('[dedupe] done. totalRemoved:', totalRemoved);
  } catch (err) {
    console.error('[dedupe] error', err && err.message ? err.message : err);
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || /querySrv/i.test(err.message || ''))) {
      console.error('[dedupe] connection failed. Check your MONGO_URI and network/DNS. Example URIs:');
      console.error('  SRV (Atlas): mongodb+srv://user:pass@cluster0.mongodb.net/dbname');
      console.error('  Direct:     mongodb://user:pass@host:27017/dbname');
    }
  } finally {
    await client.close();
  }
})();
