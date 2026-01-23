// Script para agregar DENNIS VASQUEZ como agente de JONATHAN F en Team Lineas
const { MongoClient } = require('mongodb');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI || process.env.MONGO_ATLAS_URI || process.env.MONGO_URI;

async function addDennisVasquez() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    const agentData = {
      username: 'DENNIS VASQUEZ',
      name: 'DENNIS VASQUEZ',
      password: 'dennis123',
      role: 'Agente',
      team: 'team lineas jonathan',
      supervisor: 'JONATHAN F'
    };
    
    console.log('\n📝 Procesando DENNIS VASQUEZ...\n');
    
    // Verificar si ya existe
    const existing = await usersCol.findOne({ username: agentData.username });
    
    if (existing) {
      console.log(`⚠️  ${agentData.username} ya existe`);
      console.log(`   Supervisor actual: ${existing.supervisor || 'Sin supervisor'}`);
      console.log(`   Team actual: ${existing.team || 'Sin team'}`);
      console.log(`   Role actual: ${existing.role || 'Sin role'}`);
      
      // Actualizar datos si es diferente
      const updates = {};
      let needsUpdate = false;
      
      if (existing.supervisor !== 'JONATHAN F') {
        updates.supervisor = 'JONATHAN F';
        needsUpdate = true;
      }
      if (existing.team !== 'team lineas jonathan') {
        updates.team = 'team lineas jonathan';
        needsUpdate = true;
      }
      if (existing.role !== 'Agente') {
        updates.role = 'Agente';
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await usersCol.updateOne(
          { username: agentData.username },
          { $set: updates }
        );
        console.log(`\n✅ ${agentData.username} actualizado:`);
        Object.entries(updates).forEach(([key, val]) => {
          console.log(`   - ${key}: ${val}`);
        });
      } else {
        console.log(`\n✅ ${agentData.username} ya tiene los datos correctos`);
      }
    } else {
      // Crear agente
      const hashedPassword = await bcrypt.hash(agentData.password, 10);
      const newAgent = {
        ...agentData,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await usersCol.insertOne(newAgent);
      console.log(`✅ ${agentData.username} creado exitosamente`);
      console.log(`   Password temporal: ${agentData.password}`);
      console.log(`   Supervisor: JONATHAN F`);
      console.log(`   Team: team lineas jonathan`);
      console.log(`   Role: Agente`);
    }
    
    console.log('\n✅ Proceso completado\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Conexión cerrada');
  }
}

addDennisVasquez();
