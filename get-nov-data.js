// Script para consultar datos de noviembre usando token
const http = require('http');
const url = require('url');

function makeRequest(requestUrl, token = null) {
  return new Promise((resolve, reject) => {
    const urlObj = url.parse(requestUrl);
    
    const headers = {
      'User-Agent': 'Node.js'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Cookie'] = `auth_token=${token}`;
    }
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 3000,
      path: urlObj.path,
      method: 'GET',
      headers: headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function getNovemberData() {
  try {
    console.log('🔑 Obteniendo token...\n');
    
    // Primero hacer login
    const { MongoClient } = require('mongodb');
    
    // Conectar a MongoDB para obtener credenciales válidas
    const client = new MongoClient(process.env.MONGODB_URI);
    
    let token = 'temp-token';
    
    try {
      await client.connect();
      console.log('✅ Conectado a MongoDB');
      
      const db = client.db('crmagente');
      const rankingsColl = db.collection('rankings');
      
      // Obtener estadísticas
      const total = await rankingsColl.countDocuments();
      console.log(`\n📊 Total de documentos en rankings: ${total}`);
      
      // Ver meses disponibles
      const months = await rankingsColl.distinct('mes');
      console.log(`\n📅 Meses disponibles (${months.length}):`);
      months.sort().forEach(m => console.log(`   • ${m}`));
      
      // Buscar noviembre
      console.log('\n\n🔍 Buscando datos de Noviembre 2025...\n');
      
      const novData = await rankingsColl
        .find({ mes: '2025-11' })
        .sort({ sumPuntaje: -1, puntos: -1 })
        .limit(20)
        .toArray();
      
      console.log(`✅ Encontrados: ${novData.length} agentes\n`);
      
      if (novData.length === 0) {
        console.log('⚠️  No hay datos con mes="2025-11"');
        console.log('\nIntentando buscar por rango de fechas...\n');
        
        const startDate = new Date('2025-11-01T00:00:00Z');
        const endDate = new Date('2025-11-30T23:59:59Z');
        
        const dateData = await rankingsColl
          .find({
            $or: [
              { createdAt: { $gte: startDate, $lte: endDate } },
              { dia_venta: { $gte: startDate, $lte: endDate } },
              { fecha: { $gte: startDate, $lte: endDate } }
            ]
          })
          .sort({ sumPuntaje: -1, puntos: -1 })
          .limit(20)
          .toArray();
        
        console.log(`📋 Encontrados por rango de fechas: ${dateData.length} agentes\n`);
        
        if (dateData.length > 0) {
          printRanking(dateData);
        }
      } else {
        printRanking(novData);
      }
      
    } finally {
      await client.close();
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

function printRanking(data) {
  console.log('🏆 TOP 3 NOVIEMBRE 2025:');
  console.log('═'.repeat(60));
  
  data.slice(0, 3).forEach((agent, idx) => {
    const name = agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido';
    const score = agent.sumPuntaje || agent.puntos || agent.puntaje || 0;
    const sales = agent.ventas || 0;
    const position = agent.position || agent.posicion || (idx + 1);
    
    console.log(`\n${idx + 1}️⃣  POSICIÓN #${position}`);
    console.log(`   Nombre: ${name}`);
    console.log(`   Puntaje: ${score}`);
    console.log(`   Ventas: ${sales}`);
  });
  
  console.log('\n\n📊 TOP 10 COMPLETO:');
  console.log('═'.repeat(60));
  console.log('Pos | Nombre (20 chars) | Puntaje | Ventas');
  console.log('────┼───────────────────┼─────────┼──────');
  
  data.slice(0, 10).forEach((agent, idx) => {
    const name = (agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido').substring(0, 20);
    const score = (agent.sumPuntaje || agent.puntos || 0).toString();
    const sales = agent.ventas || 0;
    const position = agent.position || agent.posicion || (idx + 1);
    
    console.log(`${String(position).padStart(3)} | ${name.padEnd(20)} | ${score.padEnd(7)} | ${sales}`);
  });
  
  console.log('\n');
}

getNovemberData().catch(console.error);
