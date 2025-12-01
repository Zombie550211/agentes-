const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main(){
  const uri = process.argv[2] || process.env.MONGODB_URI;
  const ownerId = process.argv[3] || process.env.OWNER_ID || '68ba19a7c0605d2b8a29fff1';
  const collectionName = process.argv[4] || process.env.COLLECTION_NAME || 'costumers_Eduardo_R';
  if(!uri){ console.error('MONGODB_URI missing'); process.exit(1); }

  // try resolve SRV
  let connectUri = uri;
  try{
    const { resolveSrvToDirectUri } = require('./srv_helper');
    const dnsServer = process.env.DNS_SERVER || null;
    connectUri = await resolveSrvToDirectUri(uri, dnsServer);
    console.log('[upsert_mapping] using resolved connectUri');
  }catch(e){ console.warn('[upsert_mapping] SRV resolve failed, using original URI', e && e.message); connectUri = uri; }

  // Try connecting with retries/backoff to handle transient network/DNS issues
  const { MongoClient } = require('mongodb');
  const maxAttempts = 5;
  let attempt = 0;
  let client = null;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      client = new MongoClient(connectUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
      console.log(`[upsert_mapping] attempt ${attempt} connecting to MongoDB...`);
      await client.connect();
      const db = client.db();
      console.log('[upsert_mapping] connected to', db.databaseName);
      await db.collection('user_collections').updateOne({ ownerId }, { $set: { ownerId, collectionName, updatedAt: new Date() } }, { upsert: true });
      console.log('[upsert_mapping] upserted mapping', ownerId, '->', collectionName);
      await client.close();
      return;
    } catch (e) {
      console.warn(`[upsert_mapping] attempt ${attempt} failed:`, e && e.message);
      try { if (client) await client.close(); } catch(_){}
      client = null;
      if (attempt < maxAttempts) {
        const wait = 2000 * attempt; // linear backoff
        console.log(`[upsert_mapping] retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      } else {
        console.error('[upsert_mapping] all attempts failed. Giving up.');
        process.exit(2);
      }
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(2); });
