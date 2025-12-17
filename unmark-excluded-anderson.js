const { MongoClient } = require('mongodb');
require('dotenv').config();

async function unmarkExcludedRecords() {
  let client;
  try {
    const MONGODB_URI_ATLAS = process.env.MONGODB_URI;
    const MONGODB_URI_LOCAL = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/crmagente_local';
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    
    let connectionUri = MONGODB_URI_ATLAS || MONGODB_URI_LOCAL;
    let dbName = DB_NAME;
    
    console.log(`\n🔗 Intentando conectar a MongoDB...`);
    
    client = new MongoClient(connectionUri, { 
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000 
    });
    
    await client.connect();
    const db = client.db(dbName);
    
    console.log(`✅ Conectado a: ${dbName}\n`);
    
    // Obtener fecha de inicio y fin del mes actual (diciembre 2025)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    console.log(`📅 Rango de búsqueda: ${startOfMonth.toLocaleDateString()} a ${endOfMonth.toLocaleDateString()}\n`);
    
    // Primero, contar cuántos registros serán actualizados
    const countBefore = await db.collection('costumers').countDocuments({
      agenteNombre: /anderson guzman/i,
      excluirDeReporte: true,
      createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    });
    
    console.log(`⚠️  Registros encontrados con excluirDeReporte: true: ${countBefore}\n`);
    
    if (countBefore === 0) {
      console.log('✅ No hay registros marcados para excluir. ¡Todo está correcto!');
      process.exit(0);
    }
    
    // Mostrar los registros antes de actualizar
    const recordsBefore = await db.collection('costumers')
      .find({
        agenteNombre: /anderson guzman/i,
        excluirDeReporte: true,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
      })
      .project({ 
        nombre_cliente: 1, 
        puntaje: 1, 
        status: 1, 
        excluirDeReporte: 1,
        createdAt: 1
      })
      .toArray();
    
    console.log('📋 Registros a desmarcar:\n');
    let totalPuntajeExcluido = 0;
    recordsBefore.forEach((rec, idx) => {
      const puntaje = rec.puntaje || 0;
      totalPuntajeExcluido += puntaje;
      console.log(`  ${idx + 1}. ${rec.nombre_cliente} - Puntaje: ${puntaje} - Status: ${rec.status}`);
    });
    
    console.log(`\n💰 Total puntaje a recuperar: ${totalPuntajeExcluido.toFixed(2)}\n`);
    
    // Actualizar: remover el flag excluirDeReporte
    const result = await db.collection('costumers').updateMany(
      {
        agenteNombre: /anderson guzman/i,
        excluirDeReporte: true,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
      },
      { $unset: { excluirDeReporte: "" } }
    );
    
    console.log(`\n✅ ACTUALIZACIÓN COMPLETADA`);
    console.log(`   - Registros modificados: ${result.modifiedCount}`);
    console.log(`   - Puntaje recuperado: ${totalPuntajeExcluido.toFixed(2)}`);
    console.log(`\n🎯 Anderson ahora debe mostrar: ${(15.3 + totalPuntajeExcluido).toFixed(2)} puntos en el ranking\n`);
    
  } catch(e) {
    console.error('❌ Error:', e.message);
    console.log('\n💡 Si el servidor local no está disponible, intenta:');
    console.log('   1. Iniciar MongoDB localmente');
    console.log('   2. O acceder a MongoDB Atlas con las credenciales correctas\n');
  } finally {
    if (client) {
      try {
        await client.close();
      } catch(e) {}
    }
  }
  process.exit(0);
}

unmarkExcludedRecords();
