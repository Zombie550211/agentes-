/**
 * ═══════════════════════════════════════════════════════════════
 *  SCRIPT DE MIGRACIÓN: Agregar campos de reset de contraseña
 *  
 *  Este script agrega los campos necesarios para el sistema de
 *  recuperación de contraseña a todos los usuarios existentes.
 *  
 *  Ejecutar con:
 *    node backend/scripts/migrate-add-reset-fields.js
 *  
 *  Campos que se agregan:
 *    - reset_code_hash: VARCHAR(60) - Hash bcrypt del código de 6 dígitos
 *    - reset_code_expires_at: Date - Fecha de expiración del código
 *    - reset_code_attempts: Number - Contador de intentos fallidos
 *    - reset_token_hash: VARCHAR(60) - Hash bcrypt del resetToken
 *    - reset_token_expires_at: Date - Fecha de expiración del token
 *    - reset_token_used: Boolean - Si el token ya fue utilizado
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { connectToMongoDB, getDb, closeConnection } = require('../config/db');

async function migrateResetFields() {
  console.log('[MIGRATE] Iniciando migración de campos de reset...\n');

  try {
    // Conectar a la base de datos
    await connectToMongoDB();
    const db = getDb();

    if (!db) {
      throw new Error('No se pudo conectar a la base de datos');
    }

    console.log('[MIGRATE] ✅ Conectado a MongoDB\n');

    // Obtener todos los usuarios
    const usersCollection = db.collection('users');
    const totalUsers = await usersCollection.countDocuments();

    console.log(`[MIGRATE] 📊 Total de usuarios encontrados: ${totalUsers}\n`);

    if (totalUsers === 0) {
      console.log('[MIGRATE] ⚠️  No hay usuarios en la base de datos. Migración no necesaria.\n');
      return;
    }

    // Actualizar todos los usuarios que no tengan los campos
    const result = await usersCollection.updateMany(
      {
        $or: [
          { reset_code_hash: { $exists: false } },
          { reset_code_expires_at: { $exists: false } },
          { reset_code_attempts: { $exists: false } },
          { reset_token_hash: { $exists: false } },
          { reset_token_expires_at: { $exists: false } },
          { reset_token_used: { $exists: false } }
        ]
      },
      {
        $set: {
          reset_code_hash: null,
          reset_code_expires_at: null,
          reset_code_attempts: 0,
          reset_token_hash: null,
          reset_token_expires_at: null,
          reset_token_used: false
        }
      }
    );

    console.log('[MIGRATE] 📝 Resultados de la migración:');
    console.log(`  - Documentos encontrados: ${result.matchedCount}`);
    console.log(`  - Documentos actualizados: ${result.modifiedCount}`);
    console.log(`  - Documentos sin cambios: ${result.matchedCount - result.modifiedCount}\n`);

    // Crear índice en username para búsquedas rápidas (si no existe)
    try {
      await usersCollection.createIndex({ username: 1 }, { unique: true, background: true });
      console.log('[MIGRATE] ✅ Índice en campo "username" verificado/creado\n');
    } catch (indexError) {
      if (indexError.code === 85 || indexError.code === 11000) {
        console.log('[MIGRATE] ℹ️  Índice en "username" ya existe\n');
      } else {
        console.warn('[MIGRATE] ⚠️  Error al crear índice:', indexError.message);
      }
    }

    // Verificar algunos usuarios actualizados
    const sampleUsers = await usersCollection.find({}).limit(3).toArray();
    
    console.log('[MIGRATE] 🔍 Muestra de usuarios actualizados:');
    sampleUsers.forEach((user, idx) => {
      console.log(`\n  Usuario ${idx + 1}:`);
      console.log(`    - username: ${user.username}`);
      console.log(`    - email: ${user.email || 'N/A'}`);
      console.log(`    - reset_code_hash: ${user.reset_code_hash || 'null'}`);
      console.log(`    - reset_code_attempts: ${user.reset_code_attempts}`);
      console.log(`    - reset_token_used: ${user.reset_token_used}`);
    });

    console.log('\n[MIGRATE] ✅ Migración completada exitosamente\n');

  } catch (error) {
    console.error('\n[MIGRATE] ❌ Error durante la migración:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cerrar conexión
    await closeConnection();
    console.log('[MIGRATE] 🔌 Conexión cerrada\n');
  }
}

// Ejecutar migración
migrateResetFields()
  .then(() => {
    console.log('[MIGRATE] 🎉 Proceso completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[MIGRATE] 💥 Error fatal:', error.message);
    process.exit(1);
  });
