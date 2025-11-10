const { MongoClient } = require('mongodb');
require('dotenv').config();

async function fixBothDatabases() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado');
    
    const databases = ['crmagente', 'dashboard'];
    
    for (const dbName of databases) {
      console.log(`\n🔧 Actualizando en BD: ${dbName}`);
      const db = client.db(dbName);
      const usersCol = db.collection('users');
      
      const result = await usersCol.updateMany(
        { username: { $in: ['NANCY LOPEZ', 'JOCELYN REYES', 'OSCAR RIVERA'] } },
        { $set: { supervisor: 'JONATHAN F', team: 'team lineas jonathan' } }
      );
      
      console.log(`   ✅ Modificados: ${result.modifiedCount}`);
      
      const agents = await usersCol.find({ 
        username: { $in: ['NANCY LOPEZ', 'JOCELYN REYES', 'OSCAR RIVERA'] } 
      }).toArray();
      
      console.log('   Estado actual:');
      agents.forEach(a => {
        console.log(`     - ${a.username}: supervisor=${a.supervisor}, team=${a.team}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('\n🔌 Conexión cerrada');
  }
}

fixBothDatabases();
