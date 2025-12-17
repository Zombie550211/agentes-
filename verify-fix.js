const http = require('http');

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('Verificando ranking de INGRID.GARCIA...\n');
    
    // Obtener ranking con límite
    const ranking = await makeRequest('http://localhost:3000/api/ranking?limit=20');
    
    // Buscar INGRID
    const ingrid = ranking.data.find(d => d.nombre && d.nombre.includes('INGRID'));
    
    if (ingrid) {
      console.log('✓ INGRID encontrada en ranking:');
      console.log(`  Nombre: ${ingrid.nombre}`);
      console.log(`  Puntos: ${ingrid.puntos}`);
      console.log(`  Ventas: ${ingrid.ventas}`);
      console.log(`  Colecciones: ${ingrid.originCollections.join(', ')}`);
      
      if (ingrid.puntos === 15.15) {
        console.log('\n✅ FIX EXITOSO: INGRID ahora muestra 15.15 puntos (correcto)');
      } else if (ingrid.puntos === 13.65) {
        console.log('\n❌ FIX NO FUNCIONÓ: INGRID todavía muestra 13.65 puntos');
      } else {
        console.log(`\n⚠️ VALOR INESPERADO: INGRID muestra ${ingrid.puntos} puntos`);
      }
    } else {
      console.log('❌ INGRID no encontrada en ranking');
      console.log('\nPrimeros 5 agentes:');
      ranking.data.slice(0, 5).forEach(d => {
        console.log(`  - ${d.nombre}: ${d.puntos} puntos`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
