const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');

// Configuración de conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

// Variable global para mantener la conexión
let db = null;
let __nativeClient = null;

async function connectToMongoDB() {
  try {
    if (db) {
      return db;
    }

    console.log('[DB] Conectando a MongoDB Atlas...');
    const client = new MongoClient(MONGODB_URI, { appName: 'dashboard-backend' });

    await client.connect();
    const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';
    db = client.db(DB_NAME);
    __nativeClient = client;

    console.log('[DB] Conexión nativa a MongoDB establecida correctamente');

    client.on('error', (error) => {
      console.error('[DB] Error de conexión:', error);
      db = null;
    });

    client.on('close', () => {
      console.log('[DB] Conexión nativa cerrada');
      db = null;
    });

    return db;
  } catch (error) {
    console.error('[DB] Error al conectar a MongoDB:', error);
    throw error;
  }
}

function getDb() {
  if (db) {
    return db;
  }
  console.warn('[DB] No hay conexión activa a la base de datos');
  return null;
}

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
