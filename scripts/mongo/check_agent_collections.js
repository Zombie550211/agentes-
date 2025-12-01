const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function main(){
  const uri = process.env.MONGODB_URI;
  if(!uri){ console.error('MONGODB_URI missing'); process.exit(1); }
  // attempt SRV -> direct resolution to avoid DNS issues
  let connectUri = uri;
  try {
    const { resolveSrvToDirectUri } = require('./srv_helper');
    const dnsServer = process.env.DNS_SERVER || null;
    connectUri = await resolveSrvToDirectUri(uri, dnsServer);
    console.log('Using resolved connectUri');
  } catch (e) {
    console.warn('SRV resolution fallback failed, using original uri:', e && e.message);
    connectUri = uri;
  }

  const client = new MongoClient(connectUri);
  await client.connect();
  const db = client.db();
  const ownerId = process.argv[2] || '68ba19a7c0605d2b8a29fff1';
  const username = process.argv[3] || 'EduardoR';
  console.log('Checking collections for ownerId:', ownerId, 'username:', username);
  const cols = (await db.listCollections().toArray()).map(c=>c.name).filter(n=>n.startsWith('costumers_'));
  for(const n of cols){
    const c = db.collection(n);
    let cntId = 0;
    try{
      const or = [{ agenteId: ownerId }];
      if(/^[a-fA-F0-9]{24}$/.test(ownerId)){
        try{ or.push({ agenteId: new ObjectId(ownerId) }); }catch(e){}
      }
      cntId = await c.countDocuments({ $or: or });
    }catch(e){ cntId = 0 }
    let cntName = 0;
    try{ cntName = await c.countDocuments({ $or: [{ agente: username }, { agenteNombre: username }, { createdBy: username }] }); }catch(e){ cntName = 0 }
    if(cntId || cntName) console.log(n, '-> agenteId:', cntId, 'agenteName:', cntName);
  }

  // show recent docs in costumers_Eduardo_R if exists
  const target = 'costumers_Eduardo_R';
  try{
    const tc = db.collection(target);
    const docs = await tc.find({ $or: [{ agenteId: ownerId }, { agente: username }, { agenteNombre: username }, { createdBy: username }] }).sort({ createdAt: -1 }).limit(5).toArray();
    console.log('\nRecent docs in', target, docs.length);
    for(const d of docs) console.log(' -', d._id, d.nombre_cliente || d.nombre || '', d.agenteId || d.agente || d.agenteNombre || d.createdBy, d.createdAt || d.fecha_creacion || d.creadoEn);
  }catch(e){ /* ignore */ }

  await client.close();
}

main().catch(err=>{ console.error(err); process.exit(2) });
