// Script para MongoDB - Copiar y ejecutar en mongosh
// mongosh "mongodb+srv://username:password@cluster.mongodb.net/crmagente"

// Obtener el rango de fechas del mes actual
const now = new Date();
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║  BÚSQUEDA DE PUNTAJE: INGRID.GARCIA - MES ACTUAL              ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log(`\n📅 Período: ${startOfMonth.toISOString().split('T')[0]} al ${endOfMonth.toISOString().split('T')[0]}\n`);

// Función para buscar en una colección específica
function searchInCollection(collectionName) {
  const filter = {
    $or: [
      { agente: { $regex: "INGRID", $options: "i" } },
      { agenteNombre: { $regex: "INGRID", $options: "i" } },
      { nombreAgente: { $regex: "INGRID", $options: "i" } },
      { createdBy: { $regex: "INGRID", $options: "i" } },
      { registeredBy: { $regex: "INGRID", $options: "i" } },
      { vendedor: { $regex: "INGRID", $options: "i" } }
    ]
  };

  try {
    const collection = db.getCollection(collectionName);
    const docs = collection.find(filter).toArray();
    
    if (docs.length > 0) {
      console.log(`✅ ${collectionName}: ${docs.length} registros encontrados`);
      
      // Mostrar detalles
      docs.forEach((doc, idx) => {
        const puntaje = doc.puntaje || doc.score || doc.puntuacion || 0;
        const fecha = doc.dia_venta || doc.diaVenta || doc.fechaCreacion || doc.createdAt || 'SIN FECHA';
        const cliente = doc.nombre_cliente || doc.nombreCliente || doc.nombre || 'SIN NOMBRE';
        console.log(`  ${idx + 1}. ${cliente} - Puntaje: ${puntaje} - Fecha: ${fecha}`);
      });
      
      return docs;
    }
  } catch (err) {
    // Ignorar error si la colección no existe
  }
  
  return [];
}

// Obtener lista de colecciones
const collectionNames = db.getCollectionNames().filter(name => /^costumers/i.test(name));

console.log(`🔍 Buscando en ${collectionNames.length} colecciones...\n`);

let allRecords = [];
let totalPuntaje = 0;

// Buscar en cada colección
collectionNames.forEach(colName => {
  const records = searchInCollection(colName);
  allRecords = allRecords.concat(records);
  
  records.forEach(doc => {
    totalPuntaje += (doc.puntaje || doc.score || doc.puntuacion || 0);
  });
});

// Resumen final
console.log(`\n${'═'.repeat(70)}`);
console.log("📊 RESUMEN PARA INGRID.GARCIA - MES ACTUAL");
console.log(`${'═'.repeat(70)}`);
console.log(`Total de registros: ${allRecords.length}`);
console.log(`Puntaje total: ${totalPuntaje.toFixed(2)}`);
console.log(`Promedio por registro: ${allRecords.length > 0 ? (totalPuntaje / allRecords.length).toFixed(2) : 'N/A'}`);
console.log(`${'═'.repeat(70)}\n`);
