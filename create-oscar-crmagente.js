const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createOscarInCrmagente() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db('crmagente');
    const usersCol = db.collection('users');
    
    // Verificar si ya existe
    const existing = await usersCol.findOne({ username: 'OSCAR RIVERA' });
    
    if (existing) {
      console.log('⚠️  OSCAR RIVERA ya existe en crmagente');
      console.log(`   Supervisor actual: ${existing.supervisor}`);
      
      // Actualizar supervisor si es diferente
      if (existing.supervisor !== 'JONATHAN F') {
        await usersCol.updateOne(
          { username: 'OSCAR RIVERA' },
          { $set: { supervisor: 'JONATHAN F', team: 'team lineas jonathan' } }
        );
        console.log('   ✅ Supervisor actualizado a: JONATHAN F');
      } else {
        console.log('   ℹ️  Ya tiene el supervisor correcto');
      }
    } else {
      // Crear OSCAR RIVERA
      const hashedPassword = await bcrypt.hash('oscar123', 10);
      
      const newAgent = {
        username: 'OSCAR RIVERA',
        name: 'OSCAR RIVERA',
        password: hashedPassword,
        role: 'Agente',
        team: 'team lineas jonathan',
        supervisor: 'JONATHAN F',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await usersCol.insertOne(newAgent);
      console.log('✅ OSCAR RIVERA creado exitosamente en crmagente');
      console.log('   Username: OSCAR RIVERA');
      console.log('   Password temporal: oscar123');
      console.log('   Supervisor: JONATHAN F');
      console.log('   Team: team lineas jonathan');
    }
    
    // Verificar estado final de los 3 agentes
    console.log('\n📋 Estado final de los 3 agentes en crmagente:');
    const agents = await usersCol.find({ 
      username: { $in: ['NANCY LOPEZ', 'JOCELYN REYES', 'OSCAR RIVERA'] } 
    }).toArray();
    
    agents.forEach(a => {
      console.log(`   ${a.username}: supervisor=${a.supervisor}, team=${a.team}`);
    });
    
    console.log('\n⚠️  IMPORTANTE: Cambiar la contraseña temporal después del primer login');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('\n🔌 Conexión cerrada');
  }
}

createOscarInCrmagente();
