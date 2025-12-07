const express = require('express');
const { Op } = require('sequelize');
const { Message, User, TeamMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// All routes require authentication
router.use(authenticateToken);

// Helper function to get visible users for a given user
async function getVisibleUsers(userId, userRole) {
  const user = await User.findByPk(userId);
  if (!user) return [];

  let visibleUsers = [];

  if (userRole === 'admin') {
    // Admin can see all users
    visibleUsers = await User.findAll({
      where: { id: { [Op.ne]: userId } },
      attributes: ['id', 'name', 'email', 'role']
    });
  } else if (userRole === 'manager') {
    // Manager can see all team leaders, all teams (workers and team leaders), and all admins
    const teamLeaders = await User.findAll({
      where: { role: 'team_leader' },
      attributes: ['id', 'name', 'email', 'role']
    });
    const workers = await User.findAll({
      where: { role: 'worker' },
      attributes: ['id', 'name', 'email', 'role']
    });
    const admins = await User.findAll({
      where: { role: 'admin' },
      attributes: ['id', 'name', 'email', 'role']
    });
    visibleUsers = [...teamLeaders, ...workers, ...admins];
  } else if (userRole === 'team_leader') {
    // Team leader can see workers in their group and all managers
    const teamMembers = await TeamMember.findAll({
      where: { user_id: userId },
      include: [{
        model: require('../models/Team'),
        include: [{
          model: TeamMember,
          include: [{ model: User, where: { role: 'worker' }, attributes: ['id', 'name', 'email', 'role'] }]
        }]
      }]
    });

    const workersInTeam = teamMembers.flatMap(tm => tm.Team?.TeamMembers?.map(member => member.User) || []).filter(Boolean);

    const managers = await User.findAll({
      where: { role: 'manager' },
      attributes: ['id', 'name', 'email', 'role']
    });

    visibleUsers = [...workersInTeam, ...managers];
  } else if (userRole === 'worker') {
    // Worker can see users in their own group and their team leader
    const teamMembers = await TeamMember.findAll({
      where: { user_id: userId },
      include: [{
        model: require('../models/Team'),
        include: [{
          model: TeamMember,
          include: [{ model: User, attributes: ['id', 'name', 'email', 'role'] }]
        }]
      }]
    });

    visibleUsers = teamMembers.flatMap(tm => tm.Team?.TeamMembers?.map(member => member.User) || []).filter(Boolean);
  }

  // Remove duplicates and exclude self
  const uniqueUsers = visibleUsers.filter((u, index, self) =>
    index === self.findIndex(v => v.id === u.id) && u.id !== userId
  );

  return uniqueUsers;
}

// Get messages for the current user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get visible users
    const visibleUserIds = (await getVisibleUsers(userId, userRole)).map(u => u.id);

    // Get messages where user is sender or receiver, or broadcast to their role, or in channels they can access
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { sender_id: userId },
          { receiver_id: userId },
          {
            receiver_id: null,
            target_role: userRole
          },
          {
            receiver_id: null,
            channel: {
              [Op.in]: await getAccessibleChannels(userId, userRole)
            }
          }
        ]
      },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'role'] },
        { model: User, as: 'receiver', attributes: ['id', 'name', 'role'] }
      ],
      order: [['created_at', 'DESC']],
      limit: 100
    });

    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get visible recipients for the current user
router.get('/recipients', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const visibleUsers = await getVisibleUsers(userId, userRole);

    res.json(visibleUsers);
  } catch (err) {
    console.error('Error fetching recipients:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a message
router.post('/', upload.single('attachment'), async (req, res) => {
  try {
    const { receiver_id, target_role, channel, content } = req.body;
    const sender_id = req.user.id;
    const userRole = req.user.role;

    // Validate that the sender can message the recipient
    if (receiver_id) {
      const visibleUsers = await getVisibleUsers(sender_id, userRole);
      const canMessage = visibleUsers.some(u => u.id === receiver_id);
      if (!canMessage) {
        return res.status(403).json({ error: 'Cannot send message to this user' });
      }
    }

    // For broadcasts, validate role
    if (target_role && !['worker', 'team_leader', 'manager', 'admin'].includes(target_role)) {
      return res.status(400).json({ error: 'Invalid target role' });
    }

    // For channels, validate access
    if (channel) {
      const accessibleChannels = await getAccessibleChannels(sender_id, userRole);
      if (!accessibleChannels.includes(channel)) {
        return res.status(403).json({ error: 'Cannot send message to this channel' });
      }
    }

    let attachment_url = null;
    if (req.file) {
      attachment_url = `/uploads/${req.file.filename}`;
    }

    const message = await Message.create({
      sender_id,
      receiver_id: receiver_id || null,
      target_role: target_role || null,
      channel: channel || null,
      content,
      attachment_url
    });

    // Return the created message with sender info
    const messageWithSender = await Message.findByPk(message.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'role'] }]
    });

    res.status(201).json(messageWithSender);
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark message as read
router.put('/:id/read', async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user.id;

    const message = await Message.findByPk(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user can read this message
    if (message.receiver_id !== userId && message.sender_id !== userId) {
      return res.status(403).json({ error: 'Cannot access this message' });
    }

    await message.update({ is_read: true });

    res.json({ message: 'Message marked as read' });
  } catch (err) {
    console.error('Error marking message as read:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get accessible channels for a user
async function getAccessibleChannels(userId, userRole) {
  const channels = [];
  const { Team } = require('../models');

  if (userRole === 'admin' || userRole === 'manager') {
    // Can access all channels
    const allTeams = await Team.findAll({ attributes: ['name'] });
    channels.push(...allTeams.map(t => `team_${t.name.toLowerCase().replace(/\s+/g, '_')}`));
    channels.push('incident_general', 'jobcard_general');
  } else {
    // Get user's teams
    const teamMembers = await TeamMember.findAll({
      where: { user_id: userId },
      include: [{ model: Team, attributes: ['name'] }]
    });

    channels.push(...teamMembers.map(tm => `team_${tm.Team.name.toLowerCase().replace(/\s+/g, '_')}`));
  }

  return channels;
}

module.exports = router;