// Script para obtener un token y luego consultar noviembre
const http = require('http');
const https = require('https');
const url = require('url');

function makeRequest(requestUrl, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = url.parse(requestUrl);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const defaultHeaders = {
      'User-Agent': 'Node.js',
      ...headers
    };

    if (body) {
      defaultHeaders['Content-Type'] = 'application/json';
      defaultHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.path,
      method: method,
      headers: defaultHeaders
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

async function checkNovember() {
  try {
    console.log('🔑 Intentando obtener token...\n');
    
    // Intentar con credenciales de demo (admin)
    const loginBody = JSON.stringify({
      username: 'admin',
      password: process.env.ADMIN_PASS || 'admin123'
    });

    try {
      const loginRes = await makeRequest(
        'http://localhost:3000/api/auth/login',
        'POST',
        loginBody
      );

      console.log(`Login response: ${loginRes.status}`);
      
      if (loginRes.status === 200) {
        const loginData = JSON.parse(loginRes.data);
        console.log('✅ Login exitoso\n');
        console.log('Respuesta del login:');
        console.log(JSON.stringify(loginData, null, 2));
      } else {
        console.log('⚠️  No se pudo hacer login');
        console.log('Respuesta:', loginRes.data);
      }
    } catch (e) {
      console.log(`⚠️  Error en login: ${e.message}`);
    }

    // Intenta con un test de base de datos directo
    console.log('\n\n🗄️  Intentando acceso directo a MongoDB...\n');
    
    const { MongoClient } = require('mongodb');
    const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/crm';
    
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    
    try {
      await client.connect();
      const db = client.db('crmagente');
      const rankingsColl = db.collection('rankings');
      
      // Contar total
      const total = await rankingsColl.countDocuments();
      console.log(`📊 Total de documentos en rankings: ${total}`);
      
      // Ver meses únicos
      const months = await rankingsColl.distinct('mes');
      console.log(`\n📅 Meses disponibles: ${months.sort().join(', ')}`);
      
      // Buscar noviembre
      const novData = await rankingsColl
        .find({ mes: '2025-11' })
        .sort({ sumPuntaje: -1 })
        .limit(3)
        .toArray();
      
      console.log(`\n📋 Datos de Noviembre 2025 (mes="2025-11"): ${novData.length} documentos`);
      
      if (novData.length > 0) {
        console.log('\n🏆 TOP 3:\n');
        novData.forEach((agent, idx) => {
          console.log(`${idx + 1}. ${agent.agenteNombre || agent.nombre}`);
          console.log(`   Puntaje: ${agent.sumPuntaje || agent.puntos}`);
          console.log(`   Ventas: ${agent.ventas}\n`);
        });
      } else {
        console.log('\n⚠️  No hay datos con mes="2025-11"');
        
        // Buscar por rango de fechas
        console.log('\nBuscando por rango de fechas...');
        const dateRangeData = await rankingsColl
          .find({
            $or: [
              { createdAt: { $gte: new Date('2025-11-01'), $lte: new Date('2025-11-30 23:59:59') } },
              { dia_venta: { $gte: new Date('2025-11-01'), $lte: new Date('2025-11-30 23:59:59') } }
            ]
          })
          .sort({ sumPuntaje: -1 })
          .limit(3)
          .toArray();
        
        console.log(`\n📋 Datos encontrados por rango de fechas: ${dateRangeData.length}`);
        if (dateRangeData.length > 0) {
          dateRangeData.forEach((agent, idx) => {
            console.log(`${idx + 1}. ${agent.agenteNombre || agent.nombre}`);
            console.log(`   Puntaje: ${agent.sumPuntaje || agent.puntos}`);
            console.log(`   Ventas: ${agent.ventas}\n`);
          });
        }
      }
      
    } catch (e) {
      console.log(`⚠️  Error conexión MongoDB: ${e.message}`);
    } finally {
      await client.close();
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkNovember();
