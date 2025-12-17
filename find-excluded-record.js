const { MongoClient } = require('mongodb');
require('dotenv').config();

async function findExcludedRecord() {
  let client;
  try {
    const MONGODB_URI_ATLAS = process.env.MONGODB_URI;
    const MONGODB_URI_LOCAL = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/crmagente_local';
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    
    let connectionUri = MONGODB_URI_ATLAS || MONGODB_URI_LOCAL;
    let dbName = DB_NAME;
    
    console.log(`\n🔗 Intentando conectar a: ${connectionUri.split('@')[1] || connectionUri}`);
    console.log(`📊 Base de datos: ${dbName}\n`);
    
    client = new MongoClient(connectionUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db(dbName);
    
    // Buscar registros de Anderson marcados con excluirDeReporte en diciembre 2025
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const excluded = await db.collection('costumers').find({
      agenteNombre: /anderson guzman/i,
      excluirDeReporte: true,
      createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    }).toArray();
    
    console.log(`\n=== REGISTROS MARCADOS CON excluirDeReporte: true ===\n`);
    console.log(`Total encontrados: ${excluded.length}\n`);
    
    let totalExcluido = 0;
    excluded.forEach((record, idx) => {
      const puntaje = record.puntaje || 0;
      totalExcluido += puntaje;
      console.log(`${idx + 1}. Puntaje: ${puntaje}, Cliente: ${record.nombre_cliente}, Status: ${record.status}`);
    });
    
    console.log(`\n💡 Total de puntaje excluido: ${totalExcluido.toFixed(2)}`);
    console.log(`🎯 Diferencia en ranking (16.05 - 15.3): ${(16.05 - 15.3).toFixed(2)}`);
    
    if (Math.abs(totalExcluido - 0.75) < 0.01) {
      console.log('\n✅ ¡ENCONTRADO! El registro excluido es el que falta de 0.75 puntos');
      console.log(`\n📌 Detalles del registro a FIX:`);
      excluded.forEach(rec => {
        console.log(`   - ID: ${rec._id}`);
        console.log(`   - Cliente: ${rec.nombre_cliente}`);
        console.log(`   - Puntaje: ${rec.puntaje}`);
        console.log(`   - Status: ${rec.status}`);
      });
    }
    
  } catch(e) {
    console.error('❌ Error:', e.message);
  } finally {
    if (client) await client.close();
  }
  process.exit(0);
}

findExcludedRecord();
