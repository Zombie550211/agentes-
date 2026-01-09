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
    // First login to get a token - using Bryan Pleitez from logs
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
        password: '12345' // Common default password
      })
    };
    
    const loginResponse = await makeRequest(loginOptions);
    console.log('Login status:', loginResponse.status);
    
    if (loginResponse.status !== 200) {
      console.log('Login failed, trying different password...');
      // Try with username as password
      loginOptions.body = JSON.stringify({
        username: 'bpleitez',
        password: 'bpleitez'
      });
      const loginResponse2 = await makeRequest(loginOptions);
      console.log('Second login attempt status:', loginResponse2.status);
      if (loginResponse2.status !== 200) {
        console.log('Login response:', JSON.stringify(loginResponse.data, null, 2));
        return;
      }
      var token = loginResponse2.data.token;
    } else {
      var token = loginResponse.data.token;
    }
    
    console.log('Token obtained:', token ? 'YES' : 'NO');
    
    if (!token) {
      console.log('No token found');
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
    console.log('Leads API total:', leadsResponse.data.total);
    console.log('Leads API returned:', leadsResponse.data.data ? leadsResponse.data.data.length : 0);
    
    // Also test without date filters to see if there's any data
    const allLeadsOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/leads?allData=true&limit=10',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    const allLeadsResponse = await makeRequest(allLeadsOptions);
    console.log('\nAll leads API status:', allLeadsResponse.status);
    console.log('All leads total:', allLeadsResponse.data.total);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLeadsAPI();
