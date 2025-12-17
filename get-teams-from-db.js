const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

async function getTeamsFromDB() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Obtener todos los supervisores
    const supervisors = await usersCol.find({ 
      role: { $regex: /supervisor/i } 
    }).toArray();
    
    console.log('📊 EQUIPOS Y AGENTES EN MONGODB:\n');
    
    const teams = {};
    
    for (const supervisor of supervisors) {
      const supName = supervisor.username || supervisor.name || 'Sin nombre';
      
      // Obtener agentes de este supervisor
      const agents = await usersCol.find({
        supervisor: supName,
        role: { $regex: /agente/i }
      }).toArray();
      
      teams[supName] = {
        supervisor: supName,
        agents: agents.map(a => a.username || a.name).filter(Boolean)
      };
      
      console.log(`\n🏢 SUPERVISOR: ${supName}`);
      console.log(`   Agentes (${agents.length}):`);
      agents.forEach(a => {
        console.log(`   - ${a.username || a.name}`);
      });
    }
    
    console.log('\n\n📋 RESUMEN JSON:');
    console.log(JSON.stringify(teams, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✔️ Conexión cerrada');
  }
}

getTeamsFromDB();
