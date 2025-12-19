// Script para MongoDB Shell (mongosh)
// Ejecutar: mongosh "tu-connection-string" < verificar-numeros-mongosh.js
// O copiar y pegar en mongosh después de conectar

use crmagente

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

print('\n📋 Verificando ' + numerosABuscar.length + ' números de teléfono...\n');

const collections = db.getCollectionNames().filter(name => name.startsWith('costumers'));
print('📁 Buscando en ' + collections.length + ' colecciones\n');

const numerosEncontrados = new Set();
const detallesEncontrados = {};

// Buscar cada número
numerosABuscar.forEach(numero => {
  collections.forEach(collName => {
    const query = {
      $or: [
        { telefono: numero },
        { telefono_principal: numero },
        { telefono_alterno: numero }
      ]
    };
    
    const found = db[collName].findOne(query);
    
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
  });
});

// Números faltantes
const numerosFaltantes = numerosABuscar.filter(num => !numerosEncontrados.has(num));

// Números únicos y duplicados
const numerosUnicos = [...new Set(numerosABuscar)];
const numerosDuplicados = numerosABuscar.filter((num, idx) => numerosABuscar.indexOf(num) !== idx);

print('\n═══════════════════════════════════════════════════════════');
print('📊 RESULTADOS');
print('═══════════════════════════════════════════════════════════\n');

print('📝 Total de números en la lista: ' + numerosABuscar.length);
print('🔢 Números únicos: ' + numerosUnicos.length);
if (numerosDuplicados.length > 0) {
  print('⚠️  Números duplicados en la lista: ' + numerosDuplicados.length);
  print('   Duplicados: ' + [...new Set(numerosDuplicados)].join(', '));
}
print('✅ Números encontrados en DB: ' + numerosEncontrados.size);
print('❌ Números NO encontrados: ' + numerosFaltantes.length + '\n');

if (numerosFaltantes.length > 0) {
  print('═══════════════════════════════════════════════════════════');
  print('❌ NÚMEROS NO ENCONTRADOS EN NINGUNA COLECCIÓN:');
  print('═══════════════════════════════════════════════════════════\n');
  numerosFaltantes.forEach((num, idx) => {
    print((idx + 1) + '. ' + num);
  });
  print('');
}

if (numerosEncontrados.size > 0) {
  print('═══════════════════════════════════════════════════════════');
  print('✅ NÚMEROS ENCONTRADOS (con detalles):');
  print('═══════════════════════════════════════════════════════════\n');
  
  Array.from(numerosEncontrados).forEach((num, idx) => {
    print((idx + 1) + '. ' + num);
    detallesEncontrados[num].forEach(detalle => {
      print('   📁 ' + detalle.coleccion);
      print('      Cliente: ' + detalle.nombre);
      print('      Agente: ' + detalle.agente);
    });
    print('');
  });
}

print('═══════════════════════════════════════════════════════════');
print('✅ Proceso completado');
print('═══════════════════════════════════════════════════════════\n');
