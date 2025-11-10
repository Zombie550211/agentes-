// Script para actualizar el supervisor de los agentes de Team Lineas
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Usar la misma lógica que server.js para obtener la URI
const uri = process.env.MONGODB_URI || process.env.MONGO_ATLAS_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/dashboard';

console.log('📡 Usando URI:', uri.includes('mongodb+srv') || uri.includes('ywxaotz') ? 'MongoDB Atlas' : 'MongoDB Local');

async function updateAgentsSupervisor() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Agentes que necesitan cambiar de supervisor
    const agentsToUpdate = [
      'NANCY LOPEZ',
      'JOCELYN REYES', 
      'OSCAR RIVERA'
    ];
    
    console.log('\n📝 Actualizando supervisores...\n');
    
    for (const agentName of agentsToUpdate) {
      // Buscar el agente
      const agent = await usersCol.findOne({ username: agentName });
      
      if (!agent) {
        console.log(`❌ Agente ${agentName} no encontrado en la base de datos`);
        continue;
      }
      
      const currentSupervisor = agent.supervisor || 'Sin supervisor';
      console.log(`👤 ${agentName}`);
      console.log(`   Supervisor actual: ${currentSupervisor}`);
      
      // Actualizar supervisor a JONATHAN F
      const result = await usersCol.updateOne(
        { username: agentName },
        { 
          $set: { 
            supervisor: 'JONATHAN F',
            team: 'team lineas jonathan'
          } 
        }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`   ✅ Actualizado a: JONATHAN F\n`);
      } else {
        console.log(`   ⚠️  No se pudo actualizar (ya tenía ese supervisor)\n`);
      }
    }
    
    console.log('\n✅ Proceso completado');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Conexión cerrada');
  }
}

updateAgentsSupervisor();
