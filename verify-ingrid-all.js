const { MongoClient } = require('mongodb');

// Hardcodeando la URI
const uri = "mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

async function main() {
  try {
    await client.connect();
    const db = client.db('crmagente');
    
    console.log('\n📊 Verificando registros de INGRID en ambas colecciones:\n');
    
    const agentPatterns = [
      { agente: 'INGRID.GARCIA' },
      { agenteNombre: 'INGRID.GARCIA' },
      { nombreAgente: 'INGRID.GARCIA' },
      { createdBy: 'INGRID.GARCIA' },
      { registeredBy: 'INGRID.GARCIA' },
      { vendedor: 'INGRID.GARCIA' }
    ];
    
    // Buscar en costumers
    console.log('🔍 Colección: costumers');
    const costumersCount = await db.collection('costumers').countDocuments({
      $or: agentPatterns
    });
    console.log(`   Registros encontrados: ${costumersCount}`);
    
    if (costumersCount > 0) {
      const result = await db.collection('costumers').aggregate([
        { $match: { $or: agentPatterns } },
        { $group: {
          _id: null,
          count: { $sum: 1 },
          totalPuntaje: { $sum: { $toDouble: '$puntaje' } }
        }}
      ]).toArray();
      if (result.length > 0) {
        console.log(`   Total puntaje: ${result[0].totalPuntaje}`);
      }
    }
    
    // Buscar en costumers_692e09
    console.log('\n🔍 Colección: costumers_692e09');
    const col692 = db.collection('costumers_692e09');
    const count692 = await col692.countDocuments({ $or: agentPatterns });
    console.log(`   Registros encontrados: ${count692}`);
    
    if (count692 > 0) {
      const result = await col692.aggregate([
        { $match: { $or: agentPatterns } },
        { $group: {
          _id: null,
          count: { $sum: 1 },
          totalPuntaje: { $sum: { $toDouble: '$puntaje' } }
        }}
      ]).toArray();
      if (result.length > 0) {
        console.log(`   Total puntaje: ${result[0].totalPuntaje}`);
      }
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.close();
  }
}

main();
