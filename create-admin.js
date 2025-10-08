// Usar fetch nativo de Node.js (disponible desde v18)

async function createAdmin() {
  try {
    const response = await fetch('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123',
        role: 'Administrador'
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Usuario administrador creado exitosamente');
      console.log('Username: admin');
      console.log('Password: admin123');
      console.log('Role: Administrador');
    } else {
      console.log('❌ Error:', data.message);
      if (data.message.includes('ya está en uso')) {
        console.log('ℹ️  El usuario admin ya existe, puedes usar las credenciales:');
        console.log('Username: admin');
        console.log('Password: admin123');
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

createAdmin();
