const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const ActivityLog = sequelize.define('ActivityLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  action: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  table_name: {
    type: DataTypes.STRING(50),
  },
  reference_id: {
    type: DataTypes.UUID,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'activity_logs',
  timestamps: false,
});

module.exports = ActivityLog;