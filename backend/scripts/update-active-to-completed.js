// Cargar variables de entorno desde la raíz del proyecto
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { MongoClient } = require('mongodb');

/**
 * Script para actualizar todos los leads con status 'active' a 'completed'
 * 
 * Uso:
 *   node backend/scripts/update-active-to-completed.js
 */

async function updateActiveToCompleted() {
  let client;
  
  try {
    const MONGODB_URI = process.env.MONGODB_URI;
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI no está definida en las variables de entorno');
    }

    console.log('[UPDATE STATUS] 🔌 Conectando a MongoDB...');
    
    // Conectar directamente sin usar el módulo db.js
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      tlsAllowInvalidCertificates: true,
      tlsAllowInvalidHostnames: true
    });
    
    await client.connect();
    const db = client.db(DB_NAME);

    console.log('[UPDATE STATUS] ✅ Conectado a MongoDB\n');

    // Obtener la colección de costumers (leads)
    const costumersCollection = db.collection('costumers');
    
    // Primero, contar cuántos leads tienen status 'active'
    console.log('[UPDATE STATUS] Buscando leads con status "active"...');
    const countActive = await costumersCollection.countDocuments({ status: 'active' });
    
    console.log(`[UPDATE STATUS] 📊 Encontrados ${countActive} leads con status "active"\n`);
    
    if (countActive === 0) {
      console.log('[UPDATE STATUS] ✅ No hay leads para actualizar');
      process.exit(0);
    }

    // Mostrar algunos ejemplos antes de actualizar
    console.log('[UPDATE STATUS] Ejemplos de leads a actualizar:');
    const examples = await costumersCollection.find({ status: 'active' }).limit(5).toArray();
    examples.forEach((lead, idx) => {
      console.log(`  ${idx + 1}. ${lead.nombre_cliente || lead.clientName || 'SIN NOMBRE'} - Status: ${lead.status}`);
    });
    console.log('');

    // Actualizar todos los leads con status 'active' a 'completed'
    console.log('[UPDATE STATUS] 🔄 Actualizando status de "active" a "completed"...');
    
    const updateResult = await costumersCollection.updateMany(
      { status: 'active' },
      { $set: { status: 'completed' } }
    );

    console.log('\n[UPDATE STATUS] ✅ Actualización completada:');
    console.log(`  - Documentos encontrados: ${updateResult.matchedCount}`);
    console.log(`  - Documentos actualizados: ${updateResult.modifiedCount}`);

    // Verificar que ya no hay leads con status 'active'
    const remainingActive = await costumersCollection.countDocuments({ status: 'active' });
    console.log(`  - Leads con status "active" restantes: ${remainingActive}`);

    // Contar cuántos leads tienen ahora status 'completed'
    const totalCompleted = await costumersCollection.countDocuments({ status: 'completed' });
    console.log(`  - Total de leads con status "completed": ${totalCompleted}\n`);

    console.log('[UPDATE STATUS] ✅ Script completado exitosamente');

  } catch (error) {
    console.error('[UPDATE STATUS] ❌ Error:', error);
    process.exit(1);
  } finally {
    // Cerrar la conexión
    if (client) {
      await client.close();
      console.log('[UPDATE STATUS] 🔌 Conexión cerrada');
    }
    process.exit(0);
  }
}

// Ejecutar el script
updateActiveToCompleted();
