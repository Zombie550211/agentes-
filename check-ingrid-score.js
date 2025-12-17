const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function main() {
  try {
    await client.connect();
    const db = client.db('crmagente');
    
    // Buscar registros de INGRID en todas las colecciones de costumers
    const collections = ['costumers', 'costumers_692e09'];
    
    for (const colName of collections) {
      const col = db.collection(colName);
      const pipeline = [
        {
          $match: {
            $or: [
              { agente: 'INGRID.GARCIA' },
              { agenteNombre: 'INGRID.GARCIA' },
              { nombreAgente: 'INGRID.GARCIA' },
              { createdBy: 'INGRID.GARCIA' },
              { registeredBy: 'INGRID.GARCIA' },
              { vendedor: 'INGRID.GARCIA' }
            ]
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalPuntaje: { $sum: { $toDouble: '$puntaje' } },
            avgPuntaje: { $avg: { $toDouble: '$puntaje' } }
          }
        }
      ];
      
      const result = await col.aggregate(pipeline).toArray();
      console.log(`\n📊 Colección: ${colName}`);
      if (result.length > 0) {
        console.log(`   📈 Registros: ${result[0].count}`);
        console.log(`   💰 Total puntaje: ${result[0].totalPuntaje}`);
        console.log(`   📊 Promedio: ${result[0].avgPuntaje}`);
      } else {
        console.log('   ❌ Sin registros');
      }
    }
    
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    await client.close();
  }
}

main();
