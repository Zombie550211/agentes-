const https = require('https');
const http = require('http');

async function callAPI(method, path, body = null, isHttps = true) {
  return new Promise((resolve, reject) => {
    const client = isHttps ? https : http;
    const options = {
      hostname: 'localhost',
      port: isHttps ? 3000 : 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      rejectUnauthorized: false // Para HTTPS auto-signed
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function main() {
  try {
    console.log('\n🔗 Intentando conectar al servidor en localhost:3000\n');
    
    // Primero, intentar auth
    console.log('🔐 Autenticando...');
    const authResponse = await callAPI('POST', '/api/auth/login', {
      email: 'admin@crmagente.com',
      password: process.env.ADMIN_PASSWORD || 'admin123'
    }, false).catch(e => {
      console.error('❌ No se pudo conectar al servidor en localhost:3000');
      console.log('💡 El servidor debe estar corriendo localmente');
      throw e;
    });
    
    if (authResponse.status !== 200) {
      console.error('❌ Error de autenticación:', authResponse.data?.message || authResponse.status);
      process.exit(1);
    }
    
    const token = authResponse.data?.token;
    if (!token) {
      console.error('❌ No se recibió token de autenticación');
      process.exit(1);
    }
    
    console.log('✅ Autenticación exitosa\n');
    
    // Ahora hacer el fix mediante una API personalizada
    console.log('🔄 Desmarcando registros excluidos de Anderson...');
    
    const fixResponse = await callAPI('PUT', '/api/admin/fix-anderson-ranking', {
      action: 'unmark-excluded',
      agent: 'anderson guzman',
      month: 12,
      year: 2025
    }, false);
    
    console.log('✅ Respuesta:', fixResponse.data);
    
  } catch(e) {
    console.error('❌ Error:', e.message);
  }
  process.exit(0);
}

main();
