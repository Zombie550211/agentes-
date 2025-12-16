// Verificar estructura y datos de la colección 'rankings'
const fetch = require('node-fetch');

const host = 'agentes-clean-production.up.railway.app';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3MzI3MjI5ZGNkNjBjMDAxZGZiNjRjMCIsInVzZXJuYW1lIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3MzI4NzM2MDF9.uuTHBW5DBrWNKPzJvKVJ8gTyFvfK8JjdD0YmCgJ1aUw';

async function checkRankingsCollection() {
  console.log('🔍 Consultando la colección "rankings" directamente...\n');
  
  // Llamar a init-rankings que consulta la colección rankings
  const url = `https://${host}/api/init-rankings?t=${Date.now()}`;
  
  const headers = {
    'Cookie': `auth_token=${token}`,
    'Authorization': `Bearer ${token}`
  };
  
  try {
    console.log('📊 Consultando /api/init-rankings\n');
    const res = await fetch(url, { headers });
    const data = await res.json();
    
    if (data.success) {
      console.log('✅ Respuesta exitosa\n');
      
      // Mostrar datos del mes actual
      if (data.data.currentMonthRanking) {
        console.log('📈 Ranking mes ACTUAL:');
        console.log(`   Total agentes: ${data.data.currentMonthRanking.length}`);
        console.log('   Top 3:');
        data.data.currentMonthRanking.slice(0, 3).forEach((a, idx) => {
          console.log(`   ${idx + 1}. ${a.nombre}: ${a.puntos} pts, ${a.ventas} ventas`);
        });
      }
      
      console.log('\n-------------------------------------------\n');
      
      // Mostrar datos por mes
      if (data.data.monthlyRankings) {
        console.log('📅 Rankings históricos por mes:');
        const months = Object.keys(data.data.monthlyRankings).sort();
        
        months.forEach(monthKey => {
          const monthData = data.data.monthlyRankings[monthKey];
          if (monthData && monthData.length > 0) {
            console.log(`\n   ${monthKey}:`);
            console.log(`   • Total: ${monthData.length} agentes`);
            console.log(`   • Top 3:`);
            monthData.slice(0, 3).forEach((a, idx) => {
              console.log(`     ${idx + 1}. ${a.nombre}: ${a.puntos} pts`);
            });
          } else {
            console.log(`\n   ${monthKey}: (sin datos)`);
          }
        });
      }
      
    } else {
      console.log('❌ Error:', data.message);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkRankingsCollection().catch(console.error);
