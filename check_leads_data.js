const mongoose = require('mongoose');
const Lead = require('./backend/models/Lead');

(async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/dashboard-app');
    
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const total = await Lead.countDocuments({
      $or: [
        { dia_venta: { $gte: thisMonth } },
        { fecha_contratacion: { $gte: thisMonth } },
        { creadoEn: { $gte: thisMonth } },
        { createdAt: { $gte: thisMonth } },
        { fecha: { $gte: thisMonth } }
      ]
    });
    
    const withAgent = await Lead.countDocuments({
      agenteNombre: { $exists: true, $ne: null, $ne: '' }
    });
    
    const withService = await Lead.countDocuments({
      servicios: { $exists: true, $ne: null, $ne: [] }
    });
    
    console.log(`Total leads mes: ${total}`);
    console.log(`Con agenteNombre: ${withAgent}`);
    console.log(`Con servicios: ${withService}`);
    
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
