const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const JobCard = sequelize.define('JobCard', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  incident_id: {
    type: DataTypes.UUID,
    references: {
      model: 'incidents',
      key: 'id',
    },
  },
  team_id: {
    type: DataTypes.UUID,
    references: {
      model: 'teams',
      key: 'id',
    },
  },
  team_leader_id: {
    type: DataTypes.UUID,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  status: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'completed'),
    defaultValue: 'not_started',
  },
  assigned_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  started_at: {
    type: DataTypes.DATE,
  },
  completed_at: {
    type: DataTypes.DATE,
  },
}, {
  tableName: 'job_cards',
  timestamps: false,
});

module.exports = JobCard;