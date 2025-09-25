require('dotenv').config();
const mongoose = require('mongoose');

// Configurar conexión a MongoDB (usando la misma configuración que la aplicación)
const MONGODB_URI = 'mongodb://127.0.0.1:27017/crmagente';

// Definir el esquema directamente en el script para evitar problemas de importación
const costumerSchema = new mongoose.Schema({
  nombre_cliente: String,
  telefono: String,
  telefono_principal: String,
  direccion: String,
  tipo_servicio: String,
  servicios: String,
  servicios_texto: String,
  sistema: String,
  mercado: String,
  riesgo: String,
  autopago: Boolean,
  dia_venta: String,
  team: { type: String, index: true },
  supervisor: String,
  agente: String,
  dia_instalacion: String,
  puntaje: Number,
  zip: String,
  creadoEn: { type: Date, default: Date.now, index: true },
  actualizadoEn: { type: Date, default: Date.now },
  producto_contratado: String,
  fecha_contratacion: String,
  equipo: { type: String, index: true },
  status: String,
  comentario: String,
  motivo_llamada: String,
  numero_cuenta: String,
  agenteId: mongoose.Schema.Types.ObjectId,
  creadoPor: String,
  agenteNombre: String,
  ownerId: String,
  registeredById: mongoose.Schema.Types.ObjectId,
  fecha_creacion: Date  // Asegurarse de que este campo está definido
}, { collection: 'Costumers' });

// Crear el modelo
const Costumer = mongoose.models.Costumer || mongoose.model('Costumer', costumerSchema);

// Función para conectar a MongoDB
async function conectarDB() {
  console.log('🔍 Intentando conectar a MongoDB...');
  console.log('URI de conexión:', MONGODB_URI);
  
  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000, // 10 segundos de timeout
      serverSelectionTimeoutMS: 5000, // 5 segundos para seleccionar servidor
    });
    
    console.log('✅ Conectado a MongoDB en:', conn.connection.host);
    console.log('Base de datos:', conn.connection.name);
    
    // Verificar si la colección existe
    const collections = await conn.connection.db.listCollections({ name: 'Costumers' }).toArray();
    if (collections.length === 0) {
      console.error('❌ Error: La colección "Costumers" no existe en la base de datos');
      process.exit(1);
    }
    
    return conn;
  } catch (error) {
    console.error('❌ Error al conectar a MongoDB:');
    console.error('- Mensaje:', error.message);
    console.error('- Código:', error.code);
    console.error('- Stack:', error.stack);
    
    // Verificar errores comunes
    if (error.name === 'MongooseServerSelectionError') {
      console.error('\n🔧 Posibles soluciones:');
      console.error('1. Verifica que MongoDB esté en ejecución');
      console.error('2. Verifica la cadena de conexión en .env');
      console.error('3. Verifica que el puerto sea el correcto (por defecto 27017)');
      console.error('4. Si usas MongoDB Atlas, verifica la IP en la lista blanca');
    }
    
    process.exit(1);
  }
}

// Función para obtener la fecha más temprana de los campos de fecha
function obtenerFechaMasTemprana(doc) {
  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  
  // Lista de campos de fecha a verificar
  const camposFecha = [
    'creadoEn',
    'fecha_contratacion',
    'dia_venta',
    'fecha_instalacion',
    'fecha_venta',
    'actualizadoEn'
  ];

  let fechaMasTemprana = null;

  camposFecha.forEach(campo => {
    if (doc[campo]) {
      try {
        let fecha = new Date(doc[campo]);
        
        // Si la fecha es válida y es anterior a hoy
        if (!isNaN(fecha.getTime()) && fecha < inicioHoy) {
          if (!fechaMasTemprana || fecha < fechaMasTemprana) {
            fechaMasTemprana = fecha;
          }
        }
      } catch (e) {
        console.warn(`Error al procesar campo ${campo}:`, e.message);
      }
    }
  });

  return fechaMasTemprana;
}

// Función principal
async function corregirFechas() {
  try {
    await conectarDB();
    
    // Obtener la fecha de hoy
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const finHoy = new Date(inicioHoy);
    finHoy.setDate(finHoy.getDate() + 1);
    
    console.log(`Buscando registros con fecha_creacion entre ${inicioHoy.toISOString()} y ${finHoy.toISOString()}`);
    
    // Encontrar registros con fecha_creacion de hoy
    const registros = await Costumer.find({
      fecha_creacion: {
        $gte: inicioHoy,
        $lt: finHoy
      }
    });n
    console.log(`Encontrados ${registros.length} registros con fecha_creacion de hoy`);
    
    let actualizados = 0;
    let sinCambios = 0;
    
    // Procesar cada registro
    for (const doc of registros) {
      try {
        const fechaCorrecta = obtenerFechaMasTemprana(doc);
        
        if (fechaCorrecta) {
          // Actualizar solo si encontramos una fecha anterior
          await Costumer.updateOne(
            { _id: doc._id },
            { $set: { fecha_creacion: fechaCorrecta } }
          );
          console.log(`✅ Actualizado ${doc._id}: ${doc.fecha_creacion} -> ${fechaCorrecta}`);
          actualizados++;
        } else {
          console.log(`⚠️  Sin cambios para ${doc._id}: No se pudo determinar una fecha anterior`);
          sinCambios++;
        }
      } catch (error) {
        console.error(`❌ Error al procesar ${doc._id}:`, error.message);
      }
    }
    
    console.log(`\nResumen:`);
    console.log(`- Total de registros procesados: ${registros.length}`);
    console.log(`- Registros actualizados: ${actualizados}`);
    console.log(`- Registros sin cambios: ${sinCambios}`);
    
  } catch (error) {
    console.error('Error en la ejecución:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Desconectado de MongoDB');
    process.exit(0);
  }
}

// Ejecutar el script
corregirFechas();
