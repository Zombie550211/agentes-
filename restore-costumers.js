const fs = require('fs');
const path = require('path');
const mongodb = require('mongodb');
const { MongoClient, ObjectId } = mongodb;

async function restoreCostumers() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/agentes_db';
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db('agentes_db');
    const collection = db.collection('costumers');

    // Leer el backup
    const backupPath = path.join(__dirname, 'backups', 'costumers.1764368998810.json');
    console.log('Leyendo backup desde:', backupPath);
    
    const fileContent = fs.readFileSync(backupPath, 'utf-8');
    const documents = JSON.parse(fileContent);

    console.log(`Restaurando ${documents.length} documentos...`);

    // Insertar los documentos
    const result = await collection.insertMany(documents, { ordered: false });
    console.log(`✓ Insertados ${result.insertedCount} documentos`);
    console.log(`✓ IDs insertados: ${Object.keys(result.insertedIds).length}`);

    // Contar total
    const total = await collection.countDocuments();
    console.log(`\nTotal de documentos en la colección: ${total}`);

    // Mostrar un documento de ejemplo
    const sample = await collection.findOne();
    console.log('\nPrimer documento:');
    console.log(JSON.stringify(sample, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
    if (err.message.includes('E11000')) {
      console.log('\n⚠️  Algunos documentos ya existen. Verificando...');
      const db = client.db('agentes_db');
      const total = await db.collection('costumers').countDocuments();
      console.log(`Total de documentos actuales: ${total}`);
    }
  } finally {
    await client.close();
  }
}

restoreCostumers().catch(console.error);
