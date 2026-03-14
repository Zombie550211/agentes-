/**
 * Script para normalizar el nombre de INGRID VANESSA REYES GARCIA a "Ingrid Garcia"
 * 
 * Actualiza:
 * 1. El campo 'nombre' en la colección 'users'
 * 2. El campo 'agente' y 'agenteNombre' en todos los leads de INGRID
 * 
 * Ejecutar con: node backend/scripts/update-ingrid-name.js
 */

require('dotenv').config();
const { connectToMongoDB, getDb, closeConnection } = require('../config/db');

async function updateIngridName() {
  console.log('[UPDATE INGRID] Iniciando actualización del nombre de INGRID...\n');

  try {
    // Conectar a la base de datos
    await connectToMongoDB();
    const db = getDb();

    if (!db) {
      throw new Error('No se pudo conectar a la base de datos');
    }

    console.log('[UPDATE INGRID] ✅ Conectado a MongoDB\n');

    // 1. Actualizar el nombre en la colección users
    const usersCollection = db.collection('users');
    
    console.log('[UPDATE INGRID] Buscando usuario INGRID...');
    const ingridUser = await usersCollection.findOne({
      $or: [
        { nombre: /INGRID.*REYES.*GARCIA/i },
        { name: /INGRID.*REYES.*GARCIA/i },
        { username: /INGRID.*GARCIA/i }
      ]
    });

    if (!ingridUser) {
      console.log('[UPDATE INGRID] ⚠️  No se encontró el usuario INGRID');
      return;
    }

    console.log('[UPDATE INGRID] Usuario encontrado:');
    console.log(`  - _id: ${ingridUser._id}`);
    console.log(`  - nombre actual: ${ingridUser.nombre || ingridUser.name}`);
    console.log(`  - username: ${ingridUser.username}`);
    console.log(`  - role: ${ingridUser.role || ingridUser.rol}`);

    // Actualizar el nombre del usuario
    const userUpdateResult = await usersCollection.updateOne(
      { _id: ingridUser._id },
      { 
        $set: { 
          nombre: 'Ingrid Garcia',
          name: 'Ingrid Garcia'
        } 
      }
    );

    console.log(`\n[UPDATE INGRID] ✅ Usuario actualizado (${userUpdateResult.modifiedCount} documento)`);

    // 2. Actualizar todos los leads donde agente sea "INGRID VANESSA REYES GARCIA"
    const leadsCollections = [
      'costumers',
      'app_leads',
      'unified_leads'
    ];

    let totalLeadsUpdated = 0;

    for (const collectionName of leadsCollections) {
      try {
        const collection = db.collection(collectionName);
        
        // Contar leads antes de actualizar
        const countBefore = await collection.countDocuments({
          $or: [
            { agente: 'INGRID VANESSA REYES GARCIA' },
            { agenteNombre: 'INGRID VANESSA REYES GARCIA' }
          ]
        });

        if (countBefore === 0) {
          console.log(`\n[UPDATE INGRID] ℹ️  No hay leads de INGRID en ${collectionName}`);
          continue;
        }

        console.log(`\n[UPDATE INGRID] Actualizando ${countBefore} leads en ${collectionName}...`);

        // Actualizar los leads
        const leadsUpdateResult = await collection.updateMany(
          {
            $or: [
              { agente: 'INGRID VANESSA REYES GARCIA' },
              { agenteNombre: 'INGRID VANESSA REYES GARCIA' }
            ]
          },
          {
            $set: {
              agente: 'Ingrid Garcia',
              agenteNombre: 'Ingrid Garcia'
            }
          }
        );

        console.log(`[UPDATE INGRID] ✅ ${leadsUpdateResult.modifiedCount} leads actualizados en ${collectionName}`);
        totalLeadsUpdated += leadsUpdateResult.modifiedCount;

      } catch (err) {
        console.log(`[UPDATE INGRID] ⚠️  Colección ${collectionName} no existe o error: ${err.message}`);
      }
    }

    console.log(`\n[UPDATE INGRID] ═══════════════════════════════════════`);
    console.log(`[UPDATE INGRID] ✅ Actualización completada exitosamente`);
    console.log(`[UPDATE INGRID] Total de leads actualizados: ${totalLeadsUpdated}`);
    console.log(`[UPDATE INGRID] ═══════════════════════════════════════\n`);

  } catch (error) {
    console.error('\n[UPDATE INGRID] ❌ Error durante la actualización:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cerrar conexión
    await closeConnection();
    console.log('[UPDATE INGRID] 🔌 Conexión cerrada\n');
  }
}

// Ejecutar actualización
updateIngridName()
  .then(() => {
    console.log('[UPDATE INGRID] 🎉 Proceso completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[UPDATE INGRID] 💥 Error fatal:', error.message);
    process.exit(1);
  });
