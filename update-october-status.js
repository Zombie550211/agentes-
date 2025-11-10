const { MongoClient } = require('mongodb');
require('dotenv').config();

async function updateOctoberStatus() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB Atlas');
    
    const db = client.db('crmagente');
    const collection = db.collection('costumers');
    
    console.log('\n=== ACTUALIZANDO STATUS DE OCTUBRE 2025 ===\n');
    
    // Buscar todos los registros de octubre 2025
    const octoberFilter = {
      $or: [
        { dia_venta: { $regex: /^2025-10-/ } },
        { dia_venta: { $regex: /\/10\/2025$/ } },
        { dia_venta: { $regex: /^2025-10-\d{2}$/ } }
      ]
    };
    
    // Contar registros antes de actualizar
    const countBefore = await collection.countDocuments(octoberFilter);
    console.log(`📊 Total de registros encontrados en octubre 2025: ${countBefore}`);
    
    if (countBefore === 0) {
      console.log('⚠️  No se encontraron registros para actualizar');
      await client.close();
      return;
    }
    
    // Mostrar algunos ejemplos antes de actualizar
    console.log('\n📋 Ejemplos de registros a actualizar:');
    const examples = await collection.find(octoberFilter).limit(5).toArray();
    examples.forEach((doc, i) => {
      console.log(`  [${i + 1}] Cliente: ${doc.nombre_cliente || 'N/A'}`);
      console.log(`      Status actual: "${doc.status || '(vacío)'}"`);
      console.log(`      Fecha venta: ${doc.dia_venta}`);
      console.log(`      Equipo: ${doc.team || doc.supervisor}`);
      console.log('');
    });
    
    // Confirmar antes de proceder
    console.log('⚠️  ATENCIÓN: Se actualizarán todos estos registros a status "Pending"');
    console.log('   Presiona Ctrl+C para cancelar o espera 5 segundos para continuar...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Actualizar todos los registros de octubre
    const updateResult = await collection.updateMany(
      octoberFilter,
      { 
        $set: { 
          status: 'Pending',
          updated_at: new Date(),
          updated_by: 'update-october-status-script'
        } 
      }
    );
    
    console.log('\n✅ ACTUALIZACIÓN COMPLETADA');
    console.log(`   Registros coincidentes: ${updateResult.matchedCount}`);
    console.log(`   Registros modificados: ${updateResult.modifiedCount}`);
    
    // Verificar la actualización
    console.log('\n📋 Verificando actualización...');
    const verifyPending = await collection.countDocuments({
      ...octoberFilter,
      status: 'Pending'
    });
    console.log(`   ✅ Registros con status "Pending": ${verifyPending}`);
    
    // Mostrar distribución de status después de actualizar
    console.log('\n📊 Distribución de status en octubre 2025:');
    const statusDistribution = await collection.aggregate([
      { $match: octoberFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    statusDistribution.forEach(s => {
      console.log(`   "${s._id}": ${s.count} registros`);
    });
    
    console.log('\n✅ Script completado exitosamente');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔌 Conexión cerrada');
  }
}

// Ejecutar el script
updateOctoberStatus()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
