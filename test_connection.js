const { MongoClient } = require('mongodb');
const dns = require('dns');
require('dotenv').config();

// Forzar el uso de los DNS de Google
dns.setServers(['8.8.8.8', '8.8.4.4']);
console.log('DNS forzado a los servidores de Google.');

// Usaremos la URI original +srv para esta prueba
const uri = 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';

console.log('Intentando conectar con DNS forzado a:', uri);

const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect({ serverSelectionTimeoutMS: 15000 });
    console.log('¡CONEXIÓN EXITOSA! La base de datos respondió.');
    const db = client.db('crmagente');
    const collections = await db.listCollections().toArray();
    console.log('Colecciones encontradas:', collections.map(c => c.name));
  } catch (err) {
    console.error('FALLÓ LA CONEXIÓN:', err);
  } finally {
    await client.close();
    console.log('Conexión cerrada.');
  }
}

run();
