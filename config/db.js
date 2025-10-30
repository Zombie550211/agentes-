const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');

// Configuración de conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';

// Variable global para mantener la conexión
let db = null;
let __nativeClient = null;

/**
 * Conecta a MongoDB Atlas y devuelve la instancia de la base de datos
 * @returns {Promise<Db>} Instancia de la base de datos conectada
 */
async function connectToMongoDB() {
  try {
    // Reutilizar conexión nativa si ya existe
    if (db) {
      console.log('[DB] Reutilizando conexión nativa existente');
      return db;
    }

    // Reutilizar conexión de Mongoose si ya está conectada
    if (mongoose?.connection?.readyState === 1 && mongoose.connection.db) {
      db = mongoose.connection.db;
      console.log('[DB] Reutilizando conexión de Mongoose');
      return db;
    }

    console.log('[DB] Conectando a MongoDB Atlas...');
    const insecure = process.env.TLS_INSECURE === '1';
    const baseOptions = {
      serverSelectionTimeoutMS: 10000, // 10 segundos
      socketTimeoutMS: 45000, // 45 segundos
      maxPoolSize: 5, // Máximo 5 conexiones en el pool
      minPoolSize: 1, // Mínimo 1 conexión
      appName: process.env.APP_NAME || 'dashboard-backend',
      family: 4, // Preferir IPv4 para evitar issues con IPv6 en algunas redes
    };
    const tlsOptions = insecure ? {
      // Permitir certificados no válidos (sin combinar con tlsInsecure)
      tls: true,
      tlsAllowInvalidCertificates: true,
    } : {};
    const compatOptions = {
      directConnection: false,
      serverApi: { version: '1', strict: false, deprecationErrors: false },
    };
    const finalOptions = { ...baseOptions, ...tlsOptions, ...compatOptions };
    try { console.log('[DB] TLS_INSECURE=', insecure, ' opciones:', JSON.stringify(finalOptions)); } catch {}
    const client = new MongoClient(MONGODB_URI, finalOptions);

    // Conectar el cliente
    await client.connect();
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    db = client.db(DB_NAME);
    __nativeClient = client;

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
  if (db) return db;
  // Si Mongoose está conectado, reutilizar su conexión
  if (mongoose?.connection?.readyState === 1 && mongoose.connection.db) {
    db = mongoose.connection.db;
    console.log('[DB] getDb() tomó la conexión desde Mongoose');
    return db;
  }
  console.warn('[DB] No hay conexión activa a la base de datos');
  return null;
}

/**
 * Obtiene una instancia de otra base de datos reutilizando el cliente nativo actual
 * @param {string} dbName
 * @returns {import('mongodb').Db|null}
 */
function getDbFor(dbName) {
  try {
    if (__nativeClient) return __nativeClient.db(dbName);
    if (db && db.s && db.s.client) return db.s.client.db(dbName);
    return null;
  } catch (e) {
    console.warn('[DB] getDbFor error:', e?.message);
    return null;
  }
}

/**
 * Cierra la conexión a la base de datos
 */
async function closeConnection() {
  try {
    if (__nativeClient) {
      await __nativeClient.close();
      __nativeClient = null;
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
  getDbFor,
  closeConnection
};
