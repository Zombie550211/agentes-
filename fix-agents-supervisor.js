const { MongoClient } = require('mongodb');
require('dotenv').config();

async function fixSupervisors() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Verificar estado actual
    console.log('\n📋 Estado ANTES de la actualización:');
    const agentsBefore = await usersCol.find({ 
      username: { $in: ['NANCY LOPEZ', 'JOCELYN REYES', 'OSCAR RIVERA'] } 
    }).toArray();
    
    agentsBefore.forEach(a => {
      console.log(`  ${a.username} - supervisor: ${a.supervisor}`);
    });
    
    // Actualizar
    console.log('\n🔧 Actualizando supervisores...');
    const result = await usersCol.updateMany(
      { username: { $in: ['NANCY LOPEZ', 'JOCELYN REYES', 'OSCAR RIVERA'] } },
      { $set: { supervisor: 'JONATHAN F', team: 'team lineas jonathan' } }
    );
    
    console.log(`✅ Documentos modificados: ${result.modifiedCount}`);
    
    // Verificar estado después
    console.log('\n📋 Estado DESPUÉS de la actualización:');
    const agentsAfter = await usersCol.find({ 
      username: { $in: ['NANCY LOPEZ', 'JOCELYN REYES', 'OSCAR RIVERA'] } 
    }).toArray();
    
    agentsAfter.forEach(a => {
      console.log(`  ${a.username} - supervisor: ${a.supervisor} - team: ${a.team}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('\n🔌 Conexión cerrada');
  }
}

fixSupervisors();
