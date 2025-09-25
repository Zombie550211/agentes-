const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

// Configuración de conexión
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';
const MONGODB_DB = process.env.MONGODB_DB || 'crmagente'; // Forzar siempre crmagente

// Opciones de conexión mejoradas
const mongoOptions = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 10000, // 10 segundos
  socketTimeoutMS: 45000, // 45 segundos
  maxPoolSize: 10, // Número máximo de conexiones en el pool
  retryWrites: true,
  w: 'majority'
};

let client = null;
let db = null;
let isConnecting = false;
let connectionPromise = null;

async function connectToMongoDB() {
  // Si ya hay una conexión en curso, devolver esa promesa
  if (isConnecting) {
    console.log('[MongoDB] Ya hay una conexión en curso, reutilizando...');
    return connectionPromise;
  }

  // Si ya estamos conectados, devolver la conexión existente
  if (db) {
    return Promise.resolve(db);
  }

  isConnecting = true;
  
  connectionPromise = new Promise(async (resolve, reject) => {
    try {
      console.log(`[MongoDB] Conectando a la base de datos...`);
      
      // Crear una nueva instancia del cliente
      client = new MongoClient(MONGODB_URI, mongoOptions);
      
      // Conectar al servidor
      await client.connect();
      
      // Seleccionar la base de datos
      db = client.db(MONGODB_DB);
      
      // Verificar la conexión
      await db.command({ ping: 1 });
      
      console.log(`[MongoDB] Conectado exitosamente a: ${db.databaseName} (MongoDB Atlas)`);
      console.log(`[AUTH-DB] Base de datos para autenticación: ${db.databaseName}`);
      
      // Configurar manejadores de eventos
      client.on('serverClosed', () => {
        console.log('[MongoDB] Conexión cerrada por el servidor');
        db = null;
        isConnecting = false;
      });
      
      client.on('error', (err) => {
        console.error('[MongoDB] Error de conexión:', err);
        db = null;
        isConnecting = false;
      });
      
      resolve(db);
    } catch (error) {
      console.error('[MongoDB] Error al conectar a la base de datos:', error);
      db = null;
      isConnecting = false;
      reject(error);
    }
  });

  return connectionPromise;
}

async function closeConnection() {
  try {
    if (client) {
      console.log('[MongoDB] Cerrando conexión...');
      await client.close();
      db = null;
      client = null;
      isConnecting = false;
      console.log('[MongoDB] Conexión cerrada exitosamente');
    }
  } catch (error) {
    console.error('[MongoDB] Error al cerrar la conexión:', error);
    throw error;
  }
}

// Función para obtener la instancia de la base de datos (solo para uso interno)
function getDb() {
  if (!db) {
    throw new Error('No se ha establecido conexión con la base de datos. Llama a connectToMongoDB() primero.');
  }
  return db;
}

// Función para verificar el estado de la conexión
async function checkConnection() {
  try {
    if (!db) {
      return { ok: false, message: 'No hay conexión activa' };
    }
    await db.command({ ping: 1 });
    return { 
      ok: true, 
      message: 'Conexión activa', 
      dbName: db.databaseName,
      serverStatus: await db.admin().serverStatus()
    };
  } catch (error) {
    return { 
      ok: false, 
      message: 'Error en la conexión', 
      error: error.message 
    };
  }
}

module.exports = {
  connectToMongoDB,
  closeConnection,
  getDb,
  checkConnection,
  // Exportar el cliente para casos de uso avanzados
  getClient: () => client
};
