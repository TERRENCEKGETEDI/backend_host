const { Sequelize } = require('sequelize');
require('dotenv').config();

async function testPostgreSQLConnection() {
  console.log('Testing PostgreSQL connection...');
  console.log('Database Config:');
  console.log(`Host: ${process.env.DB_HOST}`);
  console.log(`Port: ${process.env.DB_PORT}`);
  console.log(`Database: ${process.env.DB_NAME}`);
  console.log(`User: ${process.env.DB_USER}`);
  console.log(`Password: ${process.env.DB_PASSWORD ? '***' : 'NOT SET'}`);
  
  try {
    // Test connection
    const sequelize = new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: console.log,
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000
        }
      }
    );

    await sequelize.authenticate();
    console.log('✅ PostgreSQL connection established successfully!');
    
    // Test database existence
    const [results] = await sequelize.query('SELECT current_database() as db_name, version() as pg_version');
    console.log(`✅ Connected to database: ${results[0].db_name}`);
    console.log(`✅ PostgreSQL version: ${results[0].pg_version}`);
    
    await sequelize.close();
    console.log('✅ Connection closed successfully');
    
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:');
    console.error(error.message);
    if (error.message.includes('ECONNREFUSED')) {
      console.error('💡 Make sure PostgreSQL is running on the specified host and port');
    }
    if (error.message.includes('authentication')) {
      console.error('💡 Check your database credentials in .env file');
    }
    if (error.message.includes('database') && error.message.includes('does not exist')) {
      console.error('💡 Database does not exist. Run the create-database.sql script first.');
    }
    return false;
  }
}

testPostgreSQLConnection();