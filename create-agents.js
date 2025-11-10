// Script para crear los agentes de Team Lineas
const { MongoClient } = require('mongodb');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI || process.env.MONGO_ATLAS_URI || process.env.MONGO_URI;

async function createAgents() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Agentes a crear
    const agentsToCreate = [
      {
        username: 'NANCY LOPEZ',
        name: 'NANCY LOPEZ',
        password: 'nancy123', // Cambiar después
        role: 'Agente',
        team: 'team lineas jonathan',
        supervisor: 'JONATHAN F'
      },
      {
        username: 'JOCELYN REYES',
        name: 'JOCELYN REYES',
        password: 'jocelyn123', // Cambiar después
        role: 'Agente',
        team: 'team lineas jonathan',
        supervisor: 'JONATHAN F'
      },
      {
        username: 'OSCAR RIVERA',
        name: 'OSCAR RIVERA',
        password: 'oscar123', // Cambiar después
        role: 'Agente',
        team: 'team lineas jonathan',
        supervisor: 'JONATHAN F'
      }
    ];
    
    console.log('\n📝 Creando agentes...\n');
    
    for (const agentData of agentsToCreate) {
      // Verificar si ya existe
      const existing = await usersCol.findOne({ username: agentData.username });
      
      if (existing) {
        console.log(`⚠️  ${agentData.username} ya existe`);
        console.log(`   Supervisor actual: ${existing.supervisor || 'Sin supervisor'}`);
        
        // Actualizar supervisor si es diferente
        if (existing.supervisor !== 'JONATHAN F') {
          await usersCol.updateOne(
            { username: agentData.username },
            { 
              $set: { 
                supervisor: 'JONATHAN F',
                team: 'team lineas jonathan'
              } 
            }
          );
          console.log(`   ✅ Supervisor actualizado a: JONATHAN F\n`);
        } else {
          console.log(`   ℹ️  Ya tiene el supervisor correcto\n`);
        }
        continue;
      }
      
      // Hashear contraseña
      const hashedPassword = await bcrypt.hash(agentData.password, 10);
      
      // Crear agente
      const newAgent = {
        ...agentData,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await usersCol.insertOne(newAgent);
      console.log(`✅ ${agentData.username} creado exitosamente`);
      console.log(`   Password temporal: ${agentData.password}`);
      console.log(`   Supervisor: JONATHAN F\n`);
    }
    
    console.log('\n✅ Proceso completado');
    console.log('\n⚠️  IMPORTANTE: Cambiar las contraseñas temporales después del primer login\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Conexión cerrada');
  }
}

createAgents();
