// Script para crear el supervisor LUIS G
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
    const existing = await usersCol.findOne({ username: 'LUIS G' });
    
    if (existing) {
      console.log('⚠️  El supervisor LUIS G ya existe');
      console.log('   Username:', existing.username);
      console.log('   Role:', existing.role);
      console.log('   Team:', existing.team);
      return;
    }
    
    // Crear supervisor
    const hashedPassword = await bcrypt.hash('luis123', 10); // Password temporal
    
    const supervisor = {
      username: 'LUIS G',
      name: 'LUIS G',
      password: hashedPassword,
      role: 'Supervisor',
      team: 'team lineas gutierrez',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await usersCol.insertOne(supervisor);
    
    console.log('✅ Supervisor LUIS G creado exitosamente');
    console.log('   Username: LUIS G');
    console.log('   Password temporal: luis123');
    console.log('   Role: Supervisor');
    console.log('   Team: team lineas gutierrez');
    console.log('\n⚠️  IMPORTANTE: Cambiar la contraseña temporal después del primer login\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Conexión cerrada');
  }
}

createSupervisor();
