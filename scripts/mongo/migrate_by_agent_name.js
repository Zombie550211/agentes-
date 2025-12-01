const { MongoClient } = require('mongodb');
const minimist = require('minimist');
const { resolveSrvToDirectUri } = require('./srv_helper');

function sanitizeName(s) {
  if (!s) return 'unknown';
  return String(s).trim().replace(/[^a-zA-Z0-9\s\-_.]/g, '').replace(/\s+/g, '_').replace(/__+/g, '_').slice(0, 90);
}

function parseArgs() {
  const args = minimist(process.argv.slice(2));
  return {
    uri: args.uri || process.env.MONGO_URI || process.env.MONGODB_URI,
    sourceCollections: (args.collections || args.collection || 'costumers,leads').split(',').map(s=>s.trim()).filter(Boolean),
    nameField: args.nameField || 'agenteNombre',
    prefix: args.prefix || 'costumers_',
    batchSize: parseInt(args.batchSize || '1000', 10),
    dryRun: !!(args.dry || args.dryRun),
    force: !!args.force,
    dnsServer: args.dnsServer || process.env.DNS_SERVER || null
  };
}

async function main() {
  const opts = parseArgs();
  if (!opts.uri) {
    console.error('Missing MONGO URI. Provide --uri or set MONGO_URI');
    process.exit(2);
  }

  let finalUri = opts.uri;
  if (opts.dnsServer && finalUri.startsWith('mongodb+srv://')) {
    try {
      finalUri = await resolveSrvToDirectUri(finalUri, opts.dnsServer);
      console.log('[migrate_by_name] resolved SRV via', opts.dnsServer);
    } catch (e) {
      console.warn('[migrate_by_name] SRV fallback failed:', e.message);
    }
  }

  const client = new MongoClient(finalUri, { tls: true, tlsAllowInvalidCertificates: true });
  await client.connect();
  const db = client.db();

  // Build groups per source collection
  const groups = []; // { collection, agenteNombre, agenteId, count }
  for (const col of opts.sourceCollections) {
    console.log('[migrate_by_name] scanning', col, 'by', opts.nameField);
    try {
      const pipeline = [
        { $group: { _id: { name: `$${opts.nameField}`, id: '$agenteId' }, count: { $sum: 1 } } },
        { $sort: { 'count': -1 } }
      ];
      const agg = await db.collection(col).aggregate(pipeline).toArray();
      for (const a of agg) {
        const name = a._id && a._id.name ? a._id.name : '<null>';
        const id = a._id && a._id.id ? String(a._id.id) : null;
        if (!name || String(name).trim() === '') continue;
        groups.push({ collection: col, agenteNombre: String(name).trim(), agenteId: id, count: a.count });
      }
    } catch (e) {
      console.error('[migrate_by_name] scan error for', col, e.message);
    }
  }

  // Create mapping & execute migration
  console.log('[migrate_by_name] groups to process:', groups.length);
  for (const g of groups) {
    const sanitized = sanitizeName(g.agenteNombre);
    let target = `${opts.prefix}${sanitized}`;
    if (g.agenteId) {
      const short = String(g.agenteId).replace(/[^a-zA-Z0-9]/g,'').slice(0,6);
      target = `${opts.prefix}${sanitized}_${short}`;
    }

    console.log(`\n[migrate_by_name] ${g.collection} -> '${g.agenteNombre}' (id:${g.agenteId}) -> target='${target}' docs=${g.count}`);

    if (opts.dryRun) continue;

    const filter = { [opts.nameField]: g.agenteNombre };
    if (g.agenteId) filter.agenteId = g.agenteId;

    const cursor = db.collection(g.collection).find(filter).batchSize(opts.batchSize);
    let batch = [];
    let copied = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      batch.push(doc);
      if (batch.length >= opts.batchSize) {
        try {
          await db.collection(target).insertMany(batch, { ordered: false });
          copied += batch.length;
          console.log('[migrate_by_name] copied batch', copied);
        } catch (err) {
          if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
            console.warn('[migrate_by_name] duplicates ignored in batch:', err.message ? err.message.split('\n')[0] : err);
          } else {
            console.error('[migrate_by_name] insert error, aborting:', err.message || err);
            throw err;
          }
        }
        batch = [];
      }
    }
    if (batch.length) {
      try {
        await db.collection(target).insertMany(batch, { ordered: false });
        copied += batch.length;
        console.log('[migrate_by_name] copied final batch', copied);
      } catch (err) {
        if (err && (err.code === 11000 || /duplicate key/i.test(err.message || ''))) {
          console.warn('[migrate_by_name] duplicates ignored in final batch:', err.message ? err.message.split('\n')[0] : err);
        } else {
          console.error('[migrate_by_name] insert final error:', err.message || err);
          throw err;
        }
      }
    }

    const targetCount = await db.collection(target).countDocuments();
    console.log('[migrate_by_name] verify targetCount=', targetCount);

    if (opts.force) {
      const delRes = await db.collection(g.collection).deleteMany(filter);
      console.log('[migrate_by_name] deleted from source:', delRes.deletedCount);
    } else {
      console.log('[migrate_by_name] NOT removing source docs (no --force)');
    }
  }

  console.log('\n[migrate_by_name] finished');
  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
