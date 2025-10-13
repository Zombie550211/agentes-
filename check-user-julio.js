// Script temporal para verificar el rol del usuario Julio Chavez
const { MongoClient } = require('mongodb');

async function checkUserJulio() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dashboard';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db();
    
    // Buscar el usuario Julio Chavez
    const user = await db.collection('users').findOne({ 
      $or: [
        { username: 'Julio Chavez' },
        { username: 'julio chavez' },
        { username: { $regex: /julio.*chavez/i } }
      ]
    });
    
    if (user) {
      console.log('Usuario encontrado:');
      console.log('Username:', user.username);
      console.log('Role:', user.role);
      console.log('Team:', user.team);
      console.log('Supervisor:', user.supervisor);
      console.log('Creado:', user.createdAt);
      console.log('Actualizado:', user.updatedAt);
    } else {
      console.log('Usuario "Julio Chavez" no encontrado');
      
      // Buscar usuarios similares
      const similarUsers = await db.collection('users').find({
        username: { $regex: /julio|chavez/i }
      }).toArray();
      
      if (similarUsers.length > 0) {
        console.log('\nUsuarios similares encontrados:');
        similarUsers.forEach(u => {
          console.log(`- ${u.username} (${u.role})`);
        });
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkUserJulio();
