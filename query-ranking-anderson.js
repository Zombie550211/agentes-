const http = require('http');

async function queryRanking() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/ranking?agente=anderson&debug=1&all=1',
      method: 'GET',
      headers: {
        'Cookie': 'token=your_token_here' // Esto podría fallar si requiere auth
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    console.log('\n🔗 Consultando /api/ranking?agente=anderson&debug=1&all=1\n');
    const result = await queryRanking();
    console.log(JSON.stringify(result, null, 2));
  } catch(e) {
    console.error('❌ Error conectando al servidor:', e.message);
    console.log('\n💡 El servidor no está corriendo en localhost:3000');
  }
}

main();
