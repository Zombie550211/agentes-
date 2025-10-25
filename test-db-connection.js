/**
 * Script para verificar conexión a MongoDB y contar documentos
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/crm';

async function testConnection() {
  console.log('🔍 Verificando conexión a MongoDB...');
  console.log('📍 URI:', MONGODB_URI);
  
  let client;
  try {
    client = await MongoClient.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Conexión exitosa a MongoDB');
    
    const db = client.db();
    console.log('📊 Base de datos:', db.databaseName);
    
    // Listar colecciones
    const collections = await db.listCollections().toArray();
    console.log('\n📁 Colecciones disponibles:');
    collections.forEach(col => console.log(`  - ${col.name}`));
    
    // Contar documentos en costumers
    const costumersCount = await db.collection('costumers').countDocuments();
    console.log(`\n👥 Total de clientes en 'costumers': ${costumersCount}`);
    
    if (costumersCount > 0) {
      // Mostrar un ejemplo
      const sample = await db.collection('costumers').findOne();
      console.log('\n📄 Ejemplo de documento:');
      console.log(JSON.stringify(sample, null, 2).substring(0, 500) + '...');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔒 Conexión cerrada');
    }
  }
}

testConnection();
