const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');

// --- Configuración de Conexión --- //
const MONGODB_URI_ATLAS = process.env.MONGODB_URI;
const MONGODB_URI_LOCAL = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/crmagente_local';
const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';

// --- Estado de la Conexión --- //
let db = null;
let __nativeClient = null;
let isConnected = false;
let isConnecting = false;

/**
 * Conecta a MongoDB con una estrategia de fallback para desarrollo local.
 * 1. Intenta conectar a Atlas.
 * 2. Si falla por error de red en desarrollo, intenta conectar a una DB local.
 * 3. Si todo falla, permite que la app corra sin conexión.
 */
async function connectToMongoDB() {
  if (isConnected && db) {
    return db;
  }
  if (isConnecting) {
    // Evita múltiples intentos de conexión simultáneos
    console.warn('[DB] Intento de reconexión mientras ya se está conectando. Esperando...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    return db;
  }

  isConnecting = true;

  const isDevelopment = process.env.NODE_ENV !== 'production';
  let connectionUri = MONGODB_URI_ATLAS;
  let connectionTarget = 'Atlas';

  try {
    console.log(`[DB] Intentando conectar a MongoDB ${connectionTarget}...`);
    const client = new MongoClient(connectionUri, {
      serverSelectionTimeoutMS: 5000, // Falla rápido si no hay red
      connectTimeoutMS: 5000,
      appName: 'dashboard-backend'
    });
    await client.connect();
    db = client.db(DB_NAME);
    __nativeClient = client;
    isConnected = true;
    console.log(`[DB] Conexión nativa a MongoDB ${connectionTarget} establecida.`);

    // Sincronizar conexión de Mongoose
    mongoose.connect(connectionUri, { useNewUrlParser: true })
      .then(() => console.log(`[Mongoose] Conectado a ${connectionTarget}`))
      .catch(err => console.error(`[Mongoose] Error conectando a ${connectionTarget}:`, err.message));

  } catch (error) {
    console.error(`[DB] Error al conectar a ${connectionTarget}:`, error.message);

    if (isDevelopment && (error.code === 'ECONNREFUSED' || error.name === 'MongoServerSelectionError')) {
      // --- Fallback a DB Local --- //
      connectionUri = MONGODB_URI_LOCAL;
      connectionTarget = 'Local';
      console.log('[DB] Fallback: Intentando conectar a MongoDB Local...');
      try {
        const localClient = new MongoClient(connectionUri, { serverSelectionTimeoutMS: 2000 });
        await localClient.connect();
        db = localClient.db(DB_NAME);
        __nativeClient = localClient;
        isConnected = true;
        console.log('[DB] Conexión nativa a MongoDB Local establecida.');

        mongoose.connect(connectionUri)
          .then(() => console.log('[Mongoose] Conectado a Local'))
          .catch(err => console.error('[Mongoose] Error conectando a Local:', err.message));

      } catch (localError) {
        console.error('[DB] Error al conectar a MongoDB Local:', localError.message);
        console.warn('[DB] La aplicación se ejecutará en modo OFFLINE. Las funciones de base de datos no estarán disponibles.');
        db = null;
        __nativeClient = null;
        isConnected = false;
      }
    } else {
      console.warn('[DB] La aplicación se ejecutará en modo OFFLINE. Las funciones de base de datos no estarán disponibles.');
      db = null;
      __nativeClient = null;
      isConnected = false;
    }
  }

  isConnecting = false;
  return db;
}

function getDb() {
  if (!isConnected) {
    // No mostrar warning si estamos intencionadamente offline
    return null;
  }
  return db;
}

function getDbFor(dbName) {
  if (!isConnected || !__nativeClient) return null;
  return __nativeClient.db(dbName);
}

async function closeConnection() {
  try {
    if (__nativeClient) {
      await __nativeClient.close();
    }
    await mongoose.disconnect();
    __nativeClient = null;
    db = null;
    isConnected = false;
    console.log('[DB] Conexiones (Nativa y Mongoose) cerradas.');
  } catch (error) {
    console.error('[DB] Error al cerrar conexiones:', error);
  }
}

process.on('SIGINT', async () => {
  console.log('[DB] Recibida señal de cierre, cerrando conexión...');
  await closeConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[DB] Recibida señal de terminación, cerrando conexión...');
  await closeConnection();
  process.exit(0);
});

module.exports = {
  connectToMongoDB,
  getDb,
  getDbFor,
  closeConnection,
  isConnected: () => isConnected
};
