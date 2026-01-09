const { getDb } = require('./config/db');

async function createTestSupervisor() {
  try {
    const db = getDb();
    if (!db) {
      console.log('No database connection');
      return;
    }
    
    // Check if supervisor already exists
    const existing = await db.collection('users').findOne({ username: 'testsup' });
    if (existing) {
      console.log('Test supervisor already exists');
      console.log('Password: 12345');
      return;
    }
    
    // Create test supervisor
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('12345', 10);
    
    const result = await db.collection('users').insertOne({
      username: 'testsup',
      password: hashedPassword,
      name: 'Test Supervisor',
      role: 'supervisor',
      team: 'TEST_TEAM',
      createdAt: new Date(),
      isActive: true
    });
    
    console.log('Test supervisor created successfully');
    console.log('Username: testsup');
    console.log('Password: 12345');
    console.log('ID:', result.insertedId);
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

createTestSupervisor();
