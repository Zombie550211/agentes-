const { MongoClient } = require('mongodb');
const { resolveSrvToDirectUri } = require('./srv_helper');

async function scanCollectionByName(db, collectionName, nameField) {
  try {
    const pipeline = [
      { $group: { _id: `$${nameField}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ];
    const agg = await db.collection(collectionName).aggregate(pipeline).toArray();
    return agg.map(r => ({ name: r._id || '<null>', count: r.count }));
  } catch (e) {
    console.error('[scan] error on', collectionName, e.message);
    return [];
  }
}

async function main() {
  let uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGO_URI'); process.exit(2); }
  const dnsServer = process.env.DNS_SERVER || '8.8.8.8';
  if (uri.startsWith('mongodb+srv://')) {
    try { uri = await resolveSrvToDirectUri(uri, dnsServer); console.log('[helper] resolved SRV via', dnsServer); } catch(e){ console.warn('[helper] SRV resolve failed:', e.message); }
  }
  const client = new MongoClient(uri, { tls: true, tlsAllowInvalidCertificates: true });
  await client.connect();
  const db = client.db('crmagente');

  console.log('\nScanning by agenteNombre in collections: costumers and leads');
  const results = {};
  results.costumers = await scanCollectionByName(db, 'costumers', 'agenteNombre');
  results.leads = await scanCollectionByName(db, 'leads', 'agenteNombre');

  console.log('\nTop agenteNombre in `costumers` (name -> count):');
  results.costumers.slice(0,50).forEach(r => console.log(r.name, '->', r.count));

  console.log('\nTop agenteNombre in `leads` (name -> count):');
  results.leads.slice(0,50).forEach(r => console.log(r.name, '->', r.count));

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
