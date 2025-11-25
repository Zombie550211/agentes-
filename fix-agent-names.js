/**
 * Script para normalizar nombres de agentes duplicados
 * Ejemplo: "Alejandramelara" -> "Alejandra Melara"
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'crmagente';

// Mapeo de nombres incorrectos -> nombre correcto
const NAME_FIXES = {
  'Alejandramelara': 'Alejandra Melara',
  'alejandramelara': 'Alejandra Melara',
  'ALEJANDRAMELARA': 'Alejandra Melara',
  'Melissaescobar': 'Melissa Escobar',
  'melissaescobar': 'Melissa Escobar',
  'MELISSAESCOBAR': 'Melissa Escobar',
  'Michelleleiva': 'Michelle Leiva',
  'michelleleiva': 'Michelle Leiva',
  'MICHELLELEIVA': 'Michelle Leiva',
  'Eduardor': 'Eduardo R',
  'eduardor': 'Eduardo R',
  'EDUARDOR': 'Eduardo R',
  'abigail.bernal': 'Abigail Bernal',
  'Abigail.Bernal': 'Abigail Bernal',
  'ABIGAIL.BERNAL': 'Abigail Bernal',
  'jorge.segovia': 'Jorge Segovia',
  'Jorge.Segovia': 'Jorge Segovia',
  'JORGE.SEGOVIA': 'Jorge Segovia',
  'nicole.cruz': 'Nicole Cruz',
  'Nicole.Cruz': 'Nicole Cruz',
  'NICOLE.CRUZ': 'Nicole Cruz',
};

// Campos donde buscar y actualizar nombres de agente
const AGENT_FIELDS = [
  'agente',
  'agenteNombre', 
  'createdBy',
  'usuario',
  'vendedor',
  'asignadoA',
  'assignedTo'
];

async function fixAgentNames() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Conectado a MongoDB');
    
    const db = client.db(DB_NAME);
    const collection = db.collection('costumers');
    
    let totalUpdated = 0;
    
    for (const [wrongName, correctName] of Object.entries(NAME_FIXES)) {
      console.log(`\n🔧 Corrigiendo: "${wrongName}" -> "${correctName}"`);
      
      for (const field of AGENT_FIELDS) {
        // Buscar documentos con el nombre incorrecto
        const query = { [field]: wrongName };
        const count = await collection.countDocuments(query);
        
        if (count > 0) {
          console.log(`  📝 Campo "${field}": ${count} registros encontrados`);
          
          // Actualizar
          const result = await collection.updateMany(
            query,
            { $set: { [field]: correctName } }
          );
          
          console.log(`  ✅ Actualizados: ${result.modifiedCount}`);
          totalUpdated += result.modifiedCount;
        }
      }
      
      // También buscar con regex case-insensitive para variantes
      const regexQuery = new RegExp(`^${wrongName}$`, 'i');
      for (const field of AGENT_FIELDS) {
        const query = { [field]: regexQuery };
        const docs = await collection.find(query).toArray();
        
        for (const doc of docs) {
          if (doc[field] !== correctName) {
            await collection.updateOne(
              { _id: doc._id },
              { $set: { [field]: correctName } }
            );
            totalUpdated++;
            console.log(`  ✅ Corregido (regex): ${doc[field]} -> ${correctName}`);
          }
        }
      }
    }
    
    console.log(`\n========================================`);
    console.log(`✅ TOTAL DE REGISTROS ACTUALIZADOS: ${totalUpdated}`);
    console.log(`========================================\n`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('Conexión cerrada');
  }
}

// También actualizar en la colección users
async function fixUserNames() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const usersCollection = db.collection('users');
    
    console.log('\n🔧 Actualizando colección users...\n');
    
    for (const [wrongName, correctName] of Object.entries(NAME_FIXES)) {
      // Buscar en username, name, nombre
      for (const field of ['username', 'name', 'nombre', 'fullName']) {
        const regexQuery = new RegExp(`^${wrongName}$`, 'i');
        const result = await usersCollection.updateMany(
          { [field]: regexQuery },
          { $set: { [field]: correctName } }
        );
        
        if (result.modifiedCount > 0) {
          console.log(`✅ Users.${field}: "${wrongName}" -> "${correctName}" (${result.modifiedCount})`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error en users:', error);
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('🚀 Iniciando corrección de nombres de agentes...\n');
  await fixAgentNames();
  await fixUserNames();
  console.log('\n✅ Proceso completado');
}

main();
