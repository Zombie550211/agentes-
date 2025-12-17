// Verificar qué campos de fecha tiene INGRID
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'tu_secreto_jwt_muy_seguro';

async function test() {
  try {
    // Generar token
    const token = jwt.sign({
      id: '5e36c68b402a4e001688a f6d',
      name: 'Admin',
      role: 'admin'
    }, JWT_SECRET, { expiresIn: '1h' });

    // Endpoint que devuelve un documento de sample
    const res = await fetch('http://localhost:3000/api/crm/debug-fields?agent=INGRID.GARCIA', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await res.json();
    if (data.sampleDocument) {
      const doc = data.sampleDocument;
      console.log('Documento de INGRID encontrado:');
      console.log('  Colección:', data.sourceCollection);
      console.log('  Campos de fecha:');
      console.log('    createdAt:', doc.createdAt, '(tipo: ' + typeof doc.createdAt + ')');
      console.log('    dia_venta:', doc.dia_venta, '(tipo: ' + typeof doc.dia_venta + ')');
      console.log('    fecha_venta:', doc.fecha_venta, '(tipo: ' + typeof doc.fecha_venta + ')');
      console.log('    fechaVenta:', doc.fechaVenta, '(tipo: ' + typeof doc.fechaVenta + ')');
    } else {
      console.log('No encontrado:', data);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

test();
