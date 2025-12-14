const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const WhatsAppConversation = sequelize.define('WhatsAppConversation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  phone_number: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  state: {
    type: DataTypes.ENUM(
      'idle',
      'main_menu',
      'selecting_incident_type',
      'awaiting_incident_photo',
      'awaiting_location',
      'awaiting_name',
      'confirming_incident',
      'awaiting_progress_id',
      'awaiting_escalation_id',
      'awaiting_escalation_reason',
      'confirming_escalation'
    ),
    defaultValue: 'idle',
  },
  temp_data: {
    type: DataTypes.JSON,
    defaultValue: {},
  },
  last_activity: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
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
  tableName: 'whatsapp_conversations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = WhatsAppConversation;