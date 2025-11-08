const { MongoClient } = require('mongodb');
require('dotenv').config();

async function findCompletedRecord() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('crmagente');
    
    console.log('\n=== BUSCANDO REGISTRO CON STATUS "completed" O VARIANTES ===\n');
    
    // Buscar todos los registros de noviembre con diferentes variantes de "completed"
    const novRecords = await db.collection('costumers').find({
      $or: [
        { dia_venta: { $regex: /^2025-11-/ } },
        { dia_venta: { $regex: /\/11\/2025$/ } },
        { dia_venta: { $regex: /^01\/11\/2025/ } }
      ]
    }).toArray();
    
    console.log(`Total registros en noviembre: ${novRecords.length}`);
    
    // Buscar los que tengan status con "complet" en el texto
    const completedRecords = novRecords.filter(r => {
      const status = (r.status || '').toLowerCase();
      return status.includes('complet');
    });
    
    console.log(`\nRegistros con "complet" en status: ${completedRecords.length}\n`);
    
    completedRecords.forEach((rec, idx) => {
      console.log(`[${idx + 1}]`);
      console.log('  _id:', rec._id);
      console.log('  nombre_cliente:', rec.nombre_cliente || 'N/A');
      console.log('  status:', `"${rec.status}"`);
      console.log('  dia_venta:', rec.dia_venta);
      console.log('  team:', rec.team);
      console.log('  supervisor:', rec.supervisor);
      console.log('  agente:', rec.agente);
      console.log('  mercado:', rec.mercado);
      console.log();
    });
    
    // También buscar el registro específico por nombre
    const specificRecord = await db.collection('costumers').findOne({
      nombre_cliente: /ADOLFO.*CRUCES.*BARRAS/i
    });
    
    if (specificRecord) {
      console.log('\n=== REGISTRO DE ADOLFO CRUCES BARRAS ===');
      console.log('  _id:', specificRecord._id);
      console.log('  nombre_cliente:', specificRecord.nombre_cliente);
      console.log('  status:', `"${specificRecord.status}"`);
      console.log('  dia_venta:', specificRecord.dia_venta);
      console.log('  team:', specificRecord.team);
      console.log('  supervisor:', specificRecord.supervisor);
      console.log('  mercado:', specificRecord.mercado);
    }
    
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

findCompletedRecord();
