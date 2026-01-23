// Script para verificar y agregar CESAR CLAROS en Base de Datos
const { MongoClient } = require('mongodb');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI || process.env.MONGO_ATLAS_URI || process.env.MONGO_URI;

async function run() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('dashboard');
    const usersCol = db.collection('users');
    
    // Verificar si Cesar existe
    const cesar = await usersCol.findOne({ username: 'CESAR CLAROS' });
    
    if (cesar) {
      console.log('\n✅ CESAR CLAROS YA EXISTE');
      console.log('Username:', cesar.username);
      console.log('Supervisor:', cesar.supervisor);
      console.log('Team:', cesar.team);
      console.log('Role:', cesar.role);
    } else {
      console.log('\n📝 CESAR CLAROS NO EXISTE, CREANDO...');
      
      const hashedPassword = await bcrypt.hash('cesar123', 10);
      const result = await usersCol.insertOne({
        username: 'CESAR CLAROS',
        name: 'CESAR CLAROS',
        password: hashedPassword,
        role: 'Agente',
        team: 'team lineas jonathan',
        supervisor: 'JONATHAN F',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      console.log('✅ CESAR CLAROS CREADO');
      console.log('ID:', result.insertedId);
      console.log('Password temporal: cesar123');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Conexión cerrada');
    process.exit(0);
  }
}

run();
