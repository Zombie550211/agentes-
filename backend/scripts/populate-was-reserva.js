/**
 * Script para poblar el campo was_reserva=true en todas las ventas
 * que tienen status='reserva' pero no tienen el campo was_reserva definido
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { connectToMongoDB, closeConnection } = require('../config/db');

async function populateWasReserva() {
  try {
    console.log('[POPULATE] Conectando a MongoDB...');
    const db = await connectToMongoDB();
    
    if (!db) {
      console.error('[POPULATE] ❌ No se pudo conectar a la base de datos');
      process.exit(1);
    }
    
    console.log('[POPULATE] Conectado exitosamente');
    
    // Colecciones a actualizar
    const collections = ['costumers_unified', 'costumers'];
    
    for (const collectionName of collections) {
      console.log(`\n[POPULATE] Procesando colección: ${collectionName}`);
      
      try {
        const collection = db.collection(collectionName);
        
        // Buscar documentos con status='reserva' (case insensitive) y sin was_reserva definido
        const filter = {
          $or: [
            { status: { $regex: /^reserva$/i } },
            { estado: { $regex: /^reserva$/i } }
          ],
          $or: [
            { was_reserva: { $exists: false } },
            { was_reserva: null },
            { was_reserva: false },
            { was_reserva: 'false' },
            { was_reserva: 0 }
          ]
        };
        
        // Contar documentos a actualizar
        const count = await collection.countDocuments(filter);
        console.log(`[POPULATE] Encontrados ${count} documentos con status='reserva' sin was_reserva=true`);
        
        if (count === 0) {
          console.log(`[POPULATE] No hay documentos para actualizar en ${collectionName}`);
          continue;
        }
        
        // Actualizar todos los documentos
        const result = await collection.updateMany(
          filter,
          { $set: { was_reserva: true } }
        );
        
        console.log(`[POPULATE] Actualizados ${result.modifiedCount} documentos en ${collectionName}`);
        console.log(`[POPULATE] Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
        
      } catch (error) {
        console.error(`[POPULATE] Error procesando ${collectionName}:`, error.message);
      }
    }
    
    console.log('\n[POPULATE] ✅ Proceso completado exitosamente');
    
  } catch (error) {
    console.error('[POPULATE] ❌ Error:', error);
    throw error;
  } finally {
    await closeConnection();
    console.log('[POPULATE] Conexión cerrada');
  }
}

// Ejecutar el script
populateWasReserva()
  .then(() => {
    console.log('[POPULATE] Script finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[POPULATE] Script falló:', error);
    process.exit(1);
  });
