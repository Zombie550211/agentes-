const fetch = require('node-fetch');

async function test() {
  try {
    // Intentar login con credenciales estándar
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    });

    console.log('Login Status:', loginRes.status);
    const loginData = await loginRes.json();
    
    if (loginData.token) {
      console.log('✓ Login exitoso. Token obtenido');
      const token = loginData.token;

      // Ahora solicitar ranking SIN CACHE (debug=1)
      const rankRes = await fetch('http://localhost:3000/api/ranking?all=1&fechaInicio=2025-12-01&fechaFin=2025-12-31&debug=1', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (rankRes.status === 200) {
        const data = await rankRes.json();
        const ingrid = (data.ranking || []).find(r => 
          (r.nombreNormalizado || '').includes('ingrid') ||
          (r.nombre || '').toUpperCase().includes('INGRID')
        );
        
        if (ingrid) {
          console.log('\n✓ INGRID encontrado:');
          console.log('  Nombre:', ingrid.nombre);
          console.log('  Puntos:', ingrid.puntos);
          console.log('  Ventas:', ingrid.ventas);
          console.log('  Colecciones:', ingrid.originCollections);
        } else {
          console.log('\n✗ INGRID no encontrado');
        }
      } else {
        console.log('Ranking error:', rankRes.status);
      }
    } else {
      console.log('Login failed:', loginData.message || 'Unknown error');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

test();
