const fetch = require('node-fetch');

async function clean() {
  try {
    console.log('🧹 Intentando eliminar usuarios "Emanuel Velásquez" vía API...');
    const res = await fetch('http://localhost:3000/api/debug/cleanup-users', {
      method: 'DELETE'
    });
    
    if (res.ok) {
      const data = await res.json();
      console.log('✅ Resultado:', data);
    } else {
      console.error('❌ Error en la petición:', res.status, res.statusText);
      const text = await res.text();
      console.error('Body:', text);
    }
  } catch (e) {
    console.error('❌ No se pudo conectar con el servidor. Asegúrate de que "npm start" esté corriendo en otra terminal.');
    console.error('Error:', e.message);
  }
}

clean();
