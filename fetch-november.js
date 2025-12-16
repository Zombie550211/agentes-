// Script para obtener datos de noviembre de MongoDB
const { MongoClient } = require('mongodb');

async function getNovemberData() {
  // Usar la conexión remota de MongoDB Atlas
  const MONGO_URI = 'mongodb+srv://Zombie550211:Habibi%40123@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority';
  const client = new MongoClient(MONGO_URI, { 
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 10000
  });
  
  try {
    console.log('🔌 Conectando a MongoDB Atlas...\n');
    await client.connect();
    console.log('✅ Conectado\n');
    
    const db = client.db('crmagente');
    const rankingsColl = db.collection('rankings');
    
    // Obtener estadísticas
    const total = await rankingsColl.countDocuments();
    console.log(`📊 Total de documentos en rankings: ${total}`);
    
    // Ver meses disponibles
    const months = await rankingsColl.distinct('mes');
    console.log(`\n📅 Meses disponibles (${months.length}):`);
    months.sort().reverse().forEach(m => console.log(`   • ${m}`));
    
    // Buscar noviembre 2025
    console.log('\n\n🔍 Buscando datos de Noviembre 2025 (mes="2025-11")...\n');
    
    const novData = await rankingsColl
      .find({ mes: '2025-11' })
      .sort({ sumPuntaje: -1, puntos: -1 })
      .limit(20)
      .toArray();
    
    console.log(`✅ Encontrados: ${novData.length} agentes`);
    
    if (novData.length === 0) {
      console.log('\n⚠️  No hay datos con mes="2025-11"');
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
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

function printRanking(data) {
  console.log('🏆 TOP 3 NOVIEMBRE 2025:');
  console.log('═'.repeat(70));
  
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
  console.log('═'.repeat(70));
  console.log('Pos | Nombre (25 chars) | Puntaje | Ventas | Posición');
  console.log('────┼───────────────────┼─────────┼────────┼──────');
  
  data.slice(0, 10).forEach((agent, idx) => {
    const name = (agent.agenteNombre || agent.nombre || agent.agente || 'Desconocido').substring(0, 25);
    const score = (agent.sumPuntaje || agent.puntos || 0).toString();
    const sales = (agent.ventas || 0).toString();
    const position = agent.position || agent.posicion || (idx + 1);
    
    console.log(`${String(position).padStart(3)} | ${name.padEnd(25)} | ${score.padEnd(7)} | ${sales.padEnd(6)} | #${position}`);
  });
  
  console.log('\n');
}

getNovemberData().catch(console.error);
