const mongoose = require('mongoose');

// Configurar conexión a MongoDB
const MONGODB_URI = 'mongodb://127.0.0.1:27017/crmagente';

// Definir el esquema básico
const costumerSchema = new mongoose.Schema({}, { strict: false, collection: 'Costumers' });
const Costumer = mongoose.model('Costumer', costumerSchema);

async function verVentasHoy() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Conectado a MongoDB');

    // Obtener fechas para el filtro
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    console.log(`\n📊 VENTAS DEL DÍA (${hoy.toLocaleDateString()})`);
    console.log('='.repeat(50));

    // Contar total de ventas de hoy
    const totalVentasHoy = await Costumer.countDocuments({
      $or: [
        { fecha_creacion: { $gte: hoy, $lt: manana } },
        { creadoEn: { $gte: hoy, $lt: manana } },
        { fecha_contratacion: { $regex: hoy.toISOString().split('T')[0] } },
        { dia_venta: { $regex: hoy.toISOString().split('T')[0] } }
      ]
    });

    console.log(`\n🔢 TOTAL DE VENTAS HOY: ${totalVentasHoy}`);

    // Mostrar detalles de las ventas de hoy
    if (totalVentasHoy > 0) {
      console.log('\n📋 DETALLES DE VENTAS HOY:');
      console.log('='.repeat(50));
      
      const ventasHoy = await Costumer.find({
        $or: [
          { fecha_creacion: { $gte: hoy, $lt: manana } },
          { creadoEn: { $gte: hoy, $lt: manana } },
          { fecha_contratacion: { $regex: hoy.toISOString().split('T')[0] } },
          { dia_venta: { $regex: hoy.toISOString().split('T')[0] } }
        ]
      }).limit(10); // Mostrar máximo 10 registros

      ventasHoy.forEach((venta, index) => {
        console.log(`\n📌 VENTA #${index + 1}`);
        console.log('-' .repeat(30));
        console.log(`ID: ${venta._id}`);
        console.log(`Cliente: ${venta.nombre_cliente || 'No especificado'}`);
        console.log(`Teléfono: ${venta.telefono || venta.telefono_principal || 'No especificado'}`);
        console.log(`Producto: ${venta.producto_contratado || venta.tipo_servicio || 'No especificado'}`);
        console.log(`Estado: ${venta.status || 'No especificado'}`);
        console.log(`Fecha Creación: ${venta.fecha_creacion || 'No especificada'}`);
        console.log(`Creado En: ${venta.creadoEn || 'No especificado'}`);
        console.log(`Día Venta: ${venta.dia_venta || 'No especificado'}`);
        console.log(`Fecha Contratación: ${venta.fecha_contratacion || 'No especificada'}`);
      });

      if (totalVentasHoy > 10) {
        console.log(`\n... y ${totalVentasHoy - 10} ventas más`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

verVentasHoy();
