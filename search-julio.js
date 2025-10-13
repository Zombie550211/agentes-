// Script para buscar usuarios con nombres similares a Julio Chavez
const fetch = require('node-fetch');

async function searchJulio() {
  try {
    const response = await fetch('http://localhost:3000/api/debug/users');
    const data = await response.json();
    
    if (data.success && data.users) {
      console.log('Buscando usuarios con nombres similares a "Julio Chavez"...\n');
      
      // Buscar coincidencias exactas
      const exactMatches = data.users.filter(user => 
        user.username.toLowerCase().includes('julio') || 
        user.username.toLowerCase().includes('chavez')
      );
      
      if (exactMatches.length > 0) {
        console.log('Coincidencias encontradas:');
        exactMatches.forEach(user => {
          console.log(`- Username: ${user.username}`);
          console.log(`  Role: ${user.role}`);
          console.log(`  ID: ${user._id}`);
          console.log(`  Creado: ${user.createdAt}\n`);
        });
      } else {
        console.log('No se encontraron coincidencias exactas para "Julio" o "Chavez"');
        
        // Mostrar todos los usuarios para referencia
        console.log('\nTodos los usuarios en el sistema:');
        data.users.forEach(user => {
          console.log(`- ${user.username} (${user.role})`);
        });
      }
    } else {
      console.log('Error al obtener usuarios:', data.message);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

searchJulio();
