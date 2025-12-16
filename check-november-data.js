// Script para verificar y diagnosticar datos de noviembre
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/crm';
const DB_NAME = 'crm';

console.log('🔌 Conectando a:', MONGO_URI.replace(/:[^:]*@/, ':****@'));

async function checkNovemberData() {
  const client = new MongoClient(MONGO_URI, { 
    useNewUrlParser: false,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 10000
  });
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');
    
    const db = client.db(DB_NAME);
    const rankingsCollection = db.collection('rankings');
    
    // Verificar enero de 2025
    console.log('\n📊 Análisis de datos en la colección "rankings":');
    console.log('=========================================');
    
    // Contar documentos totales
    const totalDocs = await rankingsCollection.countDocuments();
    console.log(`\n📈 Total de documentos: ${totalDocs}`);
    
    // Verificar valores únicos de "mes"
    const uniqueMonths = await rankingsCollection.distinct('mes');
    console.log(`\n📅 Meses encontrados (${uniqueMonths.length}):`, uniqueMonths.sort());
    
    // Buscar específicamente noviembre 2025
    const novemberData = await rankingsCollection
      .find({ mes: '2025-11' })
      .project({
        _id: 1,
        agente: 1,
        agenteNombre: 1,
        nombre: 1,
        puntos: 1,
        puntaje: 1,
        sumPuntaje: 1,
        ventas: 1,
        position: 1,
        posicion: 1,
        mes: 1
      })
      .sort({ sumPuntaje: -1, puntos: -1 })
      .limit(10)
      .toArray();
    
    console.log(`\n🔍 Datos de Noviembre 2025 (2025-11):`);
    console.log(`   Encontrados: ${novemberData.length} documentos`);
    
    if (novemberData.length > 0) {
      console.log('\n   Top 3:');
      novemberData.slice(0, 3).forEach((r, idx) => {
        const name = r.agenteNombre || r.nombre || r.agente || 'Desconocido';
        const score = r.sumPuntaje || r.puntos || 0;
        console.log(`   ${idx + 1}. ${name}: ${score} puntos`);
      });
    } else {
      console.log('\n   ⚠️  No hay datos para noviembre 2025 con formato mes="2025-11"');
      
      // Buscar si existen datos de noviembre de otros años
      const novemberOtherYears = await rankingsCollection
        .find({ mes: /^.*-11$/ })
        .project({ mes: 1, _id: 0 })
        .distinct('mes');
      
      if (novemberOtherYears.length > 0) {
        console.log('\n   💡 Se encontraron datos de noviembre en otros años:');
        novemberOtherYears.forEach(m => console.log(`      - ${m}`));
      }
    }
    
    // Verificar estructura de documentos para entender el problema
    console.log('\n🔧 Estructura de un documento de ranking:');
    const sampleDoc = await rankingsCollection.findOne();
    if (sampleDoc) {
      console.log('   Campos encontrados:', Object.keys(sampleDoc));
      if (sampleDoc.mes) {
        console.log(`   Ejemplo de valor "mes": "${sampleDoc.mes}"`);
      } else {
        console.log('   ⚠️  Campo "mes" no encontrado en documento');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Conexión cerrada');
  }
}

checkNovemberData().catch(console.error);
