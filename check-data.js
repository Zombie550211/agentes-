const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';

async function checkCurrentMonthData() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('crmagente');
    
    // Obtener rango del mes actual (octubre 2025)
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    console.log('Buscando datos del rango:', startDate, 'a', endDate);
    
    // Verificar datos del mes actual en costumers
    const currentMonthCount = await db.collection('costumers').countDocuments({
      dia_venta: { $gte: startDate, $lte: endDate }
    });
    console.log('Documentos del mes actual en costumers:', currentMonthCount);
    
    // Verificar todos los rangos de fechas disponibles
    const dateRanges = await db.collection('costumers').aggregate([
      { $match: { dia_venta: { $exists: true, $ne: null } } },
      { $group: { 
          _id: null, 
          minDate: { $min: '$dia_venta' }, 
          maxDate: { $max: '$dia_venta' },
          count: { $sum: 1 }
        } }
    ]).toArray();
    
    console.log('Rango de fechas en costumers:', dateRanges);
    
    // Obtener muestra de agentes con puntajes (sin filtro de fecha)
    const agentSample = await db.collection('costumers').aggregate([
      { $match: { 
          agenteNombre: { $exists: true, $ne: null, $ne: '' },
          puntaje: { $exists: true, $ne: null }
        } },
      { $group: {
          _id: '$agenteNombre',
          totalVentas: { $sum: 1 },
          totalPuntaje: { $sum: '$puntaje' },
          avgPuntaje: { $avg: '$puntaje' }
        } },
      { $sort: { totalPuntaje: -1 } },
      { $limit: 10 }
    ]).toArray();
    
    console.log('Top 10 agentes por puntaje total (todos los datos):', agentSample);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

checkCurrentMonthData();
