const { connectToMongoDB, getDb } = require('./config/db');

async function checkStatusValues() {
  try {
    await connectToMongoDB();
    const db = getDb();
    
    // Verificar valores únicos de status en la colección costumers para noviembre 2025
    console.log('\n=== VERIFICANDO VALORES DE STATUS EN NOVIEMBRE 2025 ===\n');
    
    const collection = db.collection('costumers');
    
    // Obtener algunos registros de noviembre para ver su estructura
    const novSamples = await collection.find({
      $or: [
        { dia_venta: { $regex: /^2025-11-/ } },
        { dia_venta: { $regex: /\/11\/2025$/ } }
      ]
    }).limit(10).toArray();
    
    console.log('Muestra de registros de noviembre:');
    novSamples.forEach((doc, idx) => {
      console.log(`\n[${idx + 1}] Supervisor: ${doc.supervisor || doc.team}`);
      console.log(`    Status: "${doc.status}"`);
      console.log(`    Estado: "${doc.estado}"`);
      console.log(`    Dia Venta: ${doc.dia_venta}`);
      console.log(`    Mercado: ${doc.mercado}`);
    });
    
    // Contar registros por valor de status
    console.log('\n=== CONTEO POR STATUS (NOVIEMBRE 2025) ===\n');
    const statusCounts = await collection.aggregate([
      {
        $match: {
          $or: [
            { dia_venta: { $regex: /^2025-11-/ } },
            { dia_venta: { $regex: /\/11\/2025$/ } }
          ]
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('Conteo de registros por STATUS:');
    statusCounts.forEach(item => {
      console.log(`  "${item._id}": ${item.count} registros`);
    });
    
    // Verificar si hay campo "estado"
    console.log('\n=== CONTEO POR ESTADO (NOVIEMBRE 2025) ===\n');
    const estadoCounts = await collection.aggregate([
      {
        $match: {
          $or: [
            { dia_venta: { $regex: /^2025-11-/ } },
            { dia_venta: { $regex: /\/11\/2025$/ } }
          ]
        }
      },
      {
        $group: {
          _id: '$estado',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('Conteo de registros por ESTADO:');
    estadoCounts.forEach(item => {
      console.log(`  "${item._id}": ${item.count} registros`);
    });
    
    // Buscar el registro específico de Roberto que mencionaste
    console.log('\n=== BUSCANDO REGISTRO DE ROBERTO CON STATUS COMPLETED ===\n');
    const robertoCompleted = await collection.find({
      $or: [
        { supervisor: /roberto/i },
        { team: /roberto/i }
      ],
      $or: [
        { dia_venta: { $regex: /^2025-11-/ } },
        { dia_venta: { $regex: /\/11\/2025$/ } }
      ]
    }).toArray();
    
    console.log(`Total registros de Roberto en noviembre: ${robertoCompleted.length}`);
    if (robertoCompleted.length > 0) {
      console.log('\nRegistros de Roberto:');
      robertoCompleted.forEach((doc, idx) => {
        console.log(`\n[${idx + 1}]`);
        console.log(`  Status: "${doc.status}"`);
        console.log(`  Estado: "${doc.estado}"`);
        console.log(`  Dia Venta: ${doc.dia_venta}`);
        console.log(`  Cliente: ${doc.nombre || doc.name || 'N/A'}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkStatusValues();
