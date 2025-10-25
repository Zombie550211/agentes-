// TEST RÁPIDO - Ver ventas del 24/10/2025
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function testVentas24() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';
  
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('crmagente');
  const collection = db.collection('costumers');
  
  console.log('🔍 BUSCANDO VENTAS DEL 24/10/2025...\n');
  
  // Crear el mismo filtro que usa el backend
  const startDate = new Date("2025-10-24T00:00:00.000Z");
  const endDate = new Date("2025-10-24T23:59:59.999Z");
  
  // Formatos string
  const daysInRange = ["2025-10-24", "24/10/2025"];
  
  // Regex para Date objects como string
  const regex24 = /^Fri Oct 24 2025/i;
  
  const ventas = await collection.find({
    $or: [
      // Date objects
      { createdAt: { $gte: startDate, $lte: endDate } },
      { creadoEn: { $gte: startDate, $lte: endDate } },
      // Strings
      { dia_venta: { $in: daysInRange } },
      { fecha_contratacion: { $in: daysInRange } },
      // Date objects convertidos a string
      { dia_venta: { $regex: regex24 } },
      { fecha_contratacion: { $regex: regex24 } }
    ]
  }).toArray();
  
  console.log(`✅ TOTAL VENTAS ENCONTRADAS: ${ventas.length}\n`);
  
  if (ventas.length > 0) {
    console.log('📋 DETALLE DE VENTAS:\n');
    ventas.forEach((v, i) => {
      console.log(`${i + 1}. ${v.nombre_cliente}`);
      console.log(`   - Agente: ${v.agenteNombre || v.agente}`);
      console.log(`   - Supervisor: ${v.supervisor || v.team}`);
      console.log(`   - Servicio: ${v.servicios || v.servicios_texto}`);
      console.log(`   - Puntaje: ${v.puntaje}`);
      console.log(`   - dia_venta: ${v.dia_venta}`);
      console.log(`   - createdAt: ${v.createdAt}`);
      console.log('');
    });
  } else {
    console.log('❌ No se encontraron ventas del 24/10/2025');
    console.log('\n💡 Verifica que:');
    console.log('   1. Las ventas existen en la base de datos');
    console.log('   2. El campo dia_venta tiene el formato correcto');
    console.log('   3. El servidor esté usando el código actualizado');
  }
  
  await client.close();
}

testVentas24().catch(console.error);
