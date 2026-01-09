const { connectToMongoDB } = require('./config/db');

async function testConnection() {
  try {
    const db = await connectToMongoDB();
    if (!db) {
      console.log('Failed to connect to MongoDB');
      return;
    }
    
    console.log('Connected to MongoDB successfully');
    
    // List collections
    const collections = await db.listCollections().toArray();
    console.log('\nCollections:');
    collections.forEach(c => console.log(`- ${c.name}`));
    
    // Check users collection
    if (collections.find(c => c.name === 'users')) {
      const users = await db.collection('users').find({ role: 'supervisor' }).toArray();
      console.log('\nSupervisors found:');
      users.forEach(u => {
        console.log(`- Username: ${u.username}, Name: ${u.name || u.nombre}, Team: ${u.team}`);
      });
    }
    
    // Check costumers collection for today's date
    const today = new Date().toISOString().split('T')[0];
    console.log(`\nChecking for sales on ${today}:`);
    
    const collectionsList = await db.listCollections().toArray();
    const costumersCollections = collectionsList.filter(c => /^costumers(_|$)/i.test(c.name));
    
    let totalSales = 0;
    for (const colName of costumersCollections) {
      const count = await db.collection(colName).countDocuments({
        dia_venta: today
      });
      if (count > 0) {
        console.log(`- ${colName}: ${count} sales`);
        totalSales += count;
      }
    }
    
    if (totalSales === 0) {
      console.log('No sales found for today in any costumers collection');
      
      // Check for any sales in January 2026
      console.log('\nChecking for sales in January 2026:');
      for (const colName of costumersCollections.slice(0, 5)) { // Check first 5 collections
        const count = await db.collection(colName).countDocuments({
          dia_venta: { $regex: /^2026-01/ }
        });
        if (count > 0) {
          console.log(`- ${colName}: ${count} sales in Jan 2026`);
          
          // Get a sample
          const sample = await db.collection(colName).findOne({
            dia_venta: { $regex: /^2026-01/ }
          });
          if (sample) {
            console.log(`  Sample dia_venta: ${sample.dia_venta}`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

testConnection();
