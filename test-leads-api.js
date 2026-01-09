const axios = require('axios');

async function testLeadsAPI() {
  try {
    // First login to get a token
    const loginResponse = await axios.post('http://localhost:3000/api/auth/login', {
      username: 'bpleitez', // Using the supervisor username from the logs
      password: '12345' // You may need to update this
    });
    
    const token = loginResponse.data.token;
    console.log('Token obtained:', token ? 'YES' : 'NO');
    
    if (!token) {
      console.log('Login response:', loginResponse.data);
      return;
    }
    
    // Now test the leads endpoint
    const leadsResponse = await axios.get('http://localhost:3000/api/leads?fechaInicio=2026-01-02&fechaFin=2026-01-08&limit=5000&offset=0', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', leadsResponse.status);
    console.log('Response data:', JSON.stringify(leadsResponse.data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
}

testLeadsAPI();
