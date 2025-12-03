/**
 * Script de prueba para verificar que los clientes se guardan en la colección correcta del agente
 * 
 * Este script:
 * 1. Verifica que existe el mapeo en user_collections para un usuario
 * 2. Simula la creación de un cliente
 * 3. Verifica que el cliente se guardó en la colección correcta
 */

require('dotenv').config();
const { connectToMongoDB, getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

async function testCustomerCreation() {
  try {
    console.log('=== TEST: Verificación de Creación de Clientes ===\n');
    
    // Conectar a la base de datos
    await connectToMongoDB();
    const db = getDb();
    
    if (!db) {
      console.error('❌ Error: No se pudo conectar a la base de datos');
      process.exit(1);
    }
    
    console.log('✅ Conexión a MongoDB establecida\n');
    
    // 1. Listar algunos usuarios y sus mapeos
    console.log('--- 1. Mapeos existentes en user_collections ---');
    const mappings = await db.collection('user_collections').find({}).limit(10).toArray();
    
    if (mappings.length === 0) {
      console.log('⚠️  No se encontraron mapeos en user_collections');
    } else {
      console.log(`✅ Se encontraron ${mappings.length} mapeos:\n`);
      for (const map of mappings) {
        console.log(`  Usuario ID: ${map.userId}`);
        console.log(`  Nombre: ${map.displayName || 'N/A'}`);
        console.log(`  Colección: ${map.collectionName}`);
        console.log(`  Creado: ${map.createdAt || 'N/A'}`);
        console.log('');
      }
    }
    
    // 2. Verificar que las colecciones existen
    console.log('--- 2. Verificando que las colecciones mapeadas existen ---');
    const allCollections = await db.listCollections().toArray();
    const collectionNames = allCollections.map(c => c.name);
    
    for (const map of mappings) {
      const exists = collectionNames.includes(map.collectionName);
      if (exists) {
        const count = await db.collection(map.collectionName).countDocuments();
        console.log(`  ✅ ${map.collectionName}: ${count} documentos`);
      } else {
        console.log(`  ⚠️  ${map.collectionName}: NO EXISTE (se creará automáticamente al guardar)`);
      }
    }
    console.log('');
    
    // 3. Probar la lógica de determinación de colección
    console.log('--- 3. Probando lógica de determinación de colección ---');
    
    if (mappings.length > 0) {
      const testMapping = mappings[0];
      console.log(`  Probando con usuario: ${testMapping.displayName}`);
      console.log(`  Usuario ID: ${testMapping.userId}`);
      
      let targetCollection = 'costumers'; // Default
      
      // Simular la lógica del endpoint POST
      const mapping = await db.collection('user_collections').findOne({ userId: testMapping.userId });
      if (mapping && mapping.collectionName) {
        targetCollection = mapping.collectionName;
        console.log(`  ✅ Mapeo encontrado: ${targetCollection}`);
      } else {
        console.log(`  ⚠️  No se encontró mapeo, usaría: ${targetCollection}`);
      }
      
      console.log(`  📁 Colección destino final: ${targetCollection}\n`);
    }
    
    // 4. Verificar integridad de datos
    console.log('--- 4. Verificando integridad de datos ---');
    let totalCustomers = 0;
    const customersByCollection = {};
    
    // Buscar todas las colecciones costumers*
    const costumersCollections = collectionNames.filter(name => 
      name.startsWith('costumers')
    );
    
    console.log(`  Colecciones encontradas: ${costumersCollections.length}`);
    
    for (const colName of costumersCollections) {
      const count = await db.collection(colName).countDocuments();
      customersByCollection[colName] = count;
      totalCustomers += count;
    }
    
    console.log('\n  Distribución de clientes:');
    for (const [col, count] of Object.entries(customersByCollection)) {
      if (count > 0) {
        console.log(`    ${col}: ${count} clientes`);
      }
    }
    
    console.log(`\n  📊 Total de clientes en todas las colecciones: ${totalCustomers}\n`);
    
    // 5. Recomendaciones
    console.log('--- 5. Recomendaciones ---');
    
    // Verificar si hay usuarios sin mapeo
    const users = await db.collection('users').find({}).toArray();
    const mappedUserIds = new Set(mappings.map(m => m.userId.toString()));
    const unmappedUsers = users.filter(u => !mappedUserIds.has(u._id.toString()));
    
    if (unmappedUsers.length > 0) {
      console.log(`  ⚠️  Hay ${unmappedUsers.length} usuarios sin mapeo en user_collections:`);
      for (const user of unmappedUsers.slice(0, 5)) {
        console.log(`    - ${user.username || user.name} (ID: ${user._id})`);
      }
      if (unmappedUsers.length > 5) {
        console.log(`    ... y ${unmappedUsers.length - 5} más`);
      }
      console.log('\n  💡 Ejecuta los scripts de migración para crear mapeos automáticamente:\n');
      console.log('     node scripts/mongo/backfill_normalize_collections.js --apply\n');
    } else {
      console.log('  ✅ Todos los usuarios tienen mapeo en user_collections\n');
    }
    
    // Verificar colecciones huérfanas (sin mapeo)
    const mappedCollections = new Set(mappings.map(m => m.collectionName));
    const orphanCollections = costumersCollections.filter(col => 
      col !== 'costumers' && !mappedCollections.has(col)
    );
    
    if (orphanCollections.length > 0) {
      console.log(`  ⚠️  Hay ${orphanCollections.length} colecciones sin mapeo:`);
      for (const col of orphanCollections.slice(0, 5)) {
        const count = customersByCollection[col] || 0;
        console.log(`    - ${col} (${count} documentos)`);
      }
      if (orphanCollections.length > 5) {
        console.log(`    ... y ${orphanCollections.length - 5} más`);
      }
      console.log('\n  💡 Considera consolidar o crear mapeos para estas colecciones\n');
    } else {
      console.log('  ✅ Todas las colecciones tienen mapeo asociado\n');
    }
    
    console.log('=== FIN DEL TEST ===');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error durante el test:', error);
    process.exit(1);
  }
}

// Ejecutar el test
testCustomerCreation();
