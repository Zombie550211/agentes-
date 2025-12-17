const mongoose = require('mongoose');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const http = require('http');

async function main() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://admin:h9wC5u1S8k@cluster0.m9m6j.mongodb.net/dashboard_agentes?retryWrites=true&w=majority', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✓ Conectado a MongoDB\n');

    // Obtener un usuario válido
    const user = await User.findOne({ email: { $exists: true } }).select('+password');
    
    if (!user) {
      console.log('❌ No se encontró ningún usuario para generar token');
      process.exit(1);
    }

    // Crear token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email,
        role: user.role || 'agent'
      },
      process.env.JWT_SECRET || 'mi-super-secret-key',
      { expiresIn: '1h' }
    );

    console.log(`✓ Token generado para: ${user.email}\n`);

    // Hacer request al ranking con el token
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/ranking?limit=20',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const ingrid = response.data?.find(d => d.nombre && d.nombre.toLowerCase().includes('ingrid'));
          
          if (ingrid) {
            console.log('✓ INGRID encontrada en ranking:');
            console.log(`  Nombre: ${ingrid.nombre}`);
            console.log(`  Puntos: ${ingrid.puntos}`);
            console.log(`  Ventas: ${ingrid.ventas}`);
            
            if (ingrid.puntos === 15.15) {
              console.log('\n✅ FIX EXITOSO: INGRID ahora muestra 15.15 puntos (correcto)');
            } else if (ingrid.puntos === 13.65) {
              console.log('\n❌ FIX NO FUNCIONÓ: INGRID todavía muestra 13.65 puntos');
            } else {
              console.log(`\n⚠️ VALOR DIFERENTE: INGRID muestra ${ingrid.puntos} puntos`);
            }
          } else {
            console.log('❌ INGRID no encontrada en ranking');
            console.log('\nPrimeros 3 agentes:');
            response.data?.slice(0, 3).forEach(d => {
              console.log(`  - ${d.nombre}: ${d.puntos} puntos`);
            });
          }
        } catch (error) {
          console.error('Error parsing response:', error.message);
        }
        process.exit(0);
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error.message);
      process.exit(1);
    });

    req.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
