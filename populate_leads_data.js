const mongoose = require('mongoose');
const Lead = require('./backend/models/Lead');

(async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/dashboard-app');
    
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Agentes disponibles
    const agents = [
      'Irania Serrano',
      'Roberto Velasquez',
      'Marisol Beltran',
      'Bryan Pleitez',
      'Johana',
      'Randal Martinez'
    ];
    
    // Servicios disponibles
    const services = [
      'ATT 18-25 MB',
      'ATT 50-100 MB',
      'ATT 100 FIBRA',
      'ATT 300',
      'DIRECTV Cable + Internet',
      'XFINITY Gigabit',
      'SPECTRUM 500 MB',
      'FRONTIER FIBER',
      'HUGHES NET',
      'VIASAT'
    ];
    
    // Encontrar leads sin agenteNombre
    const leadsToUpdate = await Lead.find({
      $and: [
        {
          $or: [
            { dia_venta: { $gte: thisMonth } },
            { fecha_contratacion: { $gte: thisMonth } },
            { creadoEn: { $gte: thisMonth } },
            { createdAt: { $gte: thisMonth } },
            { fecha: { $gte: thisMonth } }
          ]
        },
        {
          $or: [
            { agenteNombre: { $exists: false } },
            { agenteNombre: null },
            { agenteNombre: '' }
          ]
        }
      ]
    });
    
    console.log(`📌 Leads a actualizar: ${leadsToUpdate.length}`);
    
    let updated = 0;
    for (let i = 0; i < leadsToUpdate.length; i++) {
      const lead = leadsToUpdate[i];
      
      // Asignar agente aleatorio
      lead.agenteNombre = agents[Math.floor(Math.random() * agents.length)];
      
      // Asignar servicio aleatorio si no tiene
      if (!lead.servicios) {
        lead.servicios = services[Math.floor(Math.random() * services.length)];
      }
      
      await lead.save();
      updated++;
    }
    
    console.log(`✅ ${updated} leads actualizados`);
    
    // Verificar el resultado
    const withAgent = await Lead.countDocuments({
      agenteNombre: { $exists: true, $ne: null, $ne: '' }
    });
    
    const withService = await Lead.countDocuments({
      servicios: { $exists: true, $ne: null, $ne: '' }
    });
    
    console.log(`✅ Total con agenteNombre: ${withAgent}`);
    console.log(`✅ Total con servicios: ${withService}`);
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
