require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

async function listUsers() {
  if (!MONGODB_URI) {
    console.error('[ERROR] La variable de entorno MONGODB_URI no está definida.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    const usersCollection = db.collection('users');

    console.log('[INFO] Obteniendo la lista de usuarios...');
    const users = await usersCollection.find({}, { projection: { password: 0 } }).toArray(); // Proyectamos para no mostrar contraseñas

    if (users.length === 0) {
      console.log('[INFO] No se encontraron usuarios en la base de datos.');
    } else {
      console.log('[INFO] Usuarios encontrados:');
      console.table(users);
    }

  } catch (error) {
    console.error('[FATAL] Ocurrió un error:', error);
  } finally {
    await client.close();
  }
}

listUsers();
