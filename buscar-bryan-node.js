// Script Node.js para buscar a Bryan Pleitez en todas las colecciones
const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const dbName = 'crmagente';

async function buscarBryanPleitez() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');
    
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log(`📊 Total de colecciones en ${dbName}: ${collectionNames.length}\n`);
    console.log('Colecciones encontradas:', collectionNames.join(', '), '\n');
    console.log('='.repeat(80));
    console.log('BUSCANDO "BRYAN PLEITEZ" EN TODAS LAS COLECCIONES');
    console.log('='.repeat(80) + '\n');
    
    let totalFound = 0;
    const foundIn = [];
    
    for (const colName of collectionNames) {
      try {
        const collection = db.collection(colName);
        
        const query = {
          $or: [
            { nombre_cliente: /Bryan.*Pleitez/i },
            { agenteNombre: /Bryan.*Pleitez/i },
            { agente: /Bryan.*Pleitez/i },
            { nombre: /Bryan.*Pleitez/i },
            { supervisor: /Bryan.*Pleitez/i }
          ]
        };
        
        const count = await collection.countDocuments(query);
        
        if (count > 0) {
          console.log(`\n📁 ENCONTRADO EN: ${colName}`);
          console.log(`   Registros: ${count}`);
          foundIn.push({ collection: colName, count: count });
          
          // Mostrar primeros 3 registros
          const docs = await collection.find(query).limit(3).toArray();
          
          docs.forEach((doc, idx) => {
            console.log(`\n   [${idx + 1}] _id: ${doc._id}`);
            console.log(`       nombre_cliente: ${doc.nombre_cliente || 'N/A'}`);
            console.log(`       agenteNombre: ${doc.agenteNombre || 'N/A'}`);
            console.log(`       agente: ${doc.agente || 'N/A'}`);
            console.log(`       supervisor: ${doc.supervisor || 'N/A'}`);
            console.log(`       status: ${doc.status || 'N/A'}`);
            console.log(`       dia_venta: ${doc.dia_venta || 'N/A'}`);
            console.log(`       createdAt: ${doc.createdAt || 'N/A'}`);
            console.log(`       servicios_texto: ${doc.servicios_texto || 'N/A'}`);
          });
          
          totalFound += count;
        }
      } catch (err) {
        console.log(`   ⚠️  Error en colección ${colName}: ${err.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('RESUMEN FINAL');
    console.log('='.repeat(80));
    console.log(`Total de registros encontrados: ${totalFound}`);
    console.log(`Colecciones con resultados: ${foundIn.length}`);
    
    if (foundIn.length > 0) {
      console.log('\nDesglose por colección:');
      foundIn.forEach(item => {
        console.log(`  - ${item.collection}: ${item.count} registros`);
      });
    } else {
      console.log('\n⚠️  NO SE ENCONTRÓ NINGÚN REGISTRO DE BRYAN PLEITEZ');
      console.log('Esto significa que el registro puede estar en:');
      console.log('  1. Una base de datos diferente (TEAM_LINEAS)');
      console.log('  2. Con un nombre diferente');
      console.log('  3. En una colección temporal o de respaldo');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Conexión cerrada');
  }
}

buscarBryanPleitez();
