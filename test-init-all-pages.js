#!/usr/bin/env node
/**
 * Test script para /api/init-all-pages
 * Verifica que el endpoint retorne datos válidos del mes actual
 */

const http = require('http');
const BASE_URL = 'http://localhost:3000';

// Token de prueba (reemplazar con token válido de un usuario logueado)
const TOKEN = process.argv[2] || null;

if (!TOKEN) {
  console.log(`
❌ Token no proporcionado

Uso:
  node test-init-all-pages.js "your-jwt-token-here"

Para obtener un token:
  1. Loguea en http://localhost:3000/login.html
  2. Abre DevTools Console y corre:
     localStorage.getItem('token')
  3. Copia el token y pégalo en el comando anterior
  `);
  process.exit(1);
}

async function testInitAllPages() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/init-all-pages',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing /api/init-all-pages endpoint...\n');
  
  try {
    const result = await testInitAllPages();
    
    console.log(`Status: ${result.status}`);
    console.log('\nResponse:');
    
    if (result.status === 200) {
      const body = result.body;
      console.log(`✅ Success: ${body.success}`);
      console.log(`⏱️  Load time: ${body.loadTime}ms`);
      console.log(`👤 User: ${body.user?.username} (${body.user?.role})`);
      console.log(`📅 Month: ${body.data?.monthYear}`);
      console.log(`\n📊 Data Summary:`);
      console.log(`  - Dashboard: ${body.data?.dashboard ? '✅ present' : '❌ missing'}`);
      console.log(`  - Customers: ${body.data?.customers?.length || 0} registros`);
      console.log(`  - Leads: ${body.data?.leads?.length || 0} registros`);
      console.log(`  - Rankings: ${body.data?.rankings?.length || 0} registros`);
      console.log(`  - Stats teams: ${Object.keys(body.data?.stats || {}).length} equipos`);
      console.log(`\n💾 Cache TTL: ${body.ttl}ms (${Math.round(body.ttl / 1000 / 60)} minutos)`);
      console.log(`\n✨ Test PASSED\n`);
    } else if (result.status === 403) {
      console.log(`❌ Forbidden (token inválido o expirado)`);
      console.log(`\nResponse:`, JSON.stringify(result.body, null, 2));
    } else if (result.status === 503) {
      console.log(`❌ Service Unavailable (base de datos no disponible)`);
      console.log(`\nResponse:`, JSON.stringify(result.body, null, 2));
    } else {
      console.log(`❌ Unexpected status: ${result.status}`);
      console.log(`\nResponse:`, JSON.stringify(result.body, null, 2));
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    console.log(`\nMake sure the server is running on port 3000`);
  }
}

runTests().catch(console.error);
