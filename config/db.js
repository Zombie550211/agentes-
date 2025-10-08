const { MongoClient } = require('mongodb');

// Configuración de conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';

// Variable global para mantener la conexión
let db = null;

/**
 * Conecta a MongoDB Atlas y devuelve la instancia de la base de datos
 * @returns {Promise<Db>} Instancia de la base de datos conectada
 */
async function connectToMongoDB() {
  try {
    if (db && db.serverConfig && db.serverConfig.isConnected()) {
      console.log('[DB] Reutilizando conexión existente');
      return db;
    }

    console.log('[DB] Conectando a MongoDB Atlas...');
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000, // 10 segundos
      socketTimeoutMS: 45000, // 45 segundos
      maxPoolSize: 5, // Máximo 5 conexiones en el pool
      minPoolSize: 1, // Mínimo 1 conexión
    });

    // Conectar el cliente
    await client.connect();
    db = client.db('crmagente');

    console.log('[DB] Conexión a MongoDB Atlas establecida correctamente');

    // Manejar errores de conexión
    client.on('error', (error) => {
      console.error('[DB] Error de conexión:', error);
      db = null;
    });

    // Manejar desconexión
    client.on('close', () => {
      console.log('[DB] Conexión cerrada');
      db = null;
    });

    return db;
  } catch (error) {
    console.error('[DB] Error al conectar a MongoDB:', error);
    throw error;
  }
}

/**
 * Obtiene la instancia actual de la base de datos
 * @returns {Db|null} Instancia de la base de datos o null si no está conectada
 */
function getDb() {
  if (!db) {
    console.warn('[DB] No hay conexión activa a la base de datos');
  }
  return db;
}

/**
 * Cierra la conexión a la base de datos
 */
async function closeConnection() {
  try {
    if (db) {
      await db.client.close();
      db = null;
      console.log('[DB] Conexión cerrada correctamente');
    }
  } catch (error) {
    console.error('[DB] Error al cerrar conexión:', error);
  }
}

// Manejar cierre de aplicación
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
  closeConnection
};
