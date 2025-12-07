const express = require('express');
const { Notification } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All notification routes require authentication
router.use(authenticateToken);

// Get notifications for current user
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const notifications = await Notification.findAll({
      where: {
        user_id: req.user.id
      },
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: notifications,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: notifications.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark all notifications as read
router.patch('/read-all', async (req, res) => {
  try {
    await Notification.update(
      { is_read: true, updated_at: new Date() },
      {
        where: {
          user_id: req.user.id,
          is_read: false
        }
      }
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a specific notification
router.delete('/:id', async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: {
        id: req.params.id,
        user_id: req.user.id
      }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notification.destroy();

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unread notification count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.count({
      where: {
        user_id: req.user.id,
        is_read: false
      }
    });

    res.json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;