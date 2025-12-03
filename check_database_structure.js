const { sequelize } = require('./models');

async function checkDatabase() {
  try {
    const [results] = await sequelize.query("PRAGMA table_info(users)");
    console.log('Users table structure:');
    results.forEach(column => {
      console.log(`  ${column.name}: ${column.type}`);
    });
    
    console.log('\nCurrent users in database:');
    const [userResults] = await sequelize.query("SELECT id, name, email, role FROM users LIMIT 5");
    userResults.forEach(user => {
      console.log(`  ${user.name} (${user.email}) - Role: ${user.role}`);
    });
    
  } catch (err) {
    console.error('Error checking database:', err);
  }
}

checkDatabase();