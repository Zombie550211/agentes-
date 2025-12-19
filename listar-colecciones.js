// Script para listar todas las colecciones en la base de datos
require('dotenv').config();
const { connectToMongoDB, getDb, getDbFor, closeConnection } = require('./config/db');

async function listarColecciones() {
  try {
    console.log('🔌 Conectando a MongoDB...\n');
    await connectToMongoDB();
    
    const db = getDb();
    if (!db) {
      console.error('❌ No se pudo conectar a la base de datos');
      return;
    }
    
    console.log('✅ Conectado exitosamente\n');
    console.log('='.repeat(80));
    console.log('COLECCIONES EN LA BASE DE DATOS PRINCIPAL (crmagente)');
    console.log('='.repeat(80) + '\n');
    
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log(`Total de colecciones: ${collectionNames.length}\n`);
    
    // Agrupar por tipo
    const costumersCollections = collectionNames.filter(n => /^costumers/i.test(n));
    const otherCollections = collectionNames.filter(n => !/^costumers/i.test(n));
    
    console.log('📁 COLECCIONES DE CLIENTES (costumers*):');
    if (costumersCollections.length > 0) {
      costumersCollections.forEach((name, idx) => {
        console.log(`   ${idx + 1}. ${name}`);
      });
    } else {
      console.log('   (ninguna)');
    }
    
    console.log('\n📁 OTRAS COLECCIONES:');
    if (otherCollections.length > 0) {
      otherCollections.forEach((name, idx) => {
        console.log(`   ${idx + 1}. ${name}`);
      });
    } else {
      console.log('   (ninguna)');
    }
    
    // Intentar acceder a TEAM_LINEAS
    console.log('\n' + '='.repeat(80));
    console.log('COLECCIONES EN LA BASE DE DATOS TEAM_LINEAS');
    console.log('='.repeat(80) + '\n');
    
    try {
      const dbTL = getDbFor('TEAM_LINEAS');
      if (dbTL) {
        const tlCollections = await dbTL.listCollections().toArray();
        const tlNames = tlCollections.map(c => c.name);
        console.log(`Total de colecciones: ${tlNames.length}\n`);
        
        if (tlNames.length > 0) {
          tlNames.forEach((name, idx) => {
            console.log(`   ${idx + 1}. ${name}`);
          });
        } else {
          console.log('   (ninguna)');
        }
      } else {
        console.log('⚠️  Base de datos TEAM_LINEAS no disponible');
      }
    } catch (err) {
      console.log(`⚠️  Error accediendo a TEAM_LINEAS: ${err.message}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('RESUMEN');
    console.log('='.repeat(80));
    console.log(`\nColecciones costumers*: ${costumersCollections.length}`);
    console.log(`Otras colecciones: ${otherCollections.length}`);
    console.log(`Total: ${collectionNames.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await closeConnection();
    console.log('\n✅ Conexión cerrada');
  }
}

listarColecciones();
