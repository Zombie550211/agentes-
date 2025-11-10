// Script para crear el supervisor JONATHAN F
const { MongoClient } = require('mongodb');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI || process.env.MONGO_ATLAS_URI || process.env.MONGO_URI;

async function createSupervisor() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Verificar si ya existe
    const existing = await usersCol.findOne({ username: 'JONATHAN F' });
    
    if (existing) {
      console.log('⚠️  El supervisor JONATHAN F ya existe');
      console.log('   Username:', existing.username);
      console.log('   Role:', existing.role);
      console.log('   Team:', existing.team);
      return;
    }
    
    // Crear supervisor
    const hashedPassword = await bcrypt.hash('jonathan123', 10); // Password temporal
    
    const supervisor = {
      username: 'JONATHAN F',
      name: 'JONATHAN F',
      password: hashedPassword,
      role: 'Supervisor',
      team: 'team lineas jonathan',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await usersCol.insertOne(supervisor);
    
    console.log('✅ Supervisor JONATHAN F creado exitosamente');
    console.log('   Username: JONATHAN F');
    console.log('   Password temporal: jonathan123');
    console.log('   Role: Supervisor');
    console.log('   Team: team lineas jonathan');
    console.log('\n⚠️  IMPORTANTE: Cambiar la contraseña temporal después del primer login\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Conexión cerrada');
  }
}

createSupervisor();
