const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// URI directa del .env leído anteriormente como fallback seguro
const URI_FALLBACK = 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';
const URI = process.env.MONGODB_URI || URI_FALLBACK;
const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';

async function run() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
  
  try {
    console.log('🚀 Iniciando script de limpieza de usuarios...');
    console.log('🔌 Conectando a MongoDB Atlas...');
    
    await client.connect();
    console.log('✅ Conectado exitosamente.');
    
    const db = client.db(DB_NAME);
    const usersCol = db.collection('users');

    // Regex flexible para "Emanuel Velásquez" y todas sus variantes
    const regex = /Emanuel.*Vel.squez/i;

    console.log('🔍 Buscando usuarios que coincidan con:', regex);

    const candidates = await usersCol.find({
      $or: [
        { username: { $regex: regex } },
        { name: { $regex: regex } }
      ]
    }).toArray();

    if (candidates.length === 0) {
      console.log('⚠️ No se encontraron usuarios coincidentes para eliminar.');
    } else {
      console.log(`✅ Se encontraron ${candidates.length} usuarios para eliminar:`);
      candidates.forEach(u => {
        console.log(` - ID: ${u._id} | Username: "${u.username}" | Name: "${u.name}"`);
      });

      const deleteResult = await usersCol.deleteMany({
        _id: { $in: candidates.map(c => c._id) }
      });

      console.log(`\n🗑️ Eliminados ${deleteResult.deletedCount} usuarios correctamente.`);
    }

  } catch (e) {
    console.error('❌ Error FATAL:', e);
  } finally {
    console.log('👋 Cerrando conexión...');
    await client.close();
  }
}

run();
