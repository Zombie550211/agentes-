const { getDb } = require('./config/db');

async function checkUsers() {
  try {
    const db = getDb();
    const users = await db.collection('users').find({ role: 'supervisor' }).toArray();
    console.log('Supervisors found:');
    users.forEach(u => {
      console.log(`- Username: ${u.username}, Name: ${u.name || u.nombre}, Team: ${u.team}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkUsers();
