/**
 * Script para popular datos de prueba en la BD
 */
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/crmagente_local';
const DB_NAME = process.env.MONGODB_DBNAME || 'crmagente';

async function populateTestData() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db(DB_NAME);
    
    // 1. Verificar usuarios
    const usersCount = await db.collection('users').countDocuments();
    console.log(`📊 Usuarios en BD: ${usersCount}`);
    
    // 2. Verificar leads
    const leadsCount = await db.collection('costumers').countDocuments();
    console.log(`📊 Leads en BD: ${leadsCount}`);
    
    // 3. Verificar leads con agent
    const leadsWithAgent = await db.collection('costumers').countDocuments({ 
      agenteNombre: { $exists: true, $ne: null } 
    });
    console.log(`📊 Leads con agente asignado: ${leadsWithAgent}`);
    
    // 4. Si no hay leads, crear algunos
    if (leadsCount === 0) {
      console.log('\n⚠️ No hay leads. Creando datos de prueba...\n');
      
      const testLeads = [
        {
          nombre: 'María López',
          teléfono: '1234567890',
          email: 'maria@example.com',
          agenteNombre: 'admin',
          servicios: ['Internet 100MB'],
          sistema: 'SARA',
          tipo_servicio: 'Internet Hogar',
          puntaje: 1,
          status: 'vendido',
          fecha_creacion: new Date(),
          fecha_venta: new Date()
        },
        {
          nombre: 'Carlos Pérez',
          teléfono: '9876543210',
          email: 'carlos@example.com',
          agenteNombre: 'admin',
          servicios: ['TV Premium'],
          sistema: 'N/A',
          tipo_servicio: 'TV',
          puntaje: 0.75,
          status: 'vendido',
          fecha_creacion: new Date(),
          fecha_venta: new Date()
        },
        {
          nombre: 'Ana Torres',
          teléfono: '5551234567',
          email: 'ana@example.com',
          agenteNombre: 'admin',
          servicios: ['Combo 200MB'],
          sistema: 'SARA',
          tipo_servicio: 'Combo',
          puntaje: 1.5,
          status: 'vendido',
          fecha_creacion: new Date(),
          fecha_venta: new Date()
        },
        {
          nombre: 'Pedro Ruiz',
          teléfono: '5559876543',
          email: 'pedro@example.com',
          agenteNombre: 'admin',
          servicios: ['Internet 50MB'],
          sistema: 'SARA',
          tipo_servicios: 'Internet Hogar',
          puntaje: 0.5,
          status: 'cancelado',
          fecha_creacion: new Date()
        },
        {
          nombre: 'Laura Mendez',
          teléfono: '5555555555',
          email: 'laura@example.com',
          agenteNombre: 'admin',
          servicios: ['TV Básico'],
          sistema: 'N/A',
          tipo_servicio: 'TV',
          puntaje: 0.25,
          status: 'pendiente',
          fecha_creacion: new Date()
        }
      ];
      
      const result = await db.collection('costumers').insertMany(testLeads);
      console.log(`✅ Creados ${result.insertedCount} leads de prueba`);
      console.log(`✅ Todos asignados al usuario: admin\n`);
    } else if (leadsWithAgent === 0) {
      console.log('\n⚠️ Hay leads pero sin agentes. Asignando a admin...\n');
      const result = await db.collection('costumers').updateMany(
        { agenteNombre: { $exists: false } },
        { $set: { agenteNombre: 'admin' } }
      );
      console.log(`✅ Asignados ${result.modifiedCount} leads a admin\n`);
    }
    
    // 5. Mostrar resumen final
    console.log('═══════════════════════════════════════');
    console.log('📈 Resumen Final:');
    const finalLeads = await db.collection('costumers').countDocuments();
    const finalWithAgent = await db.collection('costumers').countDocuments({
      agenteNombre: { $exists: true, $ne: null }
    });
    console.log(`  Total de leads: ${finalLeads}`);
    console.log(`  Leads con agente: ${finalWithAgent}`);
    
    // 6. Mostrar algunos leads
    const sampleLeads = await db.collection('costumers').find({}).limit(5).toArray();
    console.log('\n📋 Muestra de leads:');
    sampleLeads.forEach((lead, i) => {
      console.log(`  ${i+1}. ${lead.nombre} (Agente: ${lead.agenteNombre}, Puntos: ${lead.puntaje})`);
    });
    
    console.log('═══════════════════════════════════════\n');
    console.log('✅ Los datos están listos.');
    console.log('🌐 Recarga la página en: http://localhost:3000/inicio.html');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    process.exit(0);
  }
}

populateTestData();
