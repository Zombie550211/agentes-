require('dotenv').config();
const { connectToMongoDB, getDb } = require('./config/db');

async function getIngridPuntaje() {
  try {
    await connectToMongoDB();
    const db = getDb();
    
    if (!db) {
      console.error('❌ No se pudo conectar a la BD');
      process.exit(1);
    }

    const currentDate = new Date();
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    console.log(`\n📊 Buscando puntaje de INGRID.GARCIA del mes ${monthStr}\n`);

    // Filtro para buscar
    const filter = {
      $or: [
        { agente: { $regex: 'INGRID', $options: 'i' } },
        { agenteNombre: { $regex: 'INGRID', $options: 'i' } },
        { nombreAgente: { $regex: 'INGRID', $options: 'i' } },
        { createdBy: { $regex: 'INGRID', $options: 'i' } },
        { vendedor: { $regex: 'INGRID', $options: 'i' } }
      ]
    };

    // Buscar en todas las colecciones
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name).filter(name => /^costumers/i.test(name));

    let totalRecords = 0;
    let totalPuntaje = 0;
    let records = [];

    console.log(`Buscando en ${collectionNames.length} colecciones...\n`);

    for (const colName of collectionNames) {
      try {
        const docs = await db.collection(colName)
          .find(filter)
          .project({ 
            agente: 1, 
            agenteNombre: 1, 
            nombreAgente: 1, 
            puntaje: 1, 
            score: 1,
            puntuacion: 1,
            dia_venta: 1,
            diaVenta: 1,
            fecha_creacion: 1,
            fechaCreacion: 1,
            createdAt: 1,
            nombre_cliente: 1,
            nombreCliente: 1
          })
          .toArray();
        
        if (docs.length > 0) {
          console.log(`✅ ${colName}: ${docs.length} registros`);
          
          docs.forEach(doc => {
            const puntaje = doc.puntaje || doc.score || doc.puntuacion || 0;
            const agentName = doc.agente || doc.agenteNombre || doc.nombreAgente || 'DESCONOCIDO';
            const fecha = doc.dia_venta || doc.diaVenta || doc.fecha_creacion || doc.fechaCreacion || doc.createdAt || 'SIN FECHA';
            const clientName = doc.nombre_cliente || doc.nombreCliente || 'SIN NOMBRE';
            
            records.push({
              coleccion: colName,
              cliente: clientName,
              fecha: fecha,
              puntaje: puntaje
            });
            
            totalPuntaje += (puntaje || 0);
            totalRecords++;
          });
        }
      } catch (err) {
        // Ignorar errores de colecciones específicas
      }
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📈 RESUMEN PARA INGRID.GARCIA - MES ACTUAL (${monthStr})`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`Total de registros: ${totalRecords}`);
    console.log(`Puntaje total: ${totalPuntaje.toFixed(2)}`);
    console.log(`Puntaje promedio: ${totalRecords > 0 ? (totalPuntaje / totalRecords).toFixed(2) : 'N/A'}`);
    console.log(`${'─'.repeat(80)}\n`);

    if (records.length > 0) {
      console.log('Detalle de registros:\n');
      records.forEach((rec, idx) => {
        console.log(`${idx + 1}. Cliente: ${rec.cliente}`);
        console.log(`   Fecha: ${rec.fecha}`);
        console.log(`   Puntaje: ${rec.puntaje}`);
        console.log(`   Colección: ${rec.coleccion}`);
        console.log('');
      });
    } else {
      console.log('❌ No se encontraron registros para INGRID.GARCIA en el mes actual');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getIngridPuntaje();
