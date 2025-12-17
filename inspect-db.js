const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

async function inspectDB() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');
    
    const db = client.db('dashboard');
    
    // Listar todas las colecciones
    const collections = await db.listCollections().toArray();
    
    console.log('📋 COLECCIONES EN LA BASE DE DATOS:\n');
    collections.forEach(c => {
      console.log(`  - ${c.name}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 INSPECCIÓN DE COLECCIONES:\n');
    
    // Inspeccionar colecciones relevantes
    for (const collName of collections.map(c => c.name)) {
      if (collName.includes('costumer') || collName.includes('lead') || collName.includes('client')) {
        const coll = db.collection(collName);
        const count = await coll.countDocuments();
        
        if (count > 0) {
          console.log(`\n🔍 Colección: ${collName}`);
          console.log(`   Documentos: ${count}`);
          
          // Mostrar primer documento como ejemplo
          const sample = await coll.findOne();
          console.log(`   Ejemplo de estructura:`);
          console.log(`   ${JSON.stringify(sample, null, 2).substring(0, 500)}...`);
          
          // Si tiene campo de agente/supervisor
          const agentFields = await coll.aggregate([
            { $project: { 
              agente: '$agente', 
              agenteNombre: '$agenteNombre',
              nombreAgente: '$nombreAgente',
              supervisor: '$supervisor',
              createdBy: '$createdBy',
              _id: 1
            }},
            { $limit: 3 }
          ]).toArray();
          
          console.log(`   Primeros agentes:`);
          agentFields.forEach(doc => {
            console.log(`   - Agente: ${doc.agenteNombre || doc.agente || doc.nombreAgente || 'N/A'}, Supervisor: ${doc.supervisor || 'N/A'}`);
          });
        }
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n👥 USUARIOS (SUPERVISORES Y AGENTES):\n');
    
    const users = await db.collection('users').find({}).limit(20).toArray();
    users.forEach(u => {
      console.log(`  ${u.username} - Role: ${u.role} - Team: ${u.team || 'N/A'}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

inspectDB();
