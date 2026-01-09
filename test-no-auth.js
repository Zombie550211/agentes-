const http = require('http');

// Make a request without authentication to see the error
async function testWithoutAuth() {
  try {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/leads?fechaInicio=2026-01-02&fechaFin=2026-01-08&limit=10',
      method: 'GET'
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Response:', data);
      });
    });
    
    req.on('error', (err) => {
      console.error('Error:', err.message);
    });
    
    req.end();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testWithoutAuth();
