const { MongoClient } = require('mongodb');
require('dotenv').config();

// Lista de números a verificar
const numerosABuscar = [
  "4708843783", "5046448940", "2245789517", "7862419392", "5312827665",
  "9187066944", "9568578509", "3082673423", "7813467831", "7088825140",
  "3216979646", "4135056522", "8325241280", "2702569902", "7135383070",
  "4752014915", "9043105823", "2088299821", "7082434931", "7135399824",
  "7738774161", "7863059775", "4046413805", "9013413769", "2098082337",
  "7869566115", "2526434523", "5597749449", "4084219964", "7864901053",
  "8045127309", "4053650206", "7863664787", "7173414116", "8325337402",
  "4158193084", "9562462257", "2034246413", "7867809732", "3168807445",
  "2244328247", "9728357355", "9082278311", "2408179388", "7864931035",
  "8314442179", "5107765536", "2023404147", "7867100262", "3093175885",
  "9122867042", "8622872260", "3179858837", "7864868974", "3466969080",
  "9015024902", "9015024902", "7275578158", "3126228039", "4016788682",
  "5042153489", "7194598450", "9087724197", "3053845176", "7872084012",
  "6097822844"
];

async function verificarNumerosFaltantes() {
  // Intentar conectar a Atlas primero, luego local
  const uris = [
    process.env.MONGODB_URI,
    'mongodb://localhost:27017'
  ];
  
  let client = null;
  
  for (const uri of uris) {
    if (!uri) continue;
    
    try {
      console.log(`🔗 Intentando conectar a: ${uri.substring(0, 30)}...`);
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        tls: uri.includes('mongodb+srv'),
        tlsAllowInvalidCertificates: true
      });
      await client.connect();
      console.log('✅ Conectado exitosamente\n');
      break;
    } catch (err) {
      console.log(`❌ Falló conexión: ${err.message}`);
      client = null;
    }
  }
  
  if (!client) {
    console.error('❌ No se pudo conectar a ninguna base de datos');
    return;
  }
  
  const dbName = 'crmagente';
  
  try {
    const db = client.db(dbName);
    
    console.log('📋 Verificando', numerosABuscar.length, 'números de teléfono...\n');
    
    // Obtener todas las colecciones costumers*
    const collections = await db.listCollections().toArray();
    const costumersCollections = collections
      .map(c => c.name)
      .filter(name => name.startsWith('costumers'));
    
    console.log(`📁 Buscando en ${costumersCollections.length} colecciones\n`);
    
    // Objeto para rastrear qué números se encontraron
    const numerosEncontrados = new Set();
    const detallesEncontrados = {};
    
    // Buscar cada número en todas las colecciones
    for (const numero of numerosABuscar) {
      for (const collName of costumersCollections) {
        try {
          const collection = db.collection(collName);
          
          // Buscar por diferentes campos de teléfono
          const query = {
            $or: [
              { telefono: numero },
              { telefono_principal: numero },
              { telefono_alterno: numero }
            ]
          };
          
          const found = await collection.findOne(query);
          
          if (found) {
            numerosEncontrados.add(numero);
            if (!detallesEncontrados[numero]) {
              detallesEncontrados[numero] = [];
            }
            detallesEncontrados[numero].push({
              coleccion: collName,
              nombre: found.nombre_cliente || 'Sin nombre',
              agente: found.agente || found.agenteNombre || 'N/A'
            });
          }
        } catch (err) {
          // Ignorar errores de colecciones individuales
        }
      }
    }
    
    // Determinar números faltantes
    const numerosFaltantes = numerosABuscar.filter(num => !numerosEncontrados.has(num));
    
    // Eliminar duplicados de la lista original
    const numerosUnicos = [...new Set(numerosABuscar)];
    const numerosDuplicados = numerosABuscar.filter((num, idx) => numerosABuscar.indexOf(num) !== idx);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 RESULTADOS');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log(`📝 Total de números en la lista: ${numerosABuscar.length}`);
    console.log(`🔢 Números únicos: ${numerosUnicos.length}`);
    if (numerosDuplicados.length > 0) {
      console.log(`⚠️  Números duplicados en la lista: ${numerosDuplicados.length}`);
      console.log(`   Duplicados: ${[...new Set(numerosDuplicados)].join(', ')}`);
    }
    console.log(`✅ Números encontrados en DB: ${numerosEncontrados.size}`);
    console.log(`❌ Números NO encontrados: ${numerosFaltantes.length}\n`);
    
    if (numerosFaltantes.length > 0) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('❌ NÚMEROS NO ENCONTRADOS EN NINGUNA COLECCIÓN:');
      console.log('═══════════════════════════════════════════════════════════\n');
      numerosFaltantes.forEach((num, idx) => {
        console.log(`${idx + 1}. ${num}`);
      });
      console.log('');
    }
    
    if (numerosEncontrados.size > 0) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ NÚMEROS ENCONTRADOS (con detalles):');
      console.log('═══════════════════════════════════════════════════════════\n');
      
      Array.from(numerosEncontrados).forEach((num, idx) => {
        console.log(`${idx + 1}. ${num}`);
        detallesEncontrados[num].forEach(detalle => {
          console.log(`   📁 ${detalle.coleccion}`);
          console.log(`      Cliente: ${detalle.nombre}`);
          console.log(`      Agente: ${detalle.agente}`);
        });
        console.log('');
      });
    }
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Proceso completado');
    console.log('═══════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Conexión cerrada');
  }
}

verificarNumerosFaltantes();
