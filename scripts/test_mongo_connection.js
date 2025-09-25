const mongoose = require('mongoose');

// Configuración de conexión
const MONGODB_URI = 'mongodb://127.0.0.1:27017/crmagente';

console.log('🔍 Intentando conectar a MongoDB...');
console.log('URI de conexión:', MONGODB_URI);

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 3000 // 3 segundos de timeout
})
.then(() => {
  console.log('✅ Conexión exitosa a MongoDB!');
  console.log('Base de datos:', mongoose.connection.name);
  
  // Verificar colecciones
  mongoose.connection.db.listCollections().toArray((err, collections) => {
    if (err) {
      console.error('Error al listar colecciones:', err);
      process.exit(1);
    }
    
    console.log('\n📚 Colecciones encontradas:');
    collections.forEach(collection => {
      console.log(`- ${collection.name}`);
    });
    
    process.exit(0);
  });
})
.catch(error => {
  console.error('❌ Error de conexión a MongoDB:');
  console.error('- Mensaje:', error.message);
  console.error('- Código:', error.code);
  
  if (error.name === 'MongooseServerSelectionError') {
    console.log('\n🔍 Posibles soluciones:');
    console.log('1. Asegúrate que MongoDB esté instalado y en ejecución');
    console.log('2. Verifica que el puerto 27017 esté accesible');
    console.log('3. Si usas MongoDB como servicio, verifica que esté iniciado');
  }
  
  process.exit(1);
});
