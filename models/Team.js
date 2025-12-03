const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const Team = sequelize.define('Team', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  manager_id: {
    type: DataTypes.UUID,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  is_available: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Real-time availability flag controlled by team leader'
  },
  current_capacity: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Current number of active incidents assigned to this team'
  },
  max_capacity: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
    comment: 'Maximum number of incidents this team can handle simultaneously'
  },
  priority_level: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: 'Priority level for assignment (1=low, 5=high)'
  },
  last_activity: {
    type: DataTypes.DATE,
    comment: 'Timestamp of last team activity/update'
  },
  available_from: {
    type: DataTypes.DATE,
    comment: 'When team will be available again (for temporary unavailability)'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'teams',
  timestamps: false,
});

module.exports = Team;