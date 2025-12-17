const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const JWT_SECRET = 'tu_secreto_jwt_muy_seguro';

async function test() {
  try {
    // Generar token válido
    const token = jwt.sign({
      id: '5e36c68b402a4e001688a f6d',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin'
    }, JWT_SECRET, { expiresIn: '1h' });

    console.log('Token generado:', token.substring(0, 50) + '...');

    // Hacer solicitud con token
    const res = await fetch('http://localhost:3000/api/ranking?all=1&fechaInicio=2025-12-01&fechaFin=2025-12-31', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Status:', res.status);
    
    if (res.status === 200) {
      const data = await res.json();
      console.log('Total en ranking:', data.ranking?.length || 0);
      
      // Buscar INGRID
      const ingrid = (data.ranking || []).find(r => 
        (r.nombreNormalizado || '').includes('ingrid') ||
        (r.nombre || '').toUpperCase().includes('INGRID')
      );
      
      if (ingrid) {
        console.log('\n✓ INGRID en ranking:');
        console.log('  Nombre:', ingrid.nombre);
        console.log('  Puntos:', ingrid.puntos);
        console.log('  Ventas:', ingrid.ventas);
        console.log('  Colecciones:', ingrid.originCollections);
      } else {
        console.log('\n✗ INGRID no encontrado!');
        console.log('Top 5:');
        (data.ranking || []).slice(0, 5).forEach((r, i) => {
          console.log(`  ${i+1}. ${r.nombre}: ${r.puntos} pts`);
        });
      }
    } else {
      const text = await res.text();
      console.log('Error response:', text.substring(0, 200));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

test();
