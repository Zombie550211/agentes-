const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority';

console.log('Conectando a MongoDB...');

const client = new MongoClient(MONGODB_URI, { 
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000
});

(async () => {
  try {
    await client.connect();
    const db = client.db('crmagente');
    
    // Listar colecciones
    const colls = await db.listCollections().toArray();
    console.log('\n=== COLECCIONES EN crmagente ===');
    colls.forEach(c => console.log('  ' + c.name));
    console.log(`Total: ${colls.length} colecciones`);
    
    // Ver user_collections
    const uc = db.collection('user_collections');
    const mappings = await uc.find({}).toArray();
    console.log('\n=== USER_COLLECTIONS ===');
    if (mappings.length === 0) {
      console.log('  (vacío - no hay mapeos)');
    } else {
      mappings.forEach(m => {
        console.log(`  ownerId: ${m.ownerId || 'N/A'} -> colección: ${m.collectionName || 'N/A'}`);
      });
    }
    
    // Ver si existe la colección costumers
    const costumersCount = await db.collection('costumers').estimatedDocumentCount();
    console.log(`\n=== costumers collection ===`);
    console.log(`  Documentos: ${costumersCount}`);
    
    // Buscar colecciones que empiezan con costumers_
    const customerCollections = colls.filter(c => c.name.startsWith('costumers_'));
    console.log(`\n=== costumers_* collections (${customerCollections.length}) ===`);
    customerCollections.forEach(c => {
      console.log(`  ${c.name}`);
    });
    
    await client.close();
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    if (e.message.includes('getaddrinfo')) {
      console.error('  -> Problema de conectividad de red');
    }
    process.exit(1);
  }
})();
