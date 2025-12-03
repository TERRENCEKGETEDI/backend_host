const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const WorkerProgress = sequelize.define('WorkerProgress', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  job_card_id: {
    type: DataTypes.UUID,
    references: {
      model: 'job_cards',
      key: 'id',
    },
  },
  worker_id: {
    type: DataTypes.UUID,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  status: {
    type: DataTypes.ENUM('pending', 'working', 'done'),
    defaultValue: 'pending',
  },
  arrived_at: {
    type: DataTypes.DATE,
  },
  completed_at: {
    type: DataTypes.DATE,
  },
}, {
  tableName: 'worker_progress',
  timestamps: false,
});

module.exports = WorkerProgress;