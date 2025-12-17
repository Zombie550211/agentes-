const { MongoClient } = require('mongodb');
require('dotenv').config();

async function compareRecords() {
  let client;
  try {
    const MONGODB_URI_ATLAS = process.env.MONGODB_URI;
    const MONGODB_URI_LOCAL = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/crmagente_local';
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    
    let connectionUri = MONGODB_URI_ATLAS || MONGODB_URI_LOCAL;
    
    console.log(`\n🔗 Conectando a MongoDB...\n`);
    
    client = new MongoClient(connectionUri, { 
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000 
    });
    
    await client.connect();
    const db = client.db(DB_NAME);
    
    // Obtener el registro de costumers
    const recordCostumers = await db.collection('costumers').findOne({
      agenteNombre: /anderson guzman/i,
      puntaje: 0.75,
      dia_venta: { $regex: "2025-12" }
    });
    
    // Obtener el registro de costumers_Anderson_Guzman
    const recordAnderson = await db.collection('costumers_Anderson_Guzman').findOne({
      nombre_cliente: /MARCO GARCIA LOPEZ/i,
      puntaje: 0.75,
      dia_venta: { $regex: "2025-12" }
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('REGISTRO EN costumers:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(recordCostumers, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('REGISTRO EN costumers_Anderson_Guzman:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(recordAnderson, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('COMPARACIÓN:');
    console.log('='.repeat(80));
    
    if (recordCostumers && recordAnderson) {
      console.log('\n✅ AMBOS REGISTROS EXISTEN\n');
      
      const same = JSON.stringify(recordCostumers) === JSON.stringify(recordAnderson);
      console.log(`Son idénticos: ${same ? 'SÍ' : 'NO'}`);
      
      if (!same) {
        console.log('\nDiferencias:');
        const keys = new Set([
          ...Object.keys(recordCostumers || {}),
          ...Object.keys(recordAnderson || {})
        ]);
        
        for (const key of keys) {
          const v1 = recordCostumers[key];
          const v2 = recordAnderson[key];
          if (JSON.stringify(v1) !== JSON.stringify(v2)) {
            console.log(`  ${key}:`);
            console.log(`    costumers: ${JSON.stringify(v1)}`);
            console.log(`    Anderson:  ${JSON.stringify(v2)}`);
          }
        }
      }
    } else if (recordCostumers && !recordAnderson) {
      console.log('\n⚠️  Solo existe en costumers, NO en costumers_Anderson_Guzman');
    } else if (!recordCostumers && recordAnderson) {
      console.log('\n⚠️  Solo existe en costumers_Anderson_Guzman, NO en costumers');
    } else {
      console.log('\n❌ Ninguno de los registros fue encontrado');
    }
    
  } catch(e) {
    console.error('❌ Error:', e.message);
  } finally {
    if (client) await client.close();
  }
  process.exit(0);
}

compareRecords();
