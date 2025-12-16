// Script para verificar si costumers tiene todos los datos de noviembre
const fetch = require('node-fetch');

const host = 'agentes-clean-production.up.railway.app';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3MzI3MjI5ZGNkNjBjMDAxZGZiNjRjMCIsInVzZXJuYW1lIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3MzI4NzM2MDF9.uuTHBW5DBrWNKPzJvKVJ8gTyFvfK8JjdD0YmCgJ1aUw';

async function checkCollections() {
  console.log('🔍 Consultando datos de NOVIEMBRE 2025...\n');
  
  // Consulta SIN all=1 (solo costumers principal)
  const urlSingle = `https://${host}/api/ranking?fechaInicio=2025-11-01&fechaFin=2025-11-30&limit=20&t=${Date.now()}`;
  
  // Consulta CON all=1 (todas las colecciones)
  const urlAll = `https://${host}/api/ranking?fechaInicio=2025-11-01&fechaFin=2025-11-30&all=1&limit=20&t=${Date.now()}`;
  
  const headers = {
    'Cookie': `auth_token=${token}`,
    'Authorization': `Bearer ${token}`
  };
  
  try {
    console.log('📊 CONSULTA 1: Solo costumers principal (sin all=1)');
    console.log(`URL: ${urlSingle}\n`);
    const res1 = await fetch(urlSingle, { headers });
    const data1 = await res1.json();
    
    if (data1.ranking && data1.ranking.length > 0) {
      console.log(`✅ Encontrados: ${data1.ranking.length} agentes`);
      console.log('\nTop 3:');
      data1.ranking.slice(0, 3).forEach((r, idx) => {
        console.log(`${idx + 1}. ${r.nombre || r.nombreOriginal}: ${r.sumPuntaje} pts, ${r.ventas} ventas`);
      });
    } else {
      console.log('❌ No hay datos en costumers para noviembre');
    }
    
    console.log('\n-------------------------------------------\n');
    
    console.log('📊 CONSULTA 2: Todas las colecciones (con all=1)');
    console.log(`URL: ${urlAll}\n`);
    const res2 = await fetch(urlAll, { headers });
    const data2 = await res2.json();
    
    if (data2.ranking && data2.ranking.length > 0) {
      console.log(`✅ Encontrados: ${data2.ranking.length} agentes`);
      console.log('\nTop 3:');
      data2.ranking.slice(0, 3).forEach((r, idx) => {
        console.log(`${idx + 1}. ${r.nombre || r.nombreOriginal}: ${r.sumPuntaje} pts, ${r.ventas} ventas`);
      });
    } else {
      console.log('❌ No hay datos en múltiples colecciones para noviembre');
    }
    
    console.log('\n-------------------------------------------\n');
    console.log('💡 ANÁLISIS:');
    if (data1.ranking && data2.ranking) {
      const single = data1.ranking[0];
      const all = data2.ranking[0];
      if (single && all) {
        console.log(`Sin all=1: ${single.nombre} - ${single.sumPuntaje} pts`);
        console.log(`Con all=1: ${all.nombre} - ${all.sumPuntaje} pts`);
        
        if (single.sumPuntaje === all.sumPuntaje) {
          console.log('\n✅ Los valores son IGUALES → costumers principal tiene TODOS los datos');
        } else {
          console.log('\n⚠️ Los valores son DIFERENTES → hay datos en colecciones individuales');
          console.log(`   Diferencia: ${all.sumPuntaje - single.sumPuntaje} puntos`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkCollections().catch(console.error);
