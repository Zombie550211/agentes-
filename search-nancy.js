const { MongoClient } = require('mongodb');
require('dotenv').config();

async function searchNancy() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado');
    
    const adminDb = client.db().admin();
    const dbs = await adminDb.listDatabases();
    
    console.log('\n📚 Bases de datos disponibles:');
    dbs.databases.forEach(db => console.log(`  - ${db.name}`));
    
    console.log('\n🔍 Buscando NANCY LOPEZ en todas las BD:');
    
    for (const dbInfo of dbs.databases) {
      if (dbInfo.name.startsWith('admin') || 
          dbInfo.name.startsWith('local') || 
          dbInfo.name.startsWith('config')) continue;
      
      const db = client.db(dbInfo.name);
      try {
        const users = await db.collection('users').find({ username: 'NANCY LOPEZ' }).toArray();
        if (users.length > 0) {
          console.log(`\n✨ Encontrado en BD: ${dbInfo.name}`);
          users.forEach(u => {
            console.log(`   Username: ${u.username}`);
            console.log(`   Supervisor: ${u.supervisor}`);
            console.log(`   Team: ${u.team}`);
            console.log(`   _id: ${u._id}`);
          });
        }
      } catch (e) {
        // Colección no existe en esta BD
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

searchNancy();
