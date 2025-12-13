const sequelize = require('./db');
const User = require('./User');
const Team = require('./Team');
const TeamMember = require('./TeamMember');
const Incident = require('./Incident');
const JobCard = require('./JobCard');
const WorkerProgress = require('./WorkerProgress');
const ActivityLog = require('./ActivityLog');
const Notification = require('./Notification');
const Message = require('./Message');
const WhatsAppConversation = require('./WhatsAppConversation');

// Associations
User.hasMany(Team, { foreignKey: 'manager_id' });
Team.belongsTo(User, { foreignKey: 'manager_id', as: 'manager' });

Team.hasMany(TeamMember, { foreignKey: 'team_id' });
TeamMember.belongsTo(Team, { foreignKey: 'team_id' });

User.hasMany(TeamMember, { foreignKey: 'user_id' });
TeamMember.belongsTo(User, { foreignKey: 'user_id' });

Incident.hasOne(JobCard, { foreignKey: 'incident_id' });
JobCard.belongsTo(Incident, { foreignKey: 'incident_id' });

Team.hasMany(Incident, { foreignKey: 'assigned_team_id' });
Incident.belongsTo(Team, { foreignKey: 'assigned_team_id', as: 'assignedTeam' });

Team.hasMany(JobCard, { foreignKey: 'team_id' });
JobCard.belongsTo(Team, { foreignKey: 'team_id' });

User.hasMany(JobCard, { foreignKey: 'team_leader_id', as: 'ledJobs' });
JobCard.belongsTo(User, { foreignKey: 'team_leader_id', as: 'teamLeader' });

JobCard.hasMany(WorkerProgress, { foreignKey: 'job_card_id' });
WorkerProgress.belongsTo(JobCard, { foreignKey: 'job_card_id' });

User.hasMany(WorkerProgress, { foreignKey: 'worker_id' });
WorkerProgress.belongsTo(User, { foreignKey: 'worker_id' });

User.hasMany(ActivityLog, { foreignKey: 'user_id' });
ActivityLog.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Notification, { foreignKey: 'user_id' });
Notification.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Message, { foreignKey: 'sender_id', as: 'sentMessages' });
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

User.hasMany(Message, { foreignKey: 'receiver_id', as: 'receivedMessages' });
Message.belongsTo(User, { foreignKey: 'receiver_id', as: 'receiver' });

module.exports = {
  sequelize,
  User,
  Team,
  TeamMember,
  Incident,
  JobCard,
  WorkerProgress,
  ActivityLog,
  Notification,
  Message,
  WhatsAppConversation,
};
