// Script para eliminar el índice único de telefono_principal en la colección costumers
const { MongoClient } = require('mongodb');

async function removeUniqueIndex() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Conectado a MongoDB');
    
    const db = client.db('crmagente');
    const collection = db.collection('costumers');
    
    // Listar todos los índices
    const indexes = await collection.indexes();
    console.log('Índices actuales:', JSON.stringify(indexes, null, 2));
    
    // Buscar el índice único en telefono_principal
    const telefonoIndex = indexes.find(index => 
      index.key && index.key.telefono_principal === 1 && index.unique === true
    );
    
    if (telefonoIndex) {
      console.log('\nEliminando índice único de telefono_principal...');
      await collection.dropIndex('telefono_principal_1');
      console.log('Índice único eliminado exitosamente');
    } else {
      console.log('No se encontró un índice único en telefono_principal');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('Conexión cerrada');
  }
}

removeUniqueIndex();
