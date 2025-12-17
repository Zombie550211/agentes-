require('dotenv').config();
const { connectToMongoDB, getDb } = require('./config/db');

async function inspectKaterineClients() {
  try {
    await connectToMongoDB();
    const db = getDb();
    
    if (!db) {
      console.error('❌ No se pudo conectar a la BD');
      process.exit(1);
    }

    // Buscar un documento en la colección de Katerine
    const doc = await db.collection('costumers_Katerine_Gomez').findOne();
    
    if (!doc) {
      console.log('⚠️  No hay documentos en costumers_Katerine_Gomez');
      process.exit(0);
    }

    console.log('\n📊 ESTRUCTURA DE DOCUMENTO ENCONTRADO:\n');
    console.log('Campos disponibles:');
    console.log('─'.repeat(80));
    
    const fields = Object.keys(doc).sort();
    fields.forEach((field, idx) => {
      const value = doc[field];
      let valueStr = String(value).substring(0, 60);
      if (String(value).length > 60) valueStr += '...';
      console.log(`${(idx + 1).toString().padStart(2)}. ${field.padEnd(25)} : ${valueStr}`);
    });

    console.log('\n📋 DOCUMENTO COMPLETO:\n');
    console.log(JSON.stringify(doc, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

inspectKaterineClients();
