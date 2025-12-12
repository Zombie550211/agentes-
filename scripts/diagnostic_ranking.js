#!/usr/bin/env node
/**
 * Diagnostic script para revisar duplicados en ranking de noviembre
 * Ejecutar: node scripts/diagnostic_ranking.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/dashboard';
const DB_NAME = process.env.DB_NAME || 'dashboard';
// Alternativamente, si la BD está en la URL, extraerla (ej. crmagente del URL)
const dbFromUrl = MONGO_URI.match(/\/([^/?]+)(\?|$)/)?.[1];
const finalDB = dbFromUrl || DB_NAME;

async function diagnoseRanking() {
  console.log(`\n[DIAGNOSTIC] Conectando a ${MONGO_URI}...\n`);
  
  const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
  
  try {
    await client.connect();
    const db = client.db(finalDB);
    
    // Listar todas las colecciones costumers*
    console.log('[DIAGNOSTIC] Listando colecciones costumers*...');
    const allCollections = await db.listCollections().toArray();
    const costumersCollections = allCollections
      .map(c => c.name)
      .filter(n => /^costumers/i.test(n))
      .sort();
    
    console.log(`[DIAGNOSTIC] Encontradas ${costumersCollections.length} colecciones:\n`);
    costumersCollections.forEach(c => console.log(`  - ${c}`));
    
    // Rango de noviembre
    const startNov = new Date('2025-11-01T00:00:00Z');
    const endNov = new Date('2025-12-01T00:00:00Z');
    console.log(`\n[DIAGNOSTIC] Buscando documentos de noviembre (${startNov.toISOString()} a ${endNov.toISOString()})\n`);
    
    // Agregar por colección
    const results = new Map(); // key: nombreNormalizado, value: { agentes, colecciones }
    let totalDocs = 0;
    
    for (const colName of costumersCollections) {
      const col = db.collection(colName);
      
      // Buscar documentos de noviembre (intentar tanto por dia_venta como por createdAt)
      const docs = await col.find({
        $or: [
          { dia_venta: { $gte: startNov, $lt: endNov } },
          { createdAt: { $gte: startNov, $lt: endNov } },
          { dia_venta: /\/11\/2025$/ } // fallback para strings d/m/yyyy
        ]
      }, { projection: { agenteNombre: 1, dia_venta: 1, createdAt: 1, puntaje: 1 } })
        .toArray();
      
      if (docs.length > 0) {
        console.log(`[${colName}] ${docs.length} documentos encontrados`);
        totalDocs += docs.length;
        
        // Agrupar por nombre normalizado
        for (const doc of docs) {
          const nombre = doc.agenteNombre || '(sin nombre)';
          const normalized = String(nombre)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toLowerCase();
          
          if (!results.has(normalized)) {
            results.set(normalized, {
              nombre: nombre,
              colecciones: new Set(),
              count: 0
            });
          }
          const entry = results.get(normalized);
          entry.colecciones.add(colName);
          entry.count += 1;
        }
      }
    }
    
    console.log(`\n[DIAGNOSTIC] Total documentos de noviembre: ${totalDocs}\n`);
    
    // Mostrar agentes que aparecen en múltiples colecciones (duplicados potenciales)
    console.log('[DIAGNOSTIC] === POTENCIALES DUPLICADOS ===\n');
    let duplicateCount = 0;
    const sorted = Array.from(results.entries())
      .sort((a, b) => b[1].colecciones.size - a[1].colecciones.size);
    
    for (const [normalized, entry] of sorted) {
      if (entry.colecciones.size > 1) {
        duplicateCount++;
        console.log(`${duplicateCount}. "${entry.nombre}"`);
        console.log(`   Encontrado en: ${Array.from(entry.colecciones).join(', ')}`);
        console.log(`   Documentos totales: ${entry.count}\n`);
      }
    }
    
    if (duplicateCount === 0) {
      console.log('✓ No se encontraron agentes duplicados en múltiples colecciones.\n');
    } else {
      console.log(`\n✗ Se encontraron ${duplicateCount} agentes que aparecen en múltiples colecciones.\n`);
    }
    
    // Estadísticas finales
    console.log('[DIAGNOSTIC] === ESTADÍSTICAS ===\n');
    console.log(`Colecciones procesadas: ${costumersCollections.length}`);
    console.log(`Total documentos nov: ${totalDocs}`);
    console.log(`Agentes únicos (por nombre normalizado): ${results.size}`);
    console.log(`Agentes en múltiples colecciones: ${duplicateCount}`);
    
  } catch (error) {
    console.error('[DIAGNOSTIC] Error:', error.message || error);
  } finally {
    await client.close();
    console.log('\n[DIAGNOSTIC] Conexión cerrada.\n');
  }
}

diagnoseRanking();
