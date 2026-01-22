const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';

async function getTeamsFromCostumers() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');
    
    const db = client.db('dashboard');
    const costumersCol = db.collection('costumers');
    
    // Obtener teams y agentes desde la colección costumers
    const teamsData = await costumersCol.aggregate([
      { 
        $match: { 
          supervisor: { $ne: null, $ne: '' } 
        } 
      }, 
      { 
        $group: { 
          _id: '$supervisor', 
          agents: { $addToSet: '$agente' }, 
          count: { $sum: 1 }
        } 
      }, 
      { 
        $sort: { count: -1 } 
      }
    ]).toArray();
    
    console.log('📊 EQUIPOS Y AGENTES DESDE COSTUMERS:\n');
    
    teamsData.forEach(team => {
      console.log(`\n🏢 TEAM: ${team._id}`);
      console.log(`   Ventas totales: ${team.count}`);
      console.log(`   Agentes (${team.agents.length}):`);
      team.agents.forEach(agent => {
        console.log(`   - ${agent}`);
      });
    });
    
    console.log('\n\n📋 RESUMEN JSON:');
    console.log(JSON.stringify(teamsData, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✔️ Conexión cerrada');
  }
}

getTeamsFromCostumers();
