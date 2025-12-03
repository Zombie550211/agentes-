const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');
const { protect, authorize } = require('../middleware/auth');

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

/**
 * GET /api/migrate/preview
 * Vista previa de la migración (dry-run)
 */
router.get('/preview', protect, authorize('Administrador', 'admin'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'No hay conexión a DB' });
    }

    const totalCustomers = await db.collection('costumers').countDocuments();
    
    if (totalCustomers === 0) {
      return res.json({
        success: true,
        message: 'No hay clientes para migrar',
        total: 0,
        distribution: {}
      });
    }

    // Obtener mapeos
    const mappings = await db.collection('user_collections').find({}).toArray();
    const userIdToCollection = new Map();
    for (const map of mappings) {
      userIdToCollection.set(map.userId.toString(), map.collectionName);
    }

    // Obtener usuarios
    const users = await db.collection('users').find({}).toArray();
    const usernameToUserId = new Map();
    for (const user of users) {
      const username = (user.username || user.name || '').toLowerCase().replace(/\s+/g, '');
      if (username) {
        usernameToUserId.set(username, user._id.toString());
      }
    }

    const distribution = {};
    let noAgent = 0;
    let processed = 0;

    const customers = await db.collection('costumers').find({}).limit(100).toArray();

    for (const customer of customers) {
      processed++;
      let agentId = getAgentIdFromDocument(customer);
      const agentName = getAgentNameFromDocument(customer);

      if (!agentId && agentName && agentName !== 'Unknown') {
        const normalizedName = agentName.toLowerCase().replace(/\s+/g, '');
        agentId = usernameToUserId.get(normalizedName);
      }

      if (!agentId) {
        noAgent++;
        continue;
      }

      let targetCollection = userIdToCollection.get(agentId);
      if (!targetCollection) {
        targetCollection = `costumers_${normalizeCollectionName(agentName)}`;
      }

      if (!distribution[targetCollection]) {
        distribution[targetCollection] = { count: 0, agent: agentName };
      }
      distribution[targetCollection].count++;
    }

    res.json({
      success: true,
      total: totalCustomers,
      sampled: processed,
      noAgent,
      distribution,
      mappings: mappings.length
    });

  } catch (error) {
    console.error('Error en preview:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/migrate/execute
 * Ejecutar la migración real
 */
router.post('/execute', protect, authorize('Administrador', 'admin'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'No hay conexión a DB' });
    }

    const stats = {
      processed: 0,
      migrated: 0,
      errors: 0,
      noAgent: 0,
      newMappings: 0,
      byAgent: {}
    };

    // Obtener mapeos
    const mappings = await db.collection('user_collections').find({}).toArray();
    const userIdToCollection = new Map();
    for (const map of mappings) {
      userIdToCollection.set(map.userId.toString(), map.collectionName);
    }

    // Obtener usuarios
    const users = await db.collection('users').find({}).toArray();
    const usernameToUserId = new Map();
    for (const user of users) {
      const username = (user.username || user.name || '').toLowerCase().replace(/\s+/g, '');
      if (username) {
        usernameToUserId.set(username, user._id.toString());
      }
    }

    // Procesar en lotes
    const BATCH_SIZE = 50;
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
        
        let agentId = getAgentIdFromDocument(customer);
        const agentName = getAgentNameFromDocument(customer);

        if (!agentId && agentName && agentName !== 'Unknown') {
          const normalizedName = agentName.toLowerCase().replace(/\s+/g, '');
          agentId = usernameToUserId.get(normalizedName);

          if (agentId) {
            customer.agenteId = agentId;
            try {
              await db.collection('costumers').updateOne(
                { _id: customer._id },
                { $set: { agenteId: agentId } }
              );
            } catch (updateError) {
              console.warn(`No se pudo actualizar agenteId para ${customer._id}`);
            }
          }
        }

        if (!agentId) {
          stats.noAgent++;
          continue;
        }

        let targetCollection = userIdToCollection.get(agentId);

        if (!targetCollection) {
          const collectionName = `costumers_${normalizeCollectionName(agentName)}`;
          targetCollection = collectionName;

          try {
            let userId;
            try {
              userId = new ObjectId(agentId);
            } catch {
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
            stats.newMappings++;
          } catch (mapError) {
            console.error(`Error creando mapeo para ${agentName}:`, mapError.message);
            stats.errors++;
            continue;
          }
        }

        if (!stats.byAgent[targetCollection]) {
          stats.byAgent[targetCollection] = 0;
        }
        stats.byAgent[targetCollection]++;

        try {
          await db.collection(targetCollection).insertOne(customer);
          await db.collection('costumers').deleteOne({ _id: customer._id });
          stats.migrated++;
        } catch (migrateError) {
          console.error(`Error migrando ${customer._id}:`, migrateError.message);
          stats.errors++;
        }
      }

      skip += BATCH_SIZE;
    }

    const remainingCustomers = await db.collection('costumers').countDocuments();

    res.json({
      success: true,
      message: 'Migración completada',
      stats: {
        ...stats,
        remainingInCostumers: remainingCustomers
      }
    });

  } catch (error) {
    console.error('Error en migración:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
