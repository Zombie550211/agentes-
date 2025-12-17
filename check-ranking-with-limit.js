const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'tu_secreto_jwt_muy_seguro';

async function test() {
  try {
    // Login
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });

    if (loginRes.status !== 200) {
      console.log('Login failed');
      process.exit(1);
    }

    const loginData = await loginRes.json();
    const token = loginData.token;

    // Pedir ranking CON limit=10000 para asegurar que trae TODOS
    const rankRes = await fetch('http://localhost:3000/api/ranking?all=1&fechaInicio=2025-12-01&fechaFin=2025-12-31&limit=10000&debug=1', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (rankRes.status === 200) {
      const data = await rankRes.json();
      const ingrid = (data.ranking || []).find(r => 
        (r.nombreNormalizado || '').includes('ingrid')
      );
      
      if (ingrid) {
        console.log('\nINGRID encontrado:');
        console.log('  Nombre:', ingrid.nombre);
        console.log('  Puntos:', ingrid.puntos);
        console.log('  Ventas (en ranking):', ingrid.ventas);
        console.log('  sumPuntaje:', ingrid.sumPuntaje);
        console.log('  avgPuntaje:', ingrid.avgPuntaje);
        console.log('  Colecciones:', ingrid.originCollections);
      } else {
        console.log('\nINGRID no encontrado');
        console.log('Total en ranking:', data.ranking?.length || 0);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

test();
