const { sequelize } = require('./models');

async function addStatusColumn() {
  try {
    // Check if status column exists
    const [results] = await sequelize.query("PRAGMA table_info(users)");
    const columnExists = results.some(column => column.name === 'status');
    
    if (columnExists) {
      console.log('Status column already exists');
      return;
    }
    
    // Add status column
    await sequelize.query("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
    console.log('Status column added successfully');
    
    // Update existing users to have 'active' status
    await sequelize.query("UPDATE users SET status = 'active' WHERE status IS NULL");
    console.log('Existing users updated with active status');
    
  } catch (err) {
    console.error('Error adding status column:', err);
  }
}

addStatusColumn();