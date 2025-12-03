/**
 * Script para migrar clientes de la colección 'costumers' a las colecciones individuales de cada agente
 * 
 * Este script:
 * 1. Lee todos los clientes de la colección 'costumers'
 * 2. Identifica el agente de cada cliente
 * 3. Busca/crea la colección del agente
 * 4. Mueve el cliente a su colección correspondiente
 * 5. Elimina el cliente de 'costumers' (solo con --apply)
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const DRY_RUN = !process.argv.includes('--apply');
const BATCH_SIZE = 100;

let db = null;
let client = null;

// Conectar a MongoDB
async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI no está definida en .env');
  }
  
  client = new MongoClient(uri);
  await client.connect();
  db = client.db('crmagente');
  console.log('✅ Conexión a MongoDB Atlas establecida\n');
}

// Cerrar conexión
async function disconnect() {
  if (client) {
    await client.close();
  }
}

// Normalizar nombre para nombre de colección
function normalizeCollectionName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Obtener ID del agente desde el documento
function getAgentIdFromDocument(doc) {
  // Intentar diferentes campos que podrían contener el agentId
  const candidates = [
    doc.agenteId,
    doc.agente_id,
    doc.agentId,
    doc.creadoPor,
    doc.createdBy,
    doc.ownerId,
    doc.registeredById
  ];
  
  for (const candidate of candidates) {
    if (candidate) {
      // Si es ObjectId, convertir a string
      if (candidate.toHexString) return candidate.toHexString();
      if (typeof candidate === 'string' && candidate.length === 24) return candidate;
      if (typeof candidate === 'string') return candidate;
    }
  }
  
  return null;
}

// Obtener nombre del agente desde el documento
function getAgentNameFromDocument(doc) {
  return doc.agenteNombre || doc.agente || doc.agent || 'Unknown';
}

async function migrateCustomers() {
  try {
    console.log('=== MIGRACIÓN DE CLIENTES A COLECCIONES POR AGENTE ===\n');
    console.log(`Modo: ${DRY_RUN ? '🔍 DRY-RUN (simulación)' : '✅ APPLY (ejecutar cambios)'}\n`);
    
    // Conectar a la base de datos
    await connect();
    
    if (!db) {
      console.error('❌ Error: No se pudo conectar a la base de datos');
      process.exit(1);
    }
    
    console.log('✅ Conexión a MongoDB establecida\n');
    
    // Obtener total de clientes en costumers
    const totalCustomers = await db.collection('costumers').countDocuments();
    console.log(`📊 Total de clientes en 'costumers': ${totalCustomers}\n`);
    
    if (totalCustomers === 0) {
      console.log('✅ No hay clientes para migrar en la colección costumers');
      process.exit(0);
    }
    
    // Obtener mapeos existentes
    const mappings = await db.collection('user_collections').find({}).toArray();
    const userIdToCollection = new Map();
    const collectionToDisplayName = new Map();
    
    for (const map of mappings) {
      const userId = map.userId.toString();
      userIdToCollection.set(userId, map.collectionName);
      collectionToDisplayName.set(map.collectionName, map.displayName);
    }
    
    console.log(`📋 Mapeos existentes en user_collections: ${mappings.length}\n`);
    
    // Estadísticas
    const stats = {
      processed: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
      byAgent: {},
      noAgent: 0,
      newMappings: 0
    };
    
    // Obtener todos los usuarios para poder buscar por nombre
    const users = await db.collection('users').find({}).toArray();
    const usernameToUserId = new Map();
    for (const user of users) {
      const username = (user.username || user.name || '').toLowerCase().replace(/\s+/g, '');
      if (username) {
        usernameToUserId.set(username, user._id.toString());
      }
    }
    
    console.log('--- Iniciando migración ---\n');
    
    // Procesar en lotes
    let skip = 0;
    let hasMore = true;
    
    while (hasMore) {
      const customers = await db.collection('costumers')
        .find({})
        .skip(skip)
        .limit(BATCH_SIZE)
        .toArray();
      
      if (customers.length === 0) {
        hasMore = false;
        break;
      }
      
      for (const customer of customers) {
        stats.processed++;
        
        // Obtener información del agente
        let agentId = getAgentIdFromDocument(customer);
        const agentName = getAgentNameFromDocument(customer);
        
        // Si no tiene agentId pero tiene nombre, intentar buscar el usuario
        if (!agentId && agentName && agentName !== 'Unknown') {
          const normalizedName = agentName.toLowerCase().replace(/\s+/g, '');
          agentId = usernameToUserId.get(normalizedName);
          
          if (agentId && !DRY_RUN) {
            // Actualizar el documento con el agentId correcto
            customer.agenteId = agentId;
            try {
              await db.collection('costumers').updateOne(
                { _id: customer._id },
                { $set: { agenteId: agentId } }
              );
            } catch (updateError) {
              console.warn(`⚠️  No se pudo actualizar agenteId para ${customer._id}: ${updateError.message}`);
            }
          }
        }
        
        if (!agentId) {
          stats.noAgent++;
          console.log(`⚠️  Cliente sin agente: ${customer._id} - ${customer.nombre_cliente || 'Sin nombre'}`);
          continue;
        }
        
        // Determinar colección destino
        let targetCollection = userIdToCollection.get(agentId);
        
        if (!targetCollection) {
          // Crear nuevo mapeo basado en el nombre del agente
          const collectionName = `costumers_${normalizeCollectionName(agentName)}`;
          targetCollection = collectionName;
          
          console.log(`📝 Nuevo mapeo: ${agentName} (${agentId}) -> ${targetCollection}`);
          
          if (!DRY_RUN) {
            // Crear el mapeo en user_collections
            try {
              let userId;
              try {
                userId = new ObjectId(agentId);
              } catch {
                // Si agentId no es un ObjectId válido, usar el string directamente
                userId = agentId;
              }
              
              await db.collection('user_collections').updateOne(
                { userId: userId },
                { 
                  $set: { 
                    collectionName: targetCollection,
                    displayName: agentName,
                    updatedAt: new Date()
                  },
                  $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
              );
              
              userIdToCollection.set(agentId, targetCollection);
              collectionToDisplayName.set(targetCollection, agentName);
              stats.newMappings++;
            } catch (mapError) {
              console.error(`❌ Error creando mapeo para ${agentName}: ${mapError.message}`);
              stats.errors++;
              continue;
            }
          }
        }
        
        // Contar por agente
        if (!stats.byAgent[targetCollection]) {
          stats.byAgent[targetCollection] = 0;
        }
        stats.byAgent[targetCollection]++;
        
        // Migrar el documento
        if (!DRY_RUN) {
          try {
            // 1. Insertar en la colección del agente
            await db.collection(targetCollection).insertOne(customer);
            
            // 2. Eliminar de costumers
            await db.collection('costumers').deleteOne({ _id: customer._id });
            
            stats.migrated++;
            
            if (stats.migrated % 50 === 0) {
              console.log(`  ✅ Migrados: ${stats.migrated}/${stats.processed}`);
            }
          } catch (migrateError) {
            console.error(`❌ Error migrando ${customer._id}: ${migrateError.message}`);
            stats.errors++;
          }
        }
      }
      
      skip += BATCH_SIZE;
      
      if (DRY_RUN && stats.processed >= 100) {
        console.log('\n⚠️  DRY-RUN: Mostrando solo los primeros 100 documentos como muestra\n');
        hasMore = false;
      }
    }
    
    // Mostrar resumen
    console.log('\n=== RESUMEN DE MIGRACIÓN ===\n');
    console.log(`Total procesados: ${stats.processed}`);
    
    if (DRY_RUN) {
      console.log(`\n🔍 Distribución estimada por colección:`);
    } else {
      console.log(`Migrados exitosamente: ${stats.migrated}`);
      console.log(`Nuevos mapeos creados: ${stats.newMappings}`);
      console.log(`\n✅ Distribución real por colección:`);
    }
    
    // Ordenar por cantidad descendente
    const sortedAgents = Object.entries(stats.byAgent)
      .sort(([, a], [, b]) => b - a);
    
    for (const [collection, count] of sortedAgents) {
      const displayName = collectionToDisplayName.get(collection) || 'Unknown';
      console.log(`  ${collection} (${displayName}): ${count} clientes`);
    }
    
    if (stats.noAgent > 0) {
      console.log(`\n⚠️  Clientes sin agente identificable: ${stats.noAgent}`);
    }
    
    if (stats.errors > 0) {
      console.log(`\n❌ Errores durante la migración: ${stats.errors}`);
    }
    
    if (DRY_RUN) {
      console.log('\n' + '='.repeat(60));
      console.log('🔍 ESTE FUE UN DRY-RUN - NO SE HICIERON CAMBIOS');
      console.log('Para ejecutar la migración real, usa: --apply');
      console.log('='.repeat(60));
    } else {
      // Verificar que costumers esté vacío o solo tenga clientes sin agente
      const remainingCustomers = await db.collection('costumers').countDocuments();
      console.log(`\n📊 Clientes restantes en 'costumers': ${remainingCustomers}`);
      
      if (remainingCustomers === 0) {
        console.log('\n✅ ¡Migración completada! La colección costumers está vacía.');
      } else {
        console.log(`\n⚠️  Quedan ${remainingCustomers} clientes en costumers (probablemente sin agente asignado)`);
      }
    }
    
    await disconnect();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error durante la migración:', error);
    await disconnect();
    process.exit(1);
  }
}

// Ejecutar la migración
migrateCustomers();
