const express = require('express');
const { WorkerProgress, JobCard, User, ActivityLog, Incident } = require('../models');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// All worker routes require authentication and worker role
router.use(authenticateToken, authorizeRoles('worker'));

// Get assigned jobs
router.get('/jobs', async (req, res) => {
  try {
    const progress = await WorkerProgress.findAll({
      where: { worker_id: req.user.id },
      include: [{ model: JobCard, include: [Incident] }],
    });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update job status
router.put('/progress/:progressId', async (req, res) => {
  const { status } = req.body;
  try {
    const progress = await WorkerProgress.findByPk(req.params.progressId);
    if (!progress || progress.worker_id !== req.user.id) return res.status(404).json({ error: 'Progress not found' });

    await progress.update({ status });
    if (status === 'working') await progress.update({ arrived_at: new Date() });
    if (status === 'done') await progress.update({ completed_at: new Date() });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Updated job status to ${status}`,
      table_name: 'worker_progress',
      reference_id: progress.id,
    });

    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// View job history and earnings
router.get('/history', async (req, res) => {
  try {
    const history = await WorkerProgress.findAll({
      where: { worker_id: req.user.id, status: 'done' },
      include: [JobCard],
    });

    // Compute earnings - R180 per hour (equivalent to $10/hour at 1 USD = 18 ZAR)
    let totalEarnings = 0;
    history.forEach(job => {
      if (job.arrived_at && job.completed_at) {
        const start = new Date(job.arrived_at);
        const end = new Date(job.completed_at);
        const diffMs = end - start;
        const diffHours = diffMs / (1000 * 60 * 60);
        totalEarnings += diffHours * 180; // R180 per hour
      } else {
        // Fallback for jobs without timestamps - assume 2 hours
        totalEarnings += 360; // R360 per job
      }
    });

    res.json({ history, totalEarnings: Math.round(totalEarnings * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Message team - placeholder
router.post('/message', async (req, res) => {
  const { message } = req.body;
  await ActivityLog.create({
    user_id: req.user.id,
    action: `Sent message to team: ${message}`,
  });
  res.json({ message: 'Message sent' });
});

module.exports = router;