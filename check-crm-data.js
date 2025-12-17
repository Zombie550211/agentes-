const { connectToMongoDB, getDb } = require('./config/db');

async function checkData() {
  try {
    // Conectar a la BD
    await connectToMongoDB();
    const db = getDb();
    
    if (!db) {
      console.error('No hay conexión a BD');
      process.exit(1);
    }

    console.log('✅ Conectado a MongoDB');

    // Listar todas las colecciones
    const collections = await db.listCollections().toArray();
    console.log(`\n📦 Colecciones encontradas: ${collections.length}`);
    
    const costumersCollections = collections.filter(c => /^costumers/i.test(c.name));
    console.log(`\n🔍 Colecciones de costumers: ${costumersCollections.map(c => c.name).join(', ')}`);

    // Revisar cada colección
    for (const col of costumersCollections) {
      const colName = col.name;
      const count = await db.collection(colName).countDocuments();
      console.log(`\n📊 ${colName}: ${count} documentos`);
      
      // Mostrar campos únicos de agente
      const docs = await db.collection(colName).find({}).limit(5).toArray();
      if (docs.length > 0) {
        console.log('   Campos encontrados en primer documento:');
        Object.keys(docs[0]).forEach(key => {
          console.log(`     - ${key}: ${JSON.stringify(docs[0][key]).substring(0, 50)}`);
        });
        
        // Buscar valores únicos en campos de agente
        const agentFields = ['agente', 'agenteNombre', 'nombreAgente', 'createdBy', 'registeredBy', 'vendedor'];
        for (const field of agentFields) {
          const values = await db.collection(colName).distinct(field);
          if (values.length > 0) {
            console.log(`   ${field}: ${values.slice(0, 3).join(', ')}${values.length > 3 ? '...' : ''}`);
          }
        }
      }
    }

    // Buscar específicamente por "Jonathan Morales" en todas las colecciones
    console.log('\n\n🔎 Buscando "Jonathan Morales" en todas las colecciones:');
    for (const col of costumersCollections) {
      const docs = await db.collection(col.name).find({
        $or: [
          { agente: { $regex: 'Jonathan', $options: 'i' } },
          { agenteNombre: { $regex: 'Jonathan', $options: 'i' } },
          { nombreAgente: { $regex: 'Jonathan', $options: 'i' } }
        ]
      }).limit(2).toArray();
      
      if (docs.length > 0) {
        console.log(`✅ Encontrados ${docs.length} en ${col.name}`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkData();
