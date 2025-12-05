require('dotenv').config();
const { Sequelize } = require('sequelize');

let sequelize;

if (process.env.DB_STORAGE) {
  console.log("Connecting to SQLite database...");
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE,
    logging: false,
  });
} else {
  console.log("Connecting to PostgreSQL database...");
  sequelize = new Sequelize(
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
}

module.exports = sequelize;
