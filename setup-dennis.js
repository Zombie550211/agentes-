// Script para verificar y agregar DENNIS VASQUEZ en Base de Datos
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
    
    // Verificar si Dennis existe
    const dennis = await usersCol.findOne({ username: 'DENNIS VASQUEZ' });
    
    if (dennis) {
      console.log('\n✅ DENNIS VASQUEZ YA EXISTE');
      console.log('Username:', dennis.username);
      console.log('Supervisor:', dennis.supervisor);
      console.log('Team:', dennis.team);
      console.log('Role:', dennis.role);
    } else {
      console.log('\n📝 DENNIS VASQUEZ NO EXISTE, CREANDO...');
      
      const hashedPassword = await bcrypt.hash('dennis123', 10);
      const result = await usersCol.insertOne({
        username: 'DENNIS VASQUEZ',
        name: 'DENNIS VASQUEZ',
        password: hashedPassword,
        role: 'Agente',
        team: 'team lineas jonathan',
        supervisor: 'JONATHAN F',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      console.log('✅ DENNIS VASQUEZ CREADO');
      console.log('ID:', result.insertedId);
      console.log('Password temporal: dennis123');
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
