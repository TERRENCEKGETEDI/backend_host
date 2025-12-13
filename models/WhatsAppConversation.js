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
      'awaiting_menu_choice',
      'reporting_incident_title',
      'reporting_incident_description',
      'reporting_incident_location',
      'reporting_incident_contact_name',
      'reporting_incident_contact_phone',
      'reporting_incident_contact_email',
      'confirming_incident',
      'awaiting_report_id',
      'awaiting_escalation_reason'
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