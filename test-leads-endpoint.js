async function testLeadsEndpoint() {
  try {
    // Token de Guadalupe Santana (del log anterior)
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YWY1NDQxYzYxYzQwNWUyYmI3YjBkZCIsInVzZXJuYW1lIjoiR3VhZGFsdXBlIFNhbnRhbmEiLCJyb2xlIjoiU3VwZXJ2aXNvciIsInRlYW0iOiJURUFNIEdVQURBTFVQRSBTQU5UQU5BIiwiaWF0IjoxNzY3OTc5MTE5LCJleHAiOjE3Njg1ODM5MTl9.zmR5k_i3z23hd9B_RFiSwqKLkH-LAs7cQ2QR69_oDu8';
    
    console.log('Probando endpoint /api/leads...');
    
    // Probar la primera llamada que hace el frontend (sin agenteId específico)
    const response = await fetch('http://localhost:3000/api/leads?limit=5000&noAutoMonth=1', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    console.log('Status:', response.status);
    console.log('Data length:', data?.length || 0);
    console.log('Response:', data);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLeadsEndpoint();
