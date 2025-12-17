const { MongoClient } = require('mongodb');
require('dotenv').config();

async function debug() {
  let client;
  try {
    const MONGODB_URI_ATLAS = process.env.MONGODB_URI;
    const MONGODB_URI_LOCAL = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/crmagente_local';
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    
    let connectionUri = MONGODB_URI_ATLAS || MONGODB_URI_LOCAL;
    let dbName = DB_NAME;
    
    console.log(`\n🔗 Intentando conectar a: ${connectionUri.split('@')[1] || connectionUri}`);
    console.log(`📊 Base de datos: ${dbName}\n`);
    
    client = new MongoClient(connectionUri);
    await client.connect();
    const db = client.db(dbName);
    
    // Obtener datos de Anderson
    const docs = await db.collection('costumers').aggregate([
      { $match: { agenteNombre: /anderson guzman/i } },
      { $project: { 
        agenteNombre: 1, 
        puntaje: 1, 
        status: 1, 
        nombre_cliente: 1, 
        numero_cuenta: 1, 
        excluirDeReporte: 1,
        createdAt: 1,
        dia_venta: 1
      }},
      { $sort: { createdAt: -1 }},
      { $limit: 30}
    ]).toArray();
    
    console.log('\n=== REGISTROS DE ANDERSON GUZMAN ===\n');
    console.log(`Total de registros: ${docs.length}\n`);
    
    let totalPuntaje = 0;
    let excluidos = 0;
    docs.forEach((doc, idx) => {
      const puntaje = doc.puntaje || 0;
      totalPuntaje += puntaje;
      const excluir = doc.excluirDeReporte ? '✓ SÍ' : 'no';
      if (doc.excluirDeReporte) excluidos++;
      console.log(`${idx + 1}. Puntaje: ${puntaje}, Status: ${doc.status}, Excluir: ${excluir}, Cliente: ${doc.nombre_cliente}`);
    });
    
    console.log(`\n=== ANÁLISIS ===`);
    console.log(`Total puntaje acumulado: ${totalPuntaje.toFixed(2)}`);
    console.log(`Registros excluidos (excluirDeReporte=true): ${excluidos}`);
    console.log(`Diferencia (16.05 - ${totalPuntaje.toFixed(2)}): ${(16.05 - totalPuntaje).toFixed(2)}`);
    
    // Buscar registros con puntaje 0.75 específicamente
    const con075 = await db.collection('costumers').find({
      agenteNombre: /anderson guzman/i,
      puntaje: 0.75
    }).toArray();
    
    console.log(`\n⚠️  Registros con puntaje 0.75: ${con075.length}`);
    con075.forEach((doc, idx) => {
      console.log(`  ${idx + 1}. Status: ${doc.status}, Cliente: ${doc.nombre_cliente}, Excluir: ${doc.excluirDeReporte || 'no'}`);
    });
    
  } catch(e) {
    console.error('❌ Error:', e.message);
  } finally {
    if (client) await client.close();
  }
  process.exit(0);
}

debug();
