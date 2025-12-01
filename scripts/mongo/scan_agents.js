const { MongoClient } = require('mongodb');
const { resolveSrvToDirectUri } = require('./srv_helper');

async function main() {
  let uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI');
    process.exit(2);
  }
  const dnsServer = process.env.DNS_SERVER || '8.8.8.8';
  if (uri.startsWith('mongodb+srv://')) {
    try {
      uri = await resolveSrvToDirectUri(uri, dnsServer);
      console.log('[helper] resolved SRV via', dnsServer);
    } catch (e) {
      console.warn('[helper] SRV resolve failed:', e.message);
    }
  }
  const client = new MongoClient(uri, { tls: true, tlsAllowInvalidCertificates: true });
  await client.connect();
  const db = client.db('crmagente');

  console.log('\nScanning agent counts in collections: costumers and leads');
  const collections = ['costumers','leads'];
  const results = {};
  for (const col of collections) {
    try {
      const pipeline = [
        { $group: { _id: { agenteId: '$agenteId' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ];
      const agg = await db.collection(col).aggregate(pipeline).toArray();
      results[col] = agg.map(r=>({ agenteId: r._id && r._id.agenteId ? r._id.agenteId : null, count: r.count }));
    } catch (e) {
      console.error('Error scanning', col, e.message);
      results[col] = [];
    }
  }

  const map = new Map();
  for (const col of Object.keys(results)) {
    for (const row of results[col]) {
      const id = row.agenteId == null ? '<null>' : String(row.agenteId);
      const prev = map.get(id) || { agenteId: id, costumers: 0, leads: 0 };
      if (col === 'costumers') prev.costumers = row.count;
      if (col === 'leads') prev.leads = row.count;
      map.set(id, prev);
    }
  }
  const arr = Array.from(map.values()).sort((a,b)=> (b.costumers + b.leads) - (a.costumers + a.leads));

  console.log('\nTop agents by total leads (costumers + leads):');
  console.log('agenteId -> costumers | leads | total');
  arr.slice(0,100).forEach(r=> console.log(r.agenteId, '->', r.costumers, '|', r.leads, '|', (r.costumers + r.leads)));

  // list existing per-agent collections
  const cols = await db.listCollections().toArray();
  const perAgentCols = cols.filter(c=>/^costumers_/i.test(c.name)).map(c=>c.name);
  console.log('\nExisting per-agent collections (count:', perAgentCols.length + ')');
  perAgentCols.forEach(c=>console.log(' -', c));

  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
