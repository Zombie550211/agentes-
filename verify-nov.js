// Script para consultar datos de noviembre desde la API HTTP
const http = require('http');
const url = require('url');

function makeRequest(fullUrl, token = null) {
  return new Promise((resolve, reject) => {
    const urlObj = url.parse(fullUrl);
    
    const headers = {
      'User-Agent': 'Node.js'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Cookie'] = `auth_token=${token}`;
    }
    
    const options = {
      hostname: urlObj.hostname || 'localhost',
      port: urlObj.port || 3000,
      path: urlObj.path || urlObj.pathname,
      method: 'GET',
      headers: headers
    };

    console.log(`  Consultando: ${options.hostname}:${options.port}${options.path}`);

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function checkNovember() {
  try {
    console.log('🔑 Obteniendo token...\n');
    
    // Paso 1: Hacer login para obtener token
    const loginUrl = 'http://localhost:3000/api/auth/login';
    
    const loginPromise = new Promise((resolve, reject) => {
      const data = JSON.stringify({ username: 'admin', password: 'admin123' });
      const urlObj = url.parse(loginUrl);
      
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          resolve({ status: res.statusCode, data: responseData });
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });

    const loginRes = await loginPromise;
    
    if (loginRes.status !== 200) {
      console.log(`❌ Error login: HTTP ${loginRes.status}`);
      console.log(loginRes.data);
      return;
    }

    const loginData = JSON.parse(loginRes.data);
    const token = loginData.token;
    
    console.log('✅ Login exitoso');
    console.log(`Token: ${token.substring(0, 50)}...\n`);
    
    // Paso 2: Consultar datos de noviembre
    console.log('🔍 Consultando datos de Noviembre 2025...\n');
    
    const rankingUrl = 'http://localhost:3000/api/ranking?fechaInicio=2025-11-01&fechaFin=2025-11-30&all=1&limit=20&debug=1';
    
    const rankingRes = await makeRequest(rankingUrl, token);
    
    if (rankingRes.status !== 200) {
      console.log(`\n❌ Error: HTTP ${rankingRes.status}`);
      console.log('Respuesta:', rankingRes.data.substring(0, 500));
      return;
    }

    const rankingData = JSON.parse(rankingRes.data);
    
    if (!rankingData.success || !rankingData.ranking) {
      console.log('❌ Respuesta sin datos de ranking');
      console.log(JSON.stringify(rankingData, null, 2));
      return;
    }

    const ranking = rankingData.ranking;
    console.log(`✅ Encontrados: ${ranking.length} agentes\n`);
    
    printRanking(ranking);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

function printRanking(data) {
  console.log('🏆 TOP 3 NOVIEMBRE 2025:');
  console.log('═'.repeat(70));
  
  data.slice(0, 3).forEach((agent, idx) => {
    const name = agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido';
    const score = agent.sumPuntaje || agent.puntos || agent.puntaje || 0;
    const sales = agent.ventas || 0;
    const position = agent.position || agent.posicion || (idx + 1);
    
    console.log(`\n${idx + 1}️⃣  POSICIÓN #${position}`);
    console.log(`   Nombre: ${name}`);
    console.log(`   Puntaje: ${score}`);
    console.log(`   Ventas: ${sales}`);
  });
  
  console.log('\n\n📊 TOP 10 COMPLETO:');
  console.log('═'.repeat(70));
  console.log('Pos | Nombre (25 chars) | Puntaje | Ventas');
  console.log('────┼───────────────────┼─────────┼──────');
  
  data.slice(0, 10).forEach((agent, idx) => {
    const name = (agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido').substring(0, 25);
    const score = (agent.sumPuntaje || agent.puntos || 0).toString();
    const sales = (agent.ventas || 0).toString();
    const position = agent.position || agent.posicion || (idx + 1);
    
    console.log(`${String(position).padStart(3)} | ${name.padEnd(25)} | ${score.padEnd(7)} | ${sales.padEnd(6)}`);
  });
  
  console.log('\n');
}

checkNovember().catch(console.error);
