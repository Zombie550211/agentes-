const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Cargar configuración
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Error: MONGODB_URI no está definida en las variables de entorno');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('dashboard');
  
  // Buscar usuario Manuel Flores
  const user = await db.collection('users').findOne({ 
    $or: [
      { username: /manuel.*flores/i }, 
      { name: /manuel.*flores/i },
      { username: /manuel/i },
      { name: /manuel/i }
    ] 
  });
  
  if (user) {
    console.log('Usuario encontrado:');
    console.log('ID:', user._id);
    console.log('Username:', user.username);
    console.log('Name:', user.name);
    console.log('Email:', user.email);
    console.log('Role:', user.role);
    
    // Hashear nueva contraseña
    const hash = await bcrypt.hash('ManuFlo26@', 10);
    
    // Actualizar contraseña
    await db.collection('users').updateOne(
      { _id: user._id }, 
      { $set: { password: hash } }
    );
    
    console.log('\n✅ Contraseña actualizada exitosamente a: ManuFlo26@');
  } else {
    console.log('Usuario Manuel Flores no encontrado');
    
    // Listar todos los usuarios para buscar
    const users = await db.collection('users').find({}).toArray();
    console.log('\nUsuarios disponibles:');
    users.forEach(u => {
      console.log(`- ${u.username || u.name} (${u.email || 'sin email'})`);
    });
  }
  
  await client.close();
})();
