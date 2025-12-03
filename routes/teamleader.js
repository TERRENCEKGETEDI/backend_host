const express = require('express');
const { JobCard, WorkerProgress, User, TeamMember, ActivityLog, Team, Incident } = require('../models');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// All team leader routes require authentication and team_leader role
router.use(authenticateToken, authorizeRoles('team_leader'));

// Get assigned jobs
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await JobCard.findAll({
      where: { team_leader_id: req.user.id },
      include: [{ model: Incident }, { model: WorkerProgress, include: [User] }],
    });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Monitor team progress
router.get('/jobs/:jobId/progress', async (req, res) => {
  try {
    const progress = await WorkerProgress.findAll({
      where: { job_card_id: req.params.jobId },
      include: [User],
    });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update worker progress
router.put('/progress/:progressId', async (req, res) => {
  const { status } = req.body;
  try {
    const progress = await WorkerProgress.findByPk(req.params.progressId);
    if (!progress) return res.status(404).json({ error: 'Progress not found' });

    // Check if team leader owns the job
    const job = await JobCard.findByPk(progress.job_card_id);
    if (job.team_leader_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    await progress.update({ status });
    if (status === 'done') await progress.update({ completed_at: new Date() });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Updated progress for worker ${progress.worker_id}`,
      table_name: 'worker_progress',
      reference_id: progress.id,
    });

    res.json({ message: 'Progress updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request help (add another team)
router.post('/jobs/:jobId/help', async (req, res) => {
  try {
    const job = await JobCard.findByPk(req.params.jobId);
    if (!job || job.team_leader_id !== req.user.id) return res.status(404).json({ error: 'Job not found' });

    // TODO: logic to assign another team, for now just log
    await ActivityLog.create({
      user_id: req.user.id,
      action: `Requested help for job ${job.id}`,
      table_name: 'job_cards',
      reference_id: job.id,
    });

    res.json({ message: 'Help requested' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Download reports - placeholder
router.get('/reports', async (req, res) => {
  // TODO: generate CSV/Excel
  res.json({ message: 'Reports endpoint' });
});

// Message manager and team members - placeholder
router.post('/message', async (req, res) => {
  const { message, to } = req.body; // to: 'manager' or 'team'
  await ActivityLog.create({
    user_id: req.user.id,
    action: `Sent message to ${to}: ${message}`,
  });
  res.json({ message: 'Message sent' });
});

// Get team availability status
router.get('/team/status', async (req, res) => {
  try {
    // Find team managed by this team leader
    const teamMember = await TeamMember.findOne({
      where: { user_id: req.user.id },
      include: [{ model: Team }]
    });
    
    if (!teamMember || !teamMember.Team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const team = teamMember.Team;
    
    // Get current job count for this team
    const jobCount = await JobCard.count({
      where: { 
        team_id: team.id,
        status: { $ne: 'completed' }
      }
    });

    res.json({
      teamId: team.id,
      teamName: team.name,
      isAvailable: team.is_available,
      currentCapacity: jobCount,
      maxCapacity: team.max_capacity,
      priorityLevel: team.priority_level,
      utilizationRate: team.max_capacity > 0 ? (jobCount / team.max_capacity) : 0,
      lastActivity: team.last_activity,
      availableFrom: team.available_from
    });
  } catch (err) {
    console.error('Error fetching team status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update team availability status
router.put('/team/availability', async (req, res) => {
  try {
    const { is_available, max_capacity, priority_level, available_from } = req.body;
    
    // Find team managed by this team leader
    const teamMember = await TeamMember.findOne({
      where: { user_id: req.user.id },
      include: [{ model: Team }]
    });
    
    if (!teamMember || !teamMember.Team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const team = teamMember.Team;
    
    // Validate max capacity
    if (max_capacity !== undefined && (max_capacity < 0 || max_capacity > 20)) {
      return res.status(400).json({ error: 'Max capacity must be between 0 and 20' });
    }
    
    // Validate priority level
    if (priority_level !== undefined && (priority_level < 1 || priority_level > 5)) {
      return res.status(400).json({ error: 'Priority level must be between 1 and 5' });
    }

    // Prepare update data
    const updateData = {
      last_activity: new Date()
    };
    
    if (is_available !== undefined) updateData.is_available = is_available;
    if (max_capacity !== undefined) updateData.max_capacity = max_capacity;
    if (priority_level !== undefined) updateData.priority_level = priority_level;
    if (available_from !== undefined) updateData.available_from = available_from;

    await team.update(updateData);

    // Log the availability change
    await ActivityLog.create({
      user_id: req.user.id,
      action: `Updated team availability status`,
      table_name: 'teams',
      reference_id: team.id,
      details: JSON.stringify(updateData)
    });

    res.json({ 
      message: 'Team availability updated successfully',
      team: {
        id: team.id,
        name: team.name,
        is_available: team.is_available,
        max_capacity: team.max_capacity,
        priority_level: team.priority_level,
        last_activity: team.last_activity,
        available_from: team.available_from
      }
    });
  } catch (err) {
    console.error('Error updating team availability:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team workload analytics
router.get('/team/workload', async (req, res) => {
  try {
    // Find team managed by this team leader
    const teamMember = await TeamMember.findOne({
      where: { user_id: req.user.id },
      include: [{ model: Team }]
    });
    
    if (!teamMember || !teamMember.Team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const teamId = teamMember.Team.id;
    
    // Get team workload stats
    const jobCards = await JobCard.findAll({
      where: { team_id: teamId },
      include: [Incident]
    });

    const totalJobs = jobCards.length;
    const notStartedJobs = jobCards.filter(jc => jc.status === 'not_started').length;
    const inProgressJobs = jobCards.filter(jc => jc.status === 'in_progress').length;
    const completedJobs = jobCards.filter(jc => jc.status === 'completed').length;

    // Calculate completion rate
    const completionRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

    // Calculate average response time for recent jobs (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const recentJobs = jobCards.filter(jc => new Date(jc.assigned_at) >= thirtyDaysAgo);
    
    let averageResponseTime = 0;
    if (recentJobs.length > 0) {
      const totalResponseTime = recentJobs.reduce((sum, job) => {
        if (job.completed_at && job.assigned_at) {
          return sum + (new Date(job.completed_at) - new Date(job.assigned_at));
        }
        return sum;
      }, 0);
      averageResponseTime = totalResponseTime / recentJobs.length / (1000 * 60 * 60); // Convert to hours
    }

    // Get team member status
    const teamMembers = await TeamMember.findAll({
      where: { team_id: teamId },
      include: [{
        model: User,
        where: { status: 'active' }
      }]
    });

    const activeMembers = teamMembers.length;
    
    res.json({
      teamId,
      teamName: teamMember.Team.name,
      workloadStats: {
        totalJobs,
        notStartedJobs,
        inProgressJobs,
        completedJobs,
        completionRate,
        averageResponseTime: Math.round(averageResponseTime * 100) / 100 // Round to 2 decimals
      },
      teamCapacity: {
        currentCapacity: totalJobs - completedJobs,
        maxCapacity: teamMember.Team.max_capacity,
        utilizationRate: teamMember.Team.max_capacity > 0 
          ? Math.round(((totalJobs - completedJobs) / teamMember.Team.max_capacity) * 100)
          : 0,
        availableSlots: Math.max(0, teamMember.Team.max_capacity - (totalJobs - completedJobs))
      },
      memberStats: {
        activeMembers,
        teamPriority: teamMember.Team.priority_level
      },
      lastUpdated: new Date()
    });
  } catch (err) {
    console.error('Error fetching team workload:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set temporary unavailability
router.post('/team/unavailable', async (req, res) => {
  try {
    const { duration_minutes, reason } = req.body;
    
    if (!duration_minutes || duration_minutes < 5 || duration_minutes > 1440) { // 5 min to 24 hours
      return res.status(400).json({ error: 'Duration must be between 5 and 1440 minutes' });
    }

    // Find team managed by this team leader
    const teamMember = await TeamMember.findOne({
      where: { user_id: req.user.id },
      include: [{ model: Team }]
    });
    
    if (!teamMember || !teamMember.Team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const team = teamMember.Team;
    const availableFrom = new Date(Date.now() + (duration_minutes * 60 * 1000));

    await team.update({
      is_available: false,
      available_from: availableFrom,
      last_activity: new Date()
    });

    // Log the unavailability
    await ActivityLog.create({
      user_id: req.user.id,
      action: `Set team unavailable for ${duration_minutes} minutes`,
      table_name: 'teams',
      reference_id: team.id,
      details: JSON.stringify({
        duration_minutes,
        reason,
        available_from: availableFrom
      })
    });

    res.json({
      message: `Team will be unavailable for ${duration_minutes} minutes`,
      available_from: availableFrom,
      reason
    });
  } catch (err) {
    console.error('Error setting team unavailable:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team assignment history
router.get('/team/assignment-history', async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;
    
    // Find team managed by this team leader
    const teamMember = await TeamMember.findOne({
      where: { user_id: req.user.id },
      include: [{ model: Team }]
    });
    
    if (!teamMember || !teamMember.Team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const teamId = teamMember.Team.id;
    
    const jobCards = await JobCard.findAll({
      where: { team_id: teamId },
      include: [Incident],
      order: [['assigned_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const assignmentHistory = jobCards.map(job => ({
      id: job.id,
      incidentTitle: job.Incident?.title || 'Unknown Incident',
      status: job.status,
      assignedAt: job.assigned_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      responseTime: job.completed_at && job.assigned_at 
        ? new Date(job.completed_at) - new Date(job.assigned_at)
        : null
    }));

    res.json({
      teamId,
      teamName: teamMember.Team.name,
      assignmentHistory,
      totalCount: jobCards.length
    });
  } catch (err) {
    console.error('Error fetching assignment history:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;