const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, ActivityLog } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    console.log('Login attempt for:', email);
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.log('User not found:', email);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    console.log('User found:', user.id, 'Status:', user.status);
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch for user:', email);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check if user is blocked
    if (user.status === 'blocked') {
      console.log('Blocked user attempted login:', email);
      return res.status(403).json({ error: 'Account blocked. Please contact administrator.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log('Token generated for user:', user.id);

    // Log activity (temporarily disabled for debugging)
    // await ActivityLog.create({
    //   user_id: user.id,
    //   action: 'User logged in',
    // });

    console.log('Login successful for:', email);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout (client-side, but log activity)
router.post('/logout', authenticateToken, async (req, res) => {
  await ActivityLog.create({
    user_id: req.user.id,
    action: 'User logged out',
  });
  res.json({ message: 'Logged out' });
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    const isMatch = await bcrypt.compare(oldPassword, req.user.password);
    if (!isMatch) return res.status(400).json({ error: 'Old password incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await req.user.update({ password: hashedPassword });

    await ActivityLog.create({
      user_id: req.user.id,
      action: 'Password changed',
    });

    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update profile
router.put('/profile', authenticateToken, async (req, res) => {
  const { name, email, phone } = req.body;
  try {
    await req.user.update({ name, email, phone });
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'Profile updated',
    });
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const newToken = jwt.sign({ id: req.user.id, role: req.user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token: newToken });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get personal audit logs
router.get('/audit-logs', authenticateToken, async (req, res) => {
  try {
    const logs = await ActivityLog.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;