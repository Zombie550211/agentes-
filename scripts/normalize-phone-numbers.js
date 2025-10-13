/**
 * Script para normalizar números de teléfono en la base de datos
 * 
 * Este script:
 * 1. Conecta a la base de datos MongoDB
 * 2. Busca todos los documentos con telefono_principal
 * 3. Normaliza los números eliminando paréntesis, guiones, espacios, etc.
 * 4. Actualiza los documentos con el formato normalizado (solo dígitos)
 * 
 * Uso:
 *   node scripts/normalize-phone-numbers.js
 *   node scripts/normalize-phone-numbers.js --dry-run  (para ver cambios sin aplicarlos)
 *   node scripts/normalize-phone-numbers.js --collection=leads  (para normalizar solo leads)
 *   node scripts/normalize-phone-numbers.js --collection=costumers  (para normalizar solo costumers)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { normalizePhone, isValidPhone } = require('../utils/phoneNormalizer');

// Modelos
const Lead = require('../models/Lead');
const Costumer = require('../models/Costumer');

// Configuración
const isDryRun = process.argv.includes('--dry-run');
const collectionArg = process.argv.find(arg => arg.startsWith('--collection='));
const targetCollection = collectionArg ? collectionArg.split('=')[1] : 'all';

// Estadísticas
const stats = {
  leads: { total: 0, updated: 0, skipped: 0, invalid: 0 },
  costumers: { total: 0, updated: 0, skipped: 0, invalid: 0 }
};

/**
 * Normaliza los números de teléfono en una colección usando conexión directa
 */
async function normalizeCollection(collectionName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Procesando colección: ${collectionName}`);
  console.log('='.repeat(60));
  
  try {
    const db = mongoose.connection.db;
    const collection = db.collection(collectionName);
    
    // Buscar todos los documentos con telefono_principal
    const documents = await collection.find({
      telefono_principal: { $exists: true, $ne: null, $ne: '' }
    }).toArray();
    
    stats[collectionName].total = documents.length;
    console.log(`\nEncontrados ${documents.length} documentos con telefono_principal\n`);
    
    if (documents.length === 0) {
      console.log('No hay documentos para procesar.');
      return;
    }
    
    // Procesar cada documento
    for (const doc of documents) {
      const originalPhone = doc.telefono_principal;
      const normalizedPhone = normalizePhone(originalPhone);
      
      // Si el teléfono ya está normalizado, saltar
      if (originalPhone === normalizedPhone) {
        stats[collectionName].skipped++;
        continue;
      }
      
      // Validar que el teléfono normalizado sea válido (10 dígitos)
      if (!isValidPhone(normalizedPhone)) {
        stats[collectionName].invalid++;
        console.log(`⚠️  INVÁLIDO: ${originalPhone} -> ${normalizedPhone} (${normalizedPhone.length} dígitos)`);
        console.log(`   ID: ${doc._id}, Cliente: ${doc.nombre_cliente || 'Sin nombre'}`);
        continue;
      }
      
      // Mostrar el cambio
      console.log(`✓ ${originalPhone} -> ${normalizedPhone}`);
      console.log(`  ID: ${doc._id}, Cliente: ${doc.nombre_cliente || 'Sin nombre'}`);
      
      // Actualizar el documento si no es dry-run
      if (!isDryRun) {
        await collection.updateOne(
          { _id: doc._id },
          { 
            $set: { 
              telefono_principal: normalizedPhone,
              actualizadoEn: new Date()
            }
          }
        );
      }
      
      stats[collectionName].updated++;
    }
    
    // Mostrar resumen de la colección
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`Resumen de ${collectionName}:`);
    console.log(`  Total procesados: ${stats[collectionName].total}`);
    console.log(`  Actualizados:     ${stats[collectionName].updated}`);
    console.log(`  Ya normalizados:  ${stats[collectionName].skipped}`);
    console.log(`  Inválidos:        ${stats[collectionName].invalid}`);
    console.log('-'.repeat(60));
    
  } catch (error) {
    console.error(`Error procesando ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('SCRIPT DE NORMALIZACIÓN DE NÚMEROS DE TELÉFONO');
  console.log('='.repeat(60));
  console.log(`Modo: ${isDryRun ? 'DRY RUN (sin cambios)' : 'PRODUCCIÓN (aplicará cambios)'}`);
  console.log(`Colección: ${targetCollection}`);
  console.log('='.repeat(60));
  
  try {
    // Conectar a MongoDB
    console.log('\nConectando a MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ Conectado a MongoDB');
    
    // Procesar colecciones según el argumento
    if (targetCollection === 'all' || targetCollection === 'leads') {
      await normalizeCollection('leads');
    }
    
    if (targetCollection === 'all' || targetCollection === 'costumers') {
      await normalizeCollection('costumers');
    }
    
    // Mostrar resumen final
    console.log('\n' + '='.repeat(60));
    console.log('RESUMEN FINAL');
    console.log('='.repeat(60));
    
    const totalProcessed = stats.leads.total + stats.costumers.total;
    const totalUpdated = stats.leads.updated + stats.costumers.updated;
    const totalSkipped = stats.leads.skipped + stats.costumers.skipped;
    const totalInvalid = stats.leads.invalid + stats.costumers.invalid;
    
    console.log(`\nTotal de documentos procesados: ${totalProcessed}`);
    console.log(`  ✓ Actualizados:     ${totalUpdated}`);
    console.log(`  - Ya normalizados:  ${totalSkipped}`);
    console.log(`  ⚠️  Inválidos:        ${totalInvalid}`);
    
    if (isDryRun) {
      console.log('\n⚠️  MODO DRY RUN: No se aplicaron cambios a la base de datos');
      console.log('   Ejecuta sin --dry-run para aplicar los cambios');
    } else {
      console.log('\n✓ Cambios aplicados exitosamente');
    }
    
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n❌ Error durante la ejecución:', error);
    process.exit(1);
  } finally {
    // Cerrar conexión
    await mongoose.connection.close();
    console.log('Conexión cerrada\n');
  }
}

// Ejecutar el script
main();
