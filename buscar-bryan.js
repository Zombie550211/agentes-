// Buscar a Bryan Pleitez en todas las colecciones
const db = db.getSiblingDB('agentes-clean');

print('=== BUSCANDO BRYAN PLEITEZ EN TODAS LAS COLECCIONES ===\n');

const collections = db.getCollectionNames();
let totalFound = 0;

collections.forEach(colName => {
  const query = {
    $or: [
      { nombre_cliente: /Bryan.*Pleitez/i },
      { agenteNombre: /Bryan.*Pleitez/i },
      { agente: /Bryan.*Pleitez/i },
      { nombre: /Bryan.*Pleitez/i }
    ]
  };
  
  const count = db[colName].countDocuments(query);
  
  if (count > 0) {
    print(`\n📁 Colección: ${colName}`);
    print(`   Registros encontrados: ${count}`);
    
    // Mostrar los primeros 3 registros
    const docs = db[colName].find(query).limit(3).toArray();
    docs.forEach((doc, idx) => {
      print(`\n   [${idx + 1}] ID: ${doc._id}`);
      print(`       nombre_cliente: ${doc.nombre_cliente || 'N/A'}`);
      print(`       agenteNombre: ${doc.agenteNombre || 'N/A'}`);
      print(`       agente: ${doc.agente || 'N/A'}`);
      print(`       status: ${doc.status || 'N/A'}`);
      print(`       dia_venta: ${doc.dia_venta || 'N/A'}`);
      print(`       createdAt: ${doc.createdAt || 'N/A'}`);
    });
    
    totalFound += count;
  }
});

print(`\n\n=== RESUMEN ===`);
print(`Total de registros encontrados: ${totalFound}`);
print(`Colecciones revisadas: ${collections.length}`);
