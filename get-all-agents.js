const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

async function getAllAgents() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Obtener TODOS los usuarios que sean agentes
    const allAgents = await usersCol.find({
      role: { $regex: /agente/i }
    }).toArray();
    
    console.log(`📋 TOTAL DE AGENTES EN LA BD: ${allAgents.length}\n`);
    console.log('='.repeat(80));
    
    // Agrupar por supervisor
    const byTeam = {};
    
    allAgents.forEach(agent => {
      const supervisor = agent.supervisor || 'Sin supervisor';
      if (!byTeam[supervisor]) {
        byTeam[supervisor] = [];
      }
      byTeam[supervisor].push({
        username: agent.username || agent.name || 'Sin nombre',
        name: agent.name || agent.username || 'Sin nombre',
        team: agent.team || 'Sin equipo',
        role: agent.role || 'Sin rol'
      });
    });
    
    // Mostrar por equipo
    Object.keys(byTeam).sort().forEach(supervisor => {
      console.log(`\n👥 SUPERVISOR: ${supervisor}`);
      console.log(`   Agentes: ${byTeam[supervisor].length}`);
      byTeam[supervisor].forEach(agent => {
        console.log(`   - ${agent.username} (${agent.name})`);
      });
    });
    
    // Guardar JSON completo
    console.log('\n' + '='.repeat(80));
    console.log('\n📄 ESTRUCTURA JSON PARA DASHBOARD:\n');
    
    const teamsForDashboard = {
      teams: Object.keys(byTeam).map(supervisor => ({
        supervisor: supervisor,
        agents: byTeam[supervisor].map(a => a.username).sort()
      }))
    };
    
    console.log(JSON.stringify(teamsForDashboard, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

getAllAgents();
