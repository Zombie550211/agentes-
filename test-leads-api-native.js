const http = require('http');

function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function testLeadsAPI() {
  try {
    // First login to get a token
    const loginOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'bpleitez',
        password: '12345'
      })
    };
    
    const loginResponse = await makeRequest(loginOptions);
    console.log('Login status:', loginResponse.status);
    console.log('Login response:', JSON.stringify(loginResponse.data, null, 2));
    
    const token = loginResponse.data.token;
    if (!token) {
      console.log('No token found in login response');
      return;
    }
    
    // Now test the leads endpoint
    const leadsOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/leads?fechaInicio=2026-01-02&fechaFin=2026-01-08&limit=5000&offset=0',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    const leadsResponse = await makeRequest(leadsOptions);
    console.log('\nLeads API status:', leadsResponse.status);
    console.log('Leads API response:', JSON.stringify(leadsResponse.data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLeadsAPI();
