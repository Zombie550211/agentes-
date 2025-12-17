// Script simple para probar el endpoint de debug de INGRID
async function testEndpoint() {
  try {
    // Hacer la solicitud sin autenticación (ya que agregamos protect al endpoint, necesitaremos token)
    // Por ahora, intentemos sin ella
    const response = await fetch('http://localhost:3000/api/debug/ingrid-score', {
      headers: {
        'Authorization': 'Bearer fake-token'
      }
    });
    
    const data = await response.json();
    console.log('Respuesta:', data);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testEndpoint();
