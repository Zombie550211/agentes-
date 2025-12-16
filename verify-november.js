// Script para consultar datos de noviembre desde la API
const http = require('http');
const https = require('https');
const url = require('url');

// Función para hacer requests HTTPS
function fetchData(requestUrl) {
  return new Promise((resolve, reject) => {
    const urlObj = url.parse(requestUrl);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Node.js'
      }
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function checkNovemberRanking() {
  try {
    console.log('🔍 Consultando datos de noviembre 2025...\n');
    
    // Opciones para consultar los datos
    const queries = [
      {
        name: 'Noviembre 2025 (por campo "mes")',
        url: 'http://localhost:3000/api/ranking?fechaInicio=2025-11-01&fechaFin=2025-11-30&all=1&limit=20&debug=1'
      },
      {
        name: 'Noviembre 2025 (rango de fechas)',
        url: 'http://localhost:3000/api/ranking?fechaInicio=2025-11-01&fechaFin=2025-11-30&all=1&limit=20&field=createdAt'
      }
    ];

    for (const query of queries) {
      console.log(`\n📊 ${query.name}`);
      console.log('=========================================');
      
      try {
        const response = await fetchData(query.url);
        
        if (response.status !== 200) {
          console.log(`❌ Error HTTP ${response.status}`);
          console.log('Respuesta:', response.data.substring(0, 500));
          continue;
        }

        const data = JSON.parse(response.data);
        
        if (data.success && data.ranking && Array.isArray(data.ranking)) {
          const ranking = data.ranking;
          console.log(`✅ Encontrados ${ranking.length} agentes\n`);
          
          console.log('🏆 TOP 3:');
          ranking.slice(0, 3).forEach((agent, idx) => {
            const name = agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido';
            const score = agent.sumPuntaje || agent.puntos || agent.puntaje || 0;
            const sales = agent.ventas || 0;
            const position = agent.position || agent.posicion || (idx + 1);
            
            console.log(`\n${idx + 1}. ${name}`);
            console.log(`   Posición: #${position}`);
            console.log(`   Puntaje: ${score}`);
            console.log(`   Ventas: ${sales}`);
          });
          
          console.log('\n\n📋 TODOS LOS AGENTES (TOP 10):');
          console.log('Pos | Nombre | Puntaje | Ventas');
          console.log('---|--------|---------|-------');
          ranking.slice(0, 10).forEach((agent, idx) => {
            const name = (agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido').substring(0, 20);
            const score = (agent.sumPuntaje || agent.puntos || 0).toString().substring(0, 7);
            const sales = agent.ventas || 0;
            const position = agent.position || agent.posicion || (idx + 1);
            console.log(`${String(position).padEnd(3)} | ${name.padEnd(20)} | ${score.padEnd(7)} | ${sales}`);
          });
          
        } else {
          console.log('⚠️  Respuesta sin datos de ranking');
          console.log('Respuesta:', JSON.stringify(data, null, 2).substring(0, 500));
        }
      } catch (e) {
        console.log(`⚠️  Error: ${e.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Error general:', error.message);
  }
}

checkNovemberRanking();
