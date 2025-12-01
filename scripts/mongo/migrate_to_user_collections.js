const { MongoClient } = require('mongodb');
const minimist = require('minimist');

function parseArgs() {
  const args = minimist(process.argv.slice(2));
  return {
    uri: args.uri || process.env.MONGO_URI,
    sourceCollection: args.collection || args.source || 'costumers',
    ownerField: args.ownerField || 'ownerId',
    prefix: args.prefix || 'costumers_',
    batchSize: parseInt(args.batchSize || '1000', 10),
    dryRun: !!(args.dry || args.dryRun),
    force: !!args.force
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

function sanitizeName(s) {
  if (s == null) return 'unknown';
  const str = String(s);
  return str.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
}

async function main() {
  const opts = parseArgs();
  const uri = ensureUriString(opts.uri);
  console.log('[migrate] uri:', maskUri(uri));
  console.log('[migrate] sourceCollection:', opts.sourceCollection, 'ownerField:', opts.ownerField, 'dryRun:', opts.dryRun, 'batchSize:', opts.batchSize);

  if (!uri) {
    console.error('[migrate] Missing MONGO URI. Provide with --uri or set MONGO_URI env var.');
    process.exit(2);
  }

  let finalConn = uri;
  const args = require('minimist')(process.argv.slice(2));
  const dnsServer = args.dnsServer || process.env.DNS_SERVER;
  if (dnsServer && uri.startsWith('mongodb+srv://')) {
    try {
      const { resolveSrvToDirectUri } = require('./srv_helper');
      finalConn = await resolveSrvToDirectUri(uri, dnsServer);
      console.log('[migrate] resolved SRV via', dnsServer, '-> using direct uri');
    } catch (err) {
      console.warn('[migrate] SRV fallback failed:', err && err.message ? err.message : err);
    }
  }
  const clientOptions = {};
  if (process.env.TLS_INSECURE === '1' || args.insecure) {
    clientOptions.tls = true;
    clientOptions.tlsAllowInvalidCertificates = true;
  }
  const client = new MongoClient(finalConn, clientOptions);
  try {
    await client.connect();
    const db = client.db();
    const src = db.collection(opts.sourceCollection);

    // Distinct owners
    const owners = await src.distinct(opts.ownerField, { [opts.ownerField]: { $exists: true, $ne: null } });
    console.log('[migrate] found owners count:', owners.length);

    for (const owner of owners) {
      const filter = { [opts.ownerField]: owner };
      const count = await src.countDocuments(filter);
      if (count === 0) continue;
      const sanitized = sanitizeName(owner);
      const targetName = `${opts.prefix}${sanitized}`;
      console.log(`\n[migrate] owner='${owner}' -> target='${targetName}' docs=${count}`);

      if (opts.dryRun) {
        console.log('[migrate] dry-run: would copy', count, 'docs to', targetName);
        continue;
      }

      // Copy in batches
      const cursor = src.find(filter).batchSize(opts.batchSize);
      let batch = [];
      let copied = 0;
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        // Keep original _id to preserve references
        batch.push(doc);
        if (batch.length >= opts.batchSize) {
          try {
            await db.collection(targetName).insertMany(batch, { ordered: false });
            copied += batch.length;
            console.log('[migrate] copied batch', copied);
          } catch (err) {
            if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
              console.warn('[migrate] duplicate(s) in batch ignored:', err.message ? err.message.split('\n')[0] : err);
            } else {
              throw err;
            }
          }
          batch = [];
        }
      }
      if (batch.length) {
        try {
          await db.collection(targetName).insertMany(batch, { ordered: false });
          copied += batch.length;
          console.log('[migrate] copied final batch', copied);
        } catch (err) {
          if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
            console.warn('[migrate] duplicate(s) in final batch ignored:', err.message ? err.message.split('\n')[0] : err);
          } else {
            throw err;
          }
        }
      }

      // Verify counts
      const targetCount = await db.collection(targetName).countDocuments();
      console.log('[migrate] verify targetCount=', targetCount);

      if (!opts.force) {
        console.log('[migrate] NOT removing source docs because --force not provided. To delete originals after verifying, re-run with --force');
      } else {
        const delRes = await src.deleteMany(filter);
        console.log('[migrate] deleted from source:', delRes.deletedCount);
      }
    }

    console.log('\n[migrate] finished');
  } catch (err) {
    console.error('[migrate] error', err && err.message ? err.message : err);
  } finally {
    await client.close();
  }
}

main();
