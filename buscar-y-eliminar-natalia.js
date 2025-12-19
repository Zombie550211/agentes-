// Script para buscar y eliminar el lead de NATALIA APONTE RODRIGUEZ
// Ejecutar en MongoDB Shell (mongosh)

use crmagente

print('\n🔍 Buscando lead de NATALIA APONTE RODRIGUEZ...\n');

// Buscar en todas las colecciones costumers*
const collections = db.getCollectionNames().filter(name => name.startsWith('costumers'));
print(`📁 Revisando ${collections.length} colecciones\n`);

let totalFound = 0;
let totalDeleted = 0;

collections.forEach(collName => {
  // Buscar con criterios más flexibles
  const query = {
    $or: [
      { nombre_cliente: /NATALIA.*APONTE/i },
      { telefono: "6896128" },
      { telefono_principal: "6896128" }
    ]
  };
  
  const found = db[collName].find(query).toArray();
  
  if (found.length > 0) {
    print(`\n✅ Encontrado en ${collName}: ${found.length} documento(s)`);
    totalFound += found.length;
    
    found.forEach((doc, idx) => {
      print(`\n  📄 Documento ${idx + 1}:`);
      print(`     _id: ${doc._id}`);
      print(`     nombre: ${doc.nombre_cliente}`);
      print(`     telefono: ${doc.telefono || doc.telefono_principal}`);
      print(`     agente: ${doc.agente || 'N/A'}`);
      print(`     agenteNombre: ${doc.agenteNombre || 'N/A'}`);
      print(`     asignadoPor: ${doc.asignadoPor || 'N/A'}`);
      print(`     creadoEn: ${doc.creadoEn}`);
    });
    
    // Eliminar los documentos encontrados
    const result = db[collName].deleteMany(query);
    print(`\n  🗑️  Eliminados: ${result.deletedCount} documento(s) de ${collName}`);
    totalDeleted += result.deletedCount;
  }
});

print(`\n\n📊 RESUMEN:`);
print(`   Total encontrados: ${totalFound}`);
print(`   Total eliminados: ${totalDeleted}`);
print('\n✅ Proceso completado\n');
