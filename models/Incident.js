const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const Incident = sequelize.define('Incident', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
  },
  location: {
    type: DataTypes.STRING(500),
  },
  contact_name: {
    type: DataTypes.STRING(200),
  },
  contact_phone: {
    type: DataTypes.STRING(50),
  },
  contact_email: {
    type: DataTypes.STRING(200),
  },
  latitude: {
    type: DataTypes.DOUBLE,
  },
  longitude: {
    type: DataTypes.DOUBLE,
  },
  images: {
    type: DataTypes.STRING(1000), // comma separated
  },
  tracking_id: {
    type: DataTypes.STRING(50),
    unique: true,
  },
  status: {
    type: DataTypes.ENUM('Not Started', 'In Progress', 'Completed', 'Cancelled', 'verified', 'escalated'),
    defaultValue: 'Not Started',
  },
  assigned_team_id: {
    type: DataTypes.UUID,
    references: {
      model: 'teams',
      key: 'id'
    }
  },
  assigned_at: {
    type: DataTypes.DATE,
  },
  category_reasoning: {
    type: DataTypes.TEXT,
    comment: 'Reasoning for automatic categorization'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'incidents',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Incident;