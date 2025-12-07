const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: sequelize.fn('gen_random_uuid'),
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'info',
  },
  related_type: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  related_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'notifications',
  timestamps: false,
});

module.exports = Notification;