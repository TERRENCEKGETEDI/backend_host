require('dotenv').config();
const { Sequelize } = require('sequelize');

console.log("Connecting to PostgreSQL database...");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,       // <-- IMPORTANT
        rejectUnauthorized: false // <-- IMPORTANT (Render uses self-signed certs)
      }
    }
  }
);

module.exports = sequelize;
