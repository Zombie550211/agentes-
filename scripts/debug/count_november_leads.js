const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/crmagente';
  const dbName = process.env.MONGODB_DBNAME || 'crmagente';
  const client = new MongoClient(uri, { appName: 'debug-count-november' });

  const start = new Date(Date.UTC(2025, 10, 1, 0, 0, 0, 0)); // Nov 1, 2025 UTC
  const endExclusive = new Date(Date.UTC(2025, 11, 1, 0, 0, 0, 0)); // Dec 1, 2025 UTC (exclusive)

  const stringPatterns = [
    /^2025-11/i,
    /\b11\/2025\b/i,
    /\b11-2025\b/i,
    /nov\s+2025/i,
    /noviembre\s+2025/i
  ];

  try {
    console.log('Conectando a MongoDB...');
    await client.connect();
    const db = client.db(dbName);

    const collections = (await db.listCollections().toArray())
      .map(c => c.name)
      .filter(name => /^costumers(_|$)/i.test(name));

    console.log(`Colecciones costumers*: ${collections.join(', ')}`);

    let total = 0;

    for (const name of collections) {
      const col = db.collection(name);

      const orClauses = [
        {
          $and: [
            { dia_venta: { $type: 'date' } },
            { dia_venta: { $gte: start } },
            { dia_venta: { $lt: endExclusive } }
          ]
        }
      ];

      for (const regex of stringPatterns) {
        orClauses.push({
          $and: [
            { dia_venta: { $type: 'string' } },
            { dia_venta: { $regex: regex } }
          ]
        });
      }

      const query = { $or: orClauses };

      const count = await col.countDocuments(query);
      total += count;

      console.log(`Colección ${name}: ${count} registros con dia_venta en noviembre 2025`);

      const sample = await col
        .find(query, { projection: { dia_venta: 1, supervisor: 1, nombre_cliente: 1 } })
        .limit(5)
        .toArray();

      if (sample.length) {
        console.log(`  Ejemplos (${sample.length}):`);
        sample.forEach((doc, idx) => {
          console.log(`   ${idx + 1}. ${doc.nombre_cliente || '(sin nombre)'} - supervisor: ${doc.supervisor || 'N/D'} - dia_venta: ${doc.dia_venta}`);
        });
      }
    }

    console.log('\nTOTAL noviembre 2025 (dia_venta):', total);
  } catch (err) {
    console.error('Error al contar documentos:', err);
  } finally {
    await client.close();
  }
}

main();
