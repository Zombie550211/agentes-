// Test ranking endpoint
const fetch = require('node-fetch');

async function test() {
  console.log('Iniciando prueba...');
  try {
    console.log('Haciendo fetch a /api/ranking...');
    const res = await fetch('http://localhost:3000/api/ranking?all=1&fechaInicio=2025-12-01&fechaFin=2025-12-31', {
      headers: { 'Authorization': 'Bearer fake' }
    });
    console.log('Respuesta status:', res.status);
    const data = await res.json();
    console.log('JSON parseado. Total ranking:', data.ranking?.length || 0);
    
    // Buscar INGRID
    if (data.ranking && Array.isArray(data.ranking)) {
      const ingrid = data.ranking.find(r => 
        (r.nombreNormalizado || '').includes('ingridgarcia') || 
        (r.nombre || '').toUpperCase().includes('INGRID') ||
        (r.nombreOriginal || '').toUpperCase().includes('INGRID')
      );
      if (ingrid) {
        console.log('\n✓ INGRID encontrado en ranking:');
        console.log('  Nombre:', ingrid.nombre);
        console.log('  Puntos:', ingrid.puntos);
        console.log('  Ventas:', ingrid.ventas);
        console.log('  sumPuntaje:', ingrid.sumPuntaje);
        console.log('  Colecciones origen:', ingrid.originCollections);
      } else {
        console.log('\n✗ INGRID NO encontrado. Primeros 5:');
        (data.ranking || []).slice(0, 5).forEach((r, i) => {
          console.log(`${i+1}. ${r.nombre}: ${r.puntos} pts`);
        });
      }
    }
  } catch (e) {
    console.error('Error:', e.message, e.stack);
  }
  process.exit(0);
}

test();
