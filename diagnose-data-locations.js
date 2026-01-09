require('dotenv').config();
const { MongoClient } = require('mongodb');

async function safeCount(col, query) {
  try {
    return await col.countDocuments(query || {});
  } catch (e) {
    return { error: e.message };
  }
}

async function inspectDb(client, dbName) {
  const db = client.db(dbName);
  let cols = [];
  try {
    cols = await db.listCollections().toArray();
  } catch (e) {
    return { dbName, error: e.message };
  }
  const names = cols.map(c => c.name);

  const costumersUnifiedExists = names.includes('costumers_unified');
  const costumersLike = names.filter(n => /^costumers(_|$)/i.test(n));

  const result = {
    dbName,
    collections: {
      costumers_unified: costumersUnifiedExists,
      costumers_like_count: costumersLike.length
    },
    counts: {}
  };

  if (costumersUnifiedExists) {
    result.counts.costumers_unified = await safeCount(db.collection('costumers_unified'));
  }

  // Sample a few costumers* collections (up to 5) to avoid heavy load
  const sample = costumersLike.slice(0, 5);
  const sampleCounts = {};
  for (const c of sample) {
    sampleCounts[c] = await safeCount(db.collection(c));
  }
  result.counts.costumers_sample = sampleCounts;

  // Users sanity checks
  if (names.includes('users')) {
    const users = db.collection('users');
    result.counts.users = await safeCount(users);
    result.counts.users_team_guadalupe = await safeCount(users, { team: 'TEAM GUADALUPE SANTANA' });
  }

  return result;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  const client = new MongoClient(uri, {
    tlsAllowInvalidCertificates: String(process.env.TLS_INSECURE || '') === '1',
    tlsAllowInvalidHostnames: String(process.env.TLS_INSECURE || '') === '1',
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 30000,
    appName: 'diagnose-data-locations'
  });

  await client.connect();
  const admin = client.db().admin();

  let dbs = [];
  try {
    const dbList = await admin.listDatabases();
    dbs = (dbList.databases || []).map(d => d.name);
  } catch (e) {
    console.error('Cannot list databases (permissions):', e.message);
    // Fallback: just inspect configured DB_NAME and the common alternatives
    dbs = [];
  }

  const configured = process.env.MONGODB_DBNAME || 'crmagente';
  const candidates = Array.from(new Set([configured, 'dashboard', 'crmagente', 'crm', 'admin'].concat(dbs)));

  const out = [];
  for (const dbName of candidates) {
    if (!dbName || dbName === 'admin') continue;
    const info = await inspectDb(client, dbName);
    // Keep only DBs that have any costumers* or costumers_unified
    const hasAny = info?.collections?.costumers_unified || (info?.collections?.costumers_like_count || 0) > 0;
    if (hasAny) out.push(info);
  }

  console.log(JSON.stringify({ configuredDbName: configured, results: out }, null, 2));
  await client.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
