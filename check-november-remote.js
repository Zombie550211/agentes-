// Script rápido para verificar datos de noviembre sin conexión remota
const https = require('https');

const host = 'agentes-clean-production.up.railway.app';
const path = '/api/ranking?fechaInicio=2025-11-01&fechaFin=2025-11-30&all=1&limit=20&debug=1';

console.log(`📡 Consultando: https://${host}${path}`);
console.log('=========================================\n');

const options = {
  hostname: host,
  port: 443,
  path: path,
  method: 'GET',
  headers: {
    'Cookie': 'auth_token=test' // Ajusta con un token válido si es necesario
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('📊 Respuesta del servidor:');
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('❌ Error parseando JSON:', e.message);
      console.log('📝 Respuesta cruda:\n', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error en la solicitud:', error.message);
});

req.end();
