/**
 * Script para crear usuario de prueba y popular datos
 * Usa directamente la BD sin necesidad de servidor
 */
require('dotenv').config();
const { getDb } = require('./backend/config/db');
const bcrypt = require('bcrypt');

async function setupTestData() {
  try {
    console.log('🔄 Inicializando conexión...');
    
    // Esperar a que getDb() se resuelva
    let db = getDb();
    let attempts = 0;
    while (!db && attempts < 10) {
      console.log('  Esperando conexión...');
      await new Promise(r => setTimeout(r, 1000));
      db = getDb();
      attempts++;
    }
    
    if (!db) {
      // Forzar conexión usando el archivo db.js
      const connectToMongoDB = require('./backend/config/db').connectToMongoDB;
      await connectToMongoDB();
      console.log('✅ Conexión establecida via connectToMongoDB');
      db = getDb();
    }
    
    console.log('✅ Conectado a base de datos\n');
    
    // 1. Crear usuario si no existe
    console.log('👤 Verificando usuario de prueba...');
    const users = db.collection('users');
    const existingUser = await users.findOne({ username: 'test.agent' });
    
    if (!existingUser) {
      const hashedPassword = await bcrypt.hash('123456', 10);
      const newUser = {
        username: 'test.agent',
        password: hashedPassword,
        name: 'Agente Prueba',
        email: 'test@example.com',
        role: 'agente',
        team: 'Test Team',
        supervisor: 'admin',
        createdAt: new Date(),
        verified: true
      };
      await users.insertOne(newUser);
      console.log('  ✅ Usuario creado: test.agent / 123456\n');
    } else {
      console.log('  ℹ️  Usuario ya existe: test.agent\n');
    }
    
    // 2. Verificar leads
    console.log('📊 Verificando leads...');
    const costumers = db.collection('costumers');
    const leadCount = await costumers.countDocuments();
    const agentLeads = await costumers.countDocuments({ agenteNombre: 'test.agent' });
    
    console.log(`  Tu hay ${leadCount} leads en total`);
    console.log(`  De los cuales ${agentLeads} están asignados a test.agent\n`);
    
    // 3. Si no hay leads, crear algunos
    if (leadCount === 0) {
      console.log('⚠️  No hay leads. Creando datos de prueba...\n');
      const testLeads = [
        {
          nombre: 'María López',
          teléfono: '1234567890',
          email: 'maria@example.com',
          agenteNombre: 'test.agent',
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
          agenteNombre: 'test.agent',
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
          agenteNombre: 'test.agent',
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
          agenteNombre: 'test.agent',
          servicios: ['Internet 50MB'],
          sistema: 'SARA',
          tipo_servicio: 'Internet Hogar',
          puntaje: 0.5,
          status: 'cancelado',
          fecha_creacion: new Date()
        },
        {
          nombre: 'Laura Mendez',
          teléfono: '5555555555',
          email: 'laura@example.com',
          agenteNombre: 'test.agent',
          servicios: ['TV Básico'],
          sistema: 'N/A',
          tipo_servicio: 'TV',
          puntaje: 0.25,
          status: 'pendiente',
          fecha_creacion: new Date()
        }
      ];
      
      const result = await costumers.insertMany(testLeads);
      console.log(`  ✅ Creados ${result.insertedCount} leads de prueba`);
      console.log(`  ✅ Todos asignados a: test.agent\n`);
    } else if (agentLeads === 0) {
      console.log('  ⚠️  Asignando leads existentes a test.agent...\n');
      const result = await costumers.updateMany(
        { agenteNombre: { $exists: false } },
        { $set: { agenteNombre: 'test.agent' } }
      );
      console.log(`  ✅ Asignados ${result.modifiedCount} leads\n`);
    }
    
    // 4. Mostrar resumen
    console.log('═══════════════════════════════════════');
    console.log('✅ DATOS CREADOS CORRECTAMENTE');
    console.log('═══════════════════════════════════════');
    console.log('\n📝 CREDENCIALES DE PRUEBA:');
    console.log('   Usuario: test.agent');
    console.log('   Contraseña: 123456');
    console.log('   Rol: Agente');
    
    const finalLeads = await costumers.countDocuments({ agenteNombre: 'test.agent' });
    const stats = await costumers.aggregate([
      { $match: { agenteNombre: 'test.agent' } },
      {
        $group:  {
          _id: null,
          totalVentas: { $sum: { $cond: [{ $eq: ['$status', 'vendido'] }, 1, 0] } },
          totalPuntos: { $sum: '$puntaje' }
        }
      }
    ]).toArray();
    
    console.log('\n📊 ESTADÍSTICAS PARA test.agent:');
    console.log(`   Total de leads: ${finalLeads}`);
    if (stats.length > 0) {
      console.log(`   Total de ventas: ${stats[0].totalVentas}`);
      console.log(`   Total de puntos: ${stats[0].totalPuntos}`);
    }
    
    console.log('\n🌐 PRÓXIMO PASO:');
    console.log('   1. Ve a: http://localhost:3000/login.html');
    console.log('   2. Login con test.agent / 123456');
    console.log('   3. Verás tus datos reales en el dashboard 🎉\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setTimeout(setupTestData, 1000);
