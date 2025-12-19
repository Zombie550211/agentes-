// Script para buscar a Bryan Pleitez en TODAS las colecciones de agentes-clean
const dbName = 'agentes-clean';
const db = db.getSiblingDB(dbName);

print('=== BUSCANDO BRYAN PLEITEZ EN TODAS LAS COLECCIONES ===\n');

// Obtener todas las colecciones
const allCollections = db.getCollectionNames();
print(`Total de colecciones en ${dbName}: ${allCollections.length}\n`);

let totalFound = 0;
const foundIn = [];

// Buscar en cada colección
allCollections.forEach(colName => {
  try {
    const query = {
      $or: [
        { nombre_cliente: /Bryan.*Pleitez/i },
        { agenteNombre: /Bryan.*Pleitez/i },
        { agente: /Bryan.*Pleitez/i },
        { nombre: /Bryan.*Pleitez/i },
        { supervisor: /Bryan.*Pleitez/i }
      ]
    };
    
    const count = db[colName].countDocuments(query);
    
    if (count > 0) {
      print(`\n📁 ENCONTRADO EN: ${colName}`);
      print(`   Registros: ${count}`);
      foundIn.push({ collection: colName, count: count });
      
      // Mostrar primeros 3 registros con más detalles
      const docs = db[colName].find(query).limit(3).toArray();
      docs.forEach((doc, idx) => {
        print(`\n   [${idx + 1}] _id: ${doc._id}`);
        print(`       nombre_cliente: ${doc.nombre_cliente || 'N/A'}`);
        print(`       agenteNombre: ${doc.agenteNombre || 'N/A'}`);
        print(`       agente: ${doc.agente || 'N/A'}`);
        print(`       supervisor: ${doc.supervisor || 'N/A'}`);
        print(`       status: ${doc.status || 'N/A'}`);
        print(`       dia_venta: ${doc.dia_venta || 'N/A'}`);
        print(`       createdAt: ${doc.createdAt || 'N/A'}`);
        print(`       servicios: ${doc.servicios || doc.servicios_texto || 'N/A'}`);
      });
      
      totalFound += count;
    }
  } catch (err) {
    print(`   ⚠️  Error en colección ${colName}: ${err.message}`);
  }
});

print('\n\n=== RESUMEN FINAL ===');
print(`Total de registros encontrados: ${totalFound}`);
print(`Colecciones con resultados: ${foundIn.length}`);
if (foundIn.length > 0) {
  print('\nDesglose por colección:');
  foundIn.forEach(item => {
    print(`  - ${item.collection}: ${item.count} registros`);
  });
}

// Buscar también en TEAM_LINEAS si existe
print('\n\n=== BUSCANDO EN BASE DE DATOS TEAM_LINEAS ===');
try {
  const dbTL = db.getSiblingDB('TEAM_LINEAS');
  const tlCollections = dbTL.getCollectionNames();
  print(`Colecciones en TEAM_LINEAS: ${tlCollections.length}`);
  
  let tlFound = 0;
  tlCollections.forEach(colName => {
    try {
      const query = {
        $or: [
          { nombre_cliente: /Bryan.*Pleitez/i },
          { agenteNombre: /Bryan.*Pleitez/i },
          { agente: /Bryan.*Pleitez/i }
        ]
      };
      const count = dbTL[colName].countDocuments(query);
      if (count > 0) {
        print(`\n📁 TEAM_LINEAS/${colName}: ${count} registros`);
        tlFound += count;
      }
    } catch (err) {
      print(`   Error en TEAM_LINEAS/${colName}: ${err.message}`);
    }
  });
  
  if (tlFound > 0) {
    print(`\nTotal en TEAM_LINEAS: ${tlFound} registros`);
  } else {
    print('\nNo se encontraron registros en TEAM_LINEAS');
  }
} catch (err) {
  print(`Error accediendo a TEAM_LINEAS: ${err.message}`);
}
