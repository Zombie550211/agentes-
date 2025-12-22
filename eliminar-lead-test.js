 const { MongoClient } = require('mongodb');
require('dotenv').config();

async function eliminarLeadTest() {
  // Intentar primero con Atlas, luego con local
  const uris = [
    process.env.MONGODB_URI,
    'mongodb://localhost:27017'
  ];
  
  let client = null;
  let connectedUri = null;
  
  for (const uri of uris) {
    if (!uri) continue;
    
    try {
      console.log(`🔗 Intentando conectar a: ${uri.substring(0, 30)}...`);
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        tls: uri.includes('mongodb+srv'),
        tlsAllowInvalidCertificates: true
      });
      await client.connect();
      connectedUri = uri;
      console.log('✅ Conectado exitosamente');
      break;
    } catch (err) {
      console.log(`❌ Falló conexión: ${err.message}`);
      client = null;
    }
  }
  
  if (!client) {
    console.error('❌ No se pudo conectar a ninguna base de datos');
    return;
  }
  
  const dbName = 'crmagente';
  
  try {
    const db = client.db(dbName);
    
    // Buscar el lead de prueba con los datos de la imagen
    const leadToDelete = {
      nombre_cliente: "NATALIA APONTE RODRIGUEZ",
      telefono: "6896128",
      direccion: "9875 Upper Strasburg Rd Upperstrasburg PA 17265 APT 3"
    };
    
    console.log('\n🔍 Buscando lead de prueba...');
    console.log('Criterios:', leadToDelete);
    
    // Buscar en todas las colecciones costumers*
    const collections = await db.listCollections().toArray();
    const costumersCollections = collections
      .map(c => c.name)
      .filter(name => name.startsWith('costumers'));
    
    console.log(`\n📁 Colecciones a revisar: ${costumersCollections.length}`);
    
    let totalDeleted = 0;
    
    for (const collName of costumersCollections) {
      try {
        const collection = db.collection(collName);
        
        // Buscar documentos que coincidan
        const found = await collection.find(leadToDelete).toArray();
        
        if (found.length > 0) {
          console.log(`\n✅ Encontrado en ${collName}: ${found.length} documento(s)`);
          
          // Mostrar los documentos encontrados
          found.forEach((doc, idx) => {
            console.log(`\n  Documento ${idx + 1}:`);
            console.log(`    _id: ${doc._id}`);
            console.log(`    agente: ${doc.agente || 'N/A'}`);
            console.log(`    agenteNombre: ${doc.agenteNombre || 'N/A'}`);
            console.log(`    asignadoPor: ${doc.asignadoPor || 'N/A'}`);
            console.log(`    creadoEn: ${doc.creadoEn || 'N/A'}`);
          });
          
          // Eliminar los documentos
          const result = await collection.deleteMany(leadToDelete);
          console.log(`  🗑️  Eliminados: ${result.deletedCount} documento(s)`);
          totalDeleted += result.deletedCount;
        }
      } catch (err) {
        console.warn(`⚠️  Error en colección ${collName}:`, err.message);
      }
    }
    
    console.log(`\n✅ Total eliminados: ${totalDeleted} documento(s)`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('\n🔌 Conexión cerrada');
  }
}

eliminarLeadTest();
