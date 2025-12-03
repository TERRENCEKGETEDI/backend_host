const { Sequelize } = require('sequelize');
require('dotenv').config();

// Configure PostgreSQL for production, SQLite for fallback
const isPostgresAvailable = process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER;

if (isPostgresAvailable) {
  console.log('Connecting to PostgreSQL database...');
  // Use PostgreSQL
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
  module.exports = sequelize;
} else {
  console.log('PostgreSQL not configured, falling back to SQLite...');
  // Fallback to SQLite
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE || '../database.sqlite',
    logging: false,
  });
  module.exports = sequelize;
}