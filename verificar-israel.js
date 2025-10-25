// Verificar fecha exacta de ISRAEL ANTONIO HERNANDEZ ROMAN
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function verificarIsrael() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';
  
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('crmagente');
  
  console.log('🔍 Buscando ISRAEL ANTONIO HERNANDEZ ROMAN...\n');
  
  const cliente = await db.collection('costumers').findOne({
    nombre_cliente: { $regex: /ISRAEL.*HERNANDEZ.*ROMAN/i }
  });
  
  if (cliente) {
    console.log('✅ Cliente encontrado:\n');
    console.log('Nombre:', cliente.nombre_cliente);
    console.log('Teléfono:', cliente.telefono_principal);
    console.log('Agente:', cliente.agenteNombre || cliente.agente);
    console.log('Supervisor:', cliente.supervisor || cliente.team);
    console.log('\n📅 FECHAS:');
    console.log('dia_venta:', cliente.dia_venta, '(tipo:', typeof cliente.dia_venta, ')');
    console.log('createdAt:', cliente.createdAt, '(tipo:', typeof cliente.createdAt, ')');
    console.log('creadoEn:', cliente.creadoEn, '(tipo:', typeof cliente.creadoEn, ')');
    console.log('fecha_contratacion:', cliente.fecha_contratacion);
    console.log('dia_instalacion:', cliente.dia_instalacion);
    console.log('\n🔢 OTROS DATOS:');
    console.log('Servicio:', cliente.servicios || cliente.servicios_texto);
    console.log('Puntaje:', cliente.puntaje);
    console.log('Status:', cliente.status);
    console.log('_id:', cliente._id);
  } else {
    console.log('❌ Cliente no encontrado');
  }
  
  await client.close();
}

verificarIsrael().catch(console.error);
