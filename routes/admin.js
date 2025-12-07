const express = require('express');
const bcrypt = require('bcryptjs');
const { Op, DataTypes } = require('sequelize');
const sequelize = require('../models/db');
const { User, ActivityLog } = require('../models');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');



const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken, authorizeRoles('admin'));

// Create new user
router.post('/users', async (req, res) => {
  const { name, email, password, phone, role, status = 'active' } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, phone, role, status });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Created user ${user.name} with role ${role} and status ${status}`,
      table_name: 'users',
      reference_id: user.id,
    });

    // Send notification to all admins about new user creation (Admin: new user account created)
    global.sendRoleNotification('admin', 'user-created', {
      type: 'info',
      title: 'New User Account Created',
      message: `A new ${role} account has been created for ${user.name} (${user.email})`,
      related_type: 'user',
      related_id: user.id
    });

    res.status(201).json({ message: 'User created', user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
router.get('/users', async (req, res) => {
  console.log('Admin users endpoint called');
  try {
    const users = await User.findAll({ attributes: { exclude: ['password'] } });
    console.log('Returning', users.length, 'users');
    res.json(users);
  } catch (err) {
    console.log('Error fetching users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Block/Unblock user (convenience endpoint) - must come before general update route
router.put('/users/:id/block', async (req, res) => {
  const { blocked } = req.body; // true to block, false to unblock
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newStatus = blocked ? 'blocked' : 'active';
    const oldStatus = user.status;
    
    await user.update({ status: newStatus });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `${blocked ? 'Blocked' : 'Unblocked'} user ${user.name}`,
      table_name: 'users',
      reference_id: user.id,
    });

    // Send notification to the affected user (All users: general messages)
    global.sendNotification(user.id, 'status-update', {
      type: 'warning',
      title: 'Account Status Change',
      message: `Your account has been ${blocked ? 'blocked' : 'unblocked'} by an administrator`,
      related_type: 'user',
      related_id: user.id
    });

    // Send notification to all admins about the action (Admin: blocked accounts)
    global.sendRoleNotification('admin', 'status-update', {
      type: 'alert',
      title: 'User Account Action',
      message: `User ${user.name} has been ${blocked ? 'blocked' : 'unblocked'}`,
      related_type: 'user',
      related_id: user.id
    });

    res.json({ message: `User ${blocked ? 'blocked' : 'unblocked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (including role and status changes)
router.put('/users/:id', async (req, res) => {
  const { name, email, phone, role, status } = req.body;
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const oldRole = user.role;
    const oldStatus = user.status;
    
    await user.update({ name, email, phone, role, status });

    // Log role change
    if (oldRole !== role) {
      await ActivityLog.create({
        user_id: req.user.id,
        action: `Changed role of user ${user.name} from ${oldRole} to ${role}`,
        table_name: 'users',
        reference_id: user.id,
      });
    }

    // Log status change
    if (oldStatus !== status) {
      await ActivityLog.create({
        user_id: req.user.id,
        action: `Changed status of user ${user.name} from ${oldStatus} to ${status}`,
        table_name: 'users',
        reference_id: user.id,
      });
    }

    // Log general update if no specific changes
    if (oldRole === role && oldStatus === status) {
      await ActivityLog.create({
        user_id: req.user.id,
        action: `Updated user ${user.name}`,
        table_name: 'users',
        reference_id: user.id,
      });
    }

    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password
router.put('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Reset password for user ${user.name}`,
      table_name: 'users',
      reference_id: user.id,
    });

    res.json({ message: 'Password reset' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await user.destroy();

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Deleted user ${user.name}`,
      table_name: 'users',
      reference_id: user.id,
    });

    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get system stats
router.get('/stats', async (req, res) => {
  console.log('Admin stats endpoint called');
  try {
    const totalUsers = await User.count();
    const usersByRole = await User.findAll({
      attributes: ['role', [User.sequelize.fn('COUNT', User.sequelize.col('role')), 'count']],
      group: ['role'],
    });

    const totalActivityLogs = await ActivityLog.count();

    console.log('Stats:', { totalUsers, totalActivityLogs });
    res.json({
      totalUsers,
      usersByRole,
      totalActivityLogs,
    });
  } catch (err) {
    console.log('Error fetching stats:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get enhanced stats with time-based analytics
router.get('/stats/enhanced', async (req, res) => {
  const { period = 'monthly', startDate, endDate } = req.query;

  try {
    // Calculate date ranges for current and previous periods
    let currentPeriodStart, currentPeriodEnd, previousPeriodStart, previousPeriodEnd;
    
    if (startDate && endDate) {
      currentPeriodStart = new Date(startDate);
      currentPeriodEnd = new Date(endDate);
      
      // Calculate previous period
      const periodLength = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
      previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
      previousPeriodStart = new Date(previousPeriodEnd.getTime() - periodLength);
    } else {
      // Default to current month/week vs previous month/week
      const now = new Date();
      
      if (period === 'monthly') {
        // Current month
        currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        currentPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        
        // Previous month
        previousPeriodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        previousPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      } else { // weekly
        // Current week (Monday to Sunday)
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - dayOfWeek + 1);
        currentPeriodStart = new Date(monday.setHours(0, 0, 0, 0));
        currentPeriodEnd = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
        currentPeriodEnd.setHours(23, 59, 59, 999);
        
        // Previous week
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
        previousPeriodStart = new Date(previousPeriodEnd.getTime() - 6 * 24 * 60 * 60 * 1000);
      }
    }

    // Current period data for users
    const currentUserTimeSeries = await User.findAll({
      attributes: [
        [User.sequelize.fn('DATE', User.sequelize.col('created_at')), 'date'],
        [User.sequelize.fn('COUNT', User.sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.between]: [currentPeriodStart, currentPeriodEnd]
        }
      },
      group: [User.sequelize.fn('DATE', User.sequelize.col('created_at'))],
      order: [[User.sequelize.fn('DATE', User.sequelize.col('created_at')), 'ASC']]
    });

    // Previous period data for users
    const previousUserTimeSeries = await User.findAll({
      attributes: [
        [User.sequelize.fn('DATE', User.sequelize.col('created_at')), 'date'],
        [User.sequelize.fn('COUNT', User.sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.between]: [previousPeriodStart, previousPeriodEnd]
        }
      },
      group: [User.sequelize.fn('DATE', User.sequelize.col('created_at'))],
      order: [[User.sequelize.fn('DATE', User.sequelize.col('created_at')), 'ASC']]
    });

    // Current period data for activity logs
    const currentActivityTimeSeries = await ActivityLog.findAll({
      attributes: [
        [ActivityLog.sequelize.fn('DATE', ActivityLog.sequelize.col('created_at')), 'date'],
        [ActivityLog.sequelize.fn('COUNT', ActivityLog.sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.between]: [currentPeriodStart, currentPeriodEnd]
        }
      },
      group: [ActivityLog.sequelize.fn('DATE', ActivityLog.sequelize.col('created_at'))],
      order: [[ActivityLog.sequelize.fn('DATE', ActivityLog.sequelize.col('created_at')), 'ASC']]
    });

    // Previous period data for activity logs
    const previousActivityTimeSeries = await ActivityLog.findAll({
      attributes: [
        [ActivityLog.sequelize.fn('DATE', ActivityLog.sequelize.col('created_at')), 'date'],
        [ActivityLog.sequelize.fn('COUNT', ActivityLog.sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.between]: [previousPeriodStart, previousPeriodEnd]
        }
      },
      group: [ActivityLog.sequelize.fn('DATE', ActivityLog.sequelize.col('created_at'))],
      order: [[ActivityLog.sequelize.fn('DATE', ActivityLog.sequelize.col('created_at')), 'ASC']]
    });

    // Summary data
    const currentUserTotal = currentUserTimeSeries.reduce((sum, item) => sum + parseInt(item.count), 0);
    const previousUserTotal = previousUserTimeSeries.reduce((sum, item) => sum + parseInt(item.count), 0);
    const currentActivityTotal = currentActivityTimeSeries.reduce((sum, item) => sum + parseInt(item.count), 0);
    const previousActivityTotal = previousActivityTimeSeries.reduce((sum, item) => sum + parseInt(item.count), 0);

    // Get overall totals for the metrics cards
    const totalUsersAllTime = await User.count();
    const totalActivityLogsAllTime = await ActivityLog.count();

    res.json({
      // Basic totals for metrics cards
      totalUsers: totalUsersAllTime,
      totalActivityLogs: totalActivityLogsAllTime,
      
      // Time series data for charts
      userTimeSeries: {
        current: currentUserTimeSeries,
        previous: previousUserTimeSeries,
        summary: {
          current: currentUserTotal,
          previous: previousUserTotal,
          change: currentUserTotal - previousUserTotal,
          changePercent: previousUserTotal > 0 ? ((currentUserTotal - previousUserTotal) / previousUserTotal * 100).toFixed(1) : 'N/A'
        }
      },
      activityTimeSeries: {
        current: currentActivityTimeSeries,
        previous: previousActivityTimeSeries,
        summary: {
          current: currentActivityTotal,
          previous: previousActivityTotal,
          change: currentActivityTotal - previousActivityTotal,
          changePercent: previousActivityTotal > 0 ? ((currentActivityTotal - previousActivityTotal) / previousActivityTotal * 100).toFixed(1) : 'N/A'
        }
      },
      period,
      dateRange: { 
        current: { startDate: currentPeriodStart.toISOString().split('T')[0], endDate: currentPeriodEnd.toISOString().split('T')[0] },
        previous: { startDate: previousPeriodStart.toISOString().split('T')[0], endDate: previousPeriodEnd.toISOString().split('T')[0] }
      }
    });

  } catch (err) {
    console.log('Error fetching enhanced stats:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get detailed data for drill-down
router.get('/stats/drilldown', async (req, res) => {
  const { type, date, role, status, search } = req.query;
  console.log('Drilldown endpoint called:', { type, date, role, status, search });

  try {
    let whereClause = {};
    
    if (date) {
      const startOfDay = new Date(date);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      whereClause.created_at = {
        [Op.between]: [startOfDay, endOfDay]
      };
    }

    if (type === 'users' && role) {
      whereClause.role = role;
    }

    if (type === 'incidents' && status) {
      whereClause.status = status;
    }

    // Add search functionality for activity logs
    if (type === 'activity' && search) {
      whereClause[Op.or] = [
        { action: { [Op.iLike]: `%${search}%` } },
        { table_name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    let data;
    switch (type) {
      case 'users':
        data = await User.findAll({
          where: whereClause,
          attributes: { exclude: ['password'] },
          order: [['created_at', 'DESC']]
        });
        break;
      case 'activity':
        data = await ActivityLog.findAll({
          where: whereClause,
          include: [{ model: User, attributes: ['name', 'email'] }],
          order: [['created_at', 'DESC']]
        });
        break;
      default:
        return res.status(400).json({ error: 'Invalid drilldown type' });
    }

    res.json({ type, data, filters: { date, role, status, search } });

  } catch (err) {
    console.log('Error fetching drilldown data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Generate reports
router.get('/reports/:type', async (req, res) => {
  const { type } = req.params; // users, incidents, jobcards, teams, activitylogs
  try {
    if (type === 'users') {
      const users = await User.findAll({ attributes: { exclude: ['password'] } });
      const csvWriter = require('csv-writer').createObjectCsvStringifier({
        header: [
          { id: 'id', title: 'ID' },
          { id: 'name', title: 'Name' },
          { id: 'email', title: 'Email' },
          { id: 'phone', title: 'Phone' },
          { id: 'role', title: 'Role' },
          { id: 'status', title: 'Status' },
          { id: 'created_at', title: 'Created At' },
        ],
      });
      const csv = csvWriter.getHeaderString() + csvWriter.stringifyRecords(users);
      res.header('Content-Type', 'text/csv');
      res.attachment('users_report.csv');
      res.send(csv);
    } else if (type === 'activitylogs') {
      const activitylogs = await ActivityLog.findAll();
      const csvWriter = require('csv-writer').createObjectCsvStringifier({
        header: [
          { id: 'id', title: 'ID' },
          { id: 'user_id', title: 'User ID' },
          { id: 'action', title: 'Action' },
          { id: 'table_name', title: 'Table Name' },
          { id: 'reference_id', title: 'Reference ID' },
          { id: 'created_at', title: 'Created At' },
        ],
      });
      const csv = csvWriter.getHeaderString() + csvWriter.stringifyRecords(activitylogs);
      res.header('Content-Type', 'text/csv');
      res.attachment('activitylogs_report.csv');
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Invalid report type' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get recent activity logs for admin notifications panel
router.get('/recent-activities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const activities = await ActivityLog.findAll({
      include: [{ model: User, attributes: ['name', 'email', 'role'] }],
      order: [['created_at', 'DESC']],
      limit: limit
    });

    res.json(activities);
  } catch (err) {
    console.log('Error fetching recent activities:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Messaging to managers - placeholder, assume we have a messaging table, but not in schema. For now, just log.
router.post('/message-managers', async (req, res) => {
  const { message } = req.body;
  // TODO: implement messaging
  await ActivityLog.create({
    user_id: req.user.id,
    action: `Sent message to managers: ${message}`,
  });
  res.json({ message: 'Message sent' });
});
module.exports = router;
module.exports = router;

module.exports = router;