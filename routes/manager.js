const express = require('express');
const models = require('../models');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const IntelligentAssignmentService = require('../services/IntelligentAssignmentService');
const TeamMonitoringService = require('../services/TeamMonitoringService');
const AutomatedAssignmentService = require('../services/AutomatedAssignmentService');
const AssignmentAuthorization = require('../middleware/assignmentAuth');
const StatusValidationMiddleware = require('../middleware/statusValidation');
const StatusValidationService = require('../services/StatusValidationService');

const { Team, TeamMember, User, Incident, JobCard, WorkerProgress, ActivityLog } = models;

const router = express.Router();

// All manager routes require authentication and manager role
router.use(authenticateToken, authorizeRoles('manager'));

// Create team
router.post('/teams', async (req, res) => {
  const { name } = req.body;
  try {
    const team = await Team.create({ name, manager_id: req.user.id });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Created team ${name}`,
      table_name: 'teams',
      reference_id: team.id,
    });

    res.status(201).json(team);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get teams managed by this manager
router.get('/teams', async (req, res) => {
  try {
    const teams = await Team.findAll({
      where: { manager_id: req.user.id },
      include: [
        { model: TeamMember, include: [User] },
        { model: JobCard, include: [Incident] }
      ],
    });
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add member to team
router.post('/teams/:teamId/members', async (req, res) => {
  const { userId } = req.body;
  try {
    const team = await Team.findOne({ where: { id: req.params.teamId, manager_id: req.user.id } });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const member = await TeamMember.create({ team_id: req.params.teamId, user_id: userId });

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Added member to team ${team.name}`,
      table_name: 'team_members',
      reference_id: member.id,
    });

    res.status(201).json(member);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove member from team
router.delete('/teams/:teamId/members/:memberId', async (req, res) => {
  try {
    const team = await Team.findOne({ where: { id: req.params.teamId, manager_id: req.user.id } });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const member = await TeamMember.findByPk(req.params.memberId);
    if (!member || member.team_id !== team.id) return res.status(404).json({ error: 'Member not found' });

    await member.destroy();

    await ActivityLog.create({
      user_id: req.user.id,
      action: `Removed member from team ${team.name}`,
      table_name: 'team_members',
      reference_id: member.id,
    });

    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Manual override assignment (assign to specific team) - MUST come before intelligent assignment
router.post('/incidents/:incidentId/assign/:teamId', async (req, res) => {
  try {
    const { incidentId, teamId } = req.params;
    const { reason } = req.body;

    const incident = await Incident.findByPk(incidentId);
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Check if incident is already assigned
    const existingJobCard = await JobCard.findOne({ where: { incident_id: incidentId } });
    if (existingJobCard) {
      return res.status(400).json({ error: 'Incident is already assigned to a team' });
    }

    const team = await Team.findOne({
      where: { id: teamId, manager_id: req.user.id },
      include: [TeamMember]
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const jobCard = await JobCard.create({
      incident_id: incidentId,
      team_id: teamId,
      team_leader_id: null,
      status: 'not_started',
      assigned_at: new Date()
    });

    // Create WorkerProgress for each team member
    const members = await TeamMember.findAll({ where: { team_id: teamId } });
    for (const member of members) {
      await WorkerProgress.create({
        job_card_id: jobCard.id,
        worker_id: member.user_id,
      });
    }

    await incident.update({
      status: 'In Progress',
      assigned_team_id: teamId,
      assigned_at: new Date()
    });

    // Update team capacity
    await team.update({
      current_capacity: team.current_capacity + 1,
      last_activity: new Date()
    });

    // Log the manual override
    await ActivityLog.create({
      user_id: req.user.id,
      action: `Manually assigned team ${team.name} to incident "${incident.title}"`,
      table_name: 'job_cards',
      reference_id: jobCard.id,
      details: JSON.stringify({
        reason,
        manualOverride: true
      })
    });

    // Send notifications to team members and team leader
    const teamMembers = await TeamMember.findAll({
      where: { team_id: teamId },
      include: [User]
    });

    // Find team leader (first team member, or we could have a separate logic)
    const teamLeader = teamMembers.find(member => member.User.role === 'team_leader') || teamMembers[0];

    // Notify team leader (Team Leader: job assignments)
    if (teamLeader) {
      global.sendNotification(teamLeader.user_id, 'new-assignment', {
        type: 'task',
        title: 'New Team Assignment',
        message: `New incident assigned to your team: ${incident.title}`,
        related_type: 'incident',
        related_id: incident.id
      });
    }

    // Notify all team members (Worker: job updates)
    teamMembers.forEach(member => {
      if (member.User.role === 'worker') {
        global.sendNotification(member.user_id, 'new-assignment', {
          type: 'task',
          title: 'New Job Assignment',
          message: `New incident assigned to your team: ${incident.title}`,
          related_type: 'incident',
          related_id: incident.id
        });
      }
    });

    // Notify managers about the assignment (Manager: status updates)
    global.sendRoleNotification('manager', 'assignment-update', {
      type: 'info',
      title: 'Assignment Completed',
      message: `Team ${team.name} manually assigned to incident "${incident.title}"`,
      related_type: 'incident',
      related_id: incident.id
    });

    res.json({
      success: true,
      message: `Incident manually assigned to team ${team.name}`,
      data: {
        jobCard,
        team: {
          id: team.id,
          name: team.name
        }
      }
    });
  } catch (err) {
    console.error('Error in manual assignment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team performance comparison
router.get('/teams/performance-comparison', async (req, res) => {
  try {
    const assignmentService = new IntelligentAssignmentService();
    const teams = await assignmentService.getAvailableTeams(req.user.id);
    
    const performanceData = await Promise.all(teams.map(async (team) => {
      const compliance = await assignmentService.getTeamSLACompliance(team.id);
      return {
        teamId: team.id,
        teamName: team.name,
        performance: {
          currentCapacity: team.currentCapacity,
          maxCapacity: team.maxCapacity,
          utilizationRate: team.utilizationRate,
          memberCount: team.memberCount,
          slaCompliance: compliance.complianceRate,
          averageResponseTime: compliance.averageResponseTime
        }
      };
    }));
    
    // Calculate system-wide metrics
    const totalCapacity = performanceData.reduce((sum, t) => sum + t.performance.maxCapacity, 0);
    const usedCapacity = performanceData.reduce((sum, t) => sum + t.performance.currentCapacity, 0);
    const averageSLA = performanceData.length > 0 
      ? Math.round(performanceData.reduce((sum, t) => sum + t.performance.slaCompliance, 0) / performanceData.length)
      : 0;
    
    res.json({
      success: true,
      data: {
        teams: performanceData,
        systemMetrics: {
          totalCapacity,
          usedCapacity,
          availableCapacity: totalCapacity - usedCapacity,
          capacityUtilization: totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0,
          averageSLA
        }
      }
    });
  } catch (err) {
    console.error('Error fetching performance comparison:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Initialize team monitoring service
const teamMonitoringService = new TeamMonitoringService();

// Start team monitoring (automatically on first manager route access)
teamMonitoringService.startMonitoring();

// Get team monitoring data
router.get('/monitoring/teams', async (req, res) => {
  try {
    const { teamId } = req.query;
    const monitoringData = await teamMonitoringService.getTeamMonitoringData(teamId);
    
    res.json(monitoringData);
  } catch (err) {
    console.error('Error fetching monitoring data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get system monitoring summary
router.get('/monitoring/system', async (req, res) => {
  try {
    const systemData = await teamMonitoringService.getSystemMonitoringSummary();
    res.json(systemData);
  } catch (err) {
    console.error('Error fetching system monitoring:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manually trigger team capacity update
router.post('/monitoring/update-capacities', async (req, res) => {
  try {
    await teamMonitoringService.updateAllTeamCapacities();
    
    res.json({
      success: true,
      message: 'Team capacities updated successfully',
      timestamp: new Date()
    });
  } catch (err) {
    console.error('Error updating team capacities:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign incident to team using intelligent algorithm

// Get available teams with intelligent analysis
router.get('/teams/available', async (req, res) => {
  try {
    const assignmentService = new IntelligentAssignmentService();
    const teams = await assignmentService.getAvailableTeams(req.user.id);
    
    res.json({
      success: true,
      data: teams
    });
  } catch (err) {
    console.error('Error fetching available teams:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get assignment analytics and performance metrics
router.get('/analytics/assignment', async (req, res) => {
  try {
    const assignmentService = new IntelligentAssignmentService();
    const analytics = await assignmentService.getAssignmentAnalytics(req.user.id);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (err) {
    console.error('Error fetching assignment analytics:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get SLA compliance for all teams
router.get('/teams/sla-compliance', async (req, res) => {
  try {
    const assignmentService = new IntelligentAssignmentService();
    const teams = await assignmentService.getAvailableTeams(req.user.id);
    
    const slaData = await Promise.all(teams.map(async (team) => {
      const compliance = await assignmentService.getTeamSLACompliance(team.id);
      return {
        teamId: team.id,
        teamName: team.name,
        compliance: compliance
      };
    }));
    
    res.json({
      success: true,
      data: slaData
    });
  } catch (err) {
    console.error('Error fetching SLA compliance:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team health status
router.get('/monitoring/health/:teamId', async (req, res) => {
  try {
    const healthData = await teamMonitoringService.calculateHealthMetrics(req.params.teamId);
    
    res.json({
      success: true,
      data: {
        teamId: req.params.teamId,
        ...healthData
      }
    });
  } catch (err) {
    console.error('Error fetching team health:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team capacity trends
router.get('/monitoring/trends/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const trendsData = await teamMonitoringService.getCapacityTrends(teamId);
    
    res.json({
      success: true,
      data: {
        teamId,
        ...trendsData
      }
    });
  } catch (err) {
    console.error('Error fetching capacity trends:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Control monitoring service
router.post('/monitoring/control', async (req, res) => {
  try {
    const { action, interval } = req.body;
    
    switch (action) {
      case 'start':
        if (teamMonitoringService.isMonitoring) {
          return res.json({
            success: false,
            message: 'Monitoring is already running'
          });
        }
        teamMonitoringService.startMonitoring(interval);
        break;
      case 'stop':
        teamMonitoringService.stopMonitoring();
        break;
      case 'restart':
        teamMonitoringService.stopMonitoring();
        setTimeout(() => {
          teamMonitoringService.startMonitoring(interval);
        }, 1000);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action. Use start, stop, or restart' });
    }
    
    res.json({
      success: true,
      message: `Monitoring ${action}ed successfully`,
      monitoringStatus: teamMonitoringService.isMonitoring,
      interval: interval || 'default'
    });
  } catch (err) {
    console.error('Error controlling monitoring service:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove team from incident
router.delete('/incidents/:incidentId/assign', async (req, res) => {
  try {
    const jobCard = await JobCard.findOne({
      where: { incident_id: req.params.incidentId },
      include: [{ model: Team, where: { manager_id: req.user.id } }],
    });
    if (!jobCard) return res.status(404).json({ error: 'Job not found' });

    await jobCard.destroy();
    await Incident.update({ status: 'verified' }, { where: { id: req.params.incidentId } });

    await ActivityLog.create({
      user_id: req.user.id,
      action: 'Removed team from incident',
      table_name: 'job_cards',
      reference_id: jobCard.id,
    });

    res.json({ message: 'Team removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get incidents with assigned teams
router.get('/incidents', async (req, res) => {
  try {
    const incidents = await Incident.findAll({
      include: [{
        model: JobCard,
        include: [Team]
      }],
      order: [['created_at', 'DESC']]
    });

    res.json(incidents);
  } catch (err) {
    console.error('Error fetching incidents:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get comprehensive stats
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay.getTime() - (startOfDay.getDay() * 24 * 60 * 60 * 1000));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get incidents with their job cards and teams
    const incidents = await Incident.findAll({
      include: [{
        model: JobCard,
        include: [Team]
      }]
    });

    // Calculate incidents per day (last 7 days)
    const incidentsPerDay = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(startOfDay.getTime() - (i * 24 * 60 * 60 * 1000));
      const nextDate = new Date(date.getTime() + (24 * 60 * 60 * 1000));
      const count = incidents.filter(incident => {
        const incidentDate = new Date(incident.created_at);
        return incidentDate >= date && incidentDate < nextDate;
      }).length;
      incidentsPerDay.push({
        date: date.toISOString().split('T')[0],
        count
      });
    }

    // Calculate incidents per week (last 4 weeks)
    const incidentsPerWeek = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(startOfWeek.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
      const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));
      const count = incidents.filter(incident => {
        const incidentDate = new Date(incident.created_at);
        return incidentDate >= weekStart && incidentDate < weekEnd;
      }).length;
      incidentsPerWeek.push({
        week: `Week ${Math.ceil((weekStart.getDate()) / 7)}`,
        count
      });
    }

    // Calculate incidents per month (last 6 months)
    const incidentsPerMonth = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const count = incidents.filter(incident => {
        const incidentDate = new Date(incident.created_at);
        return incidentDate >= monthStart && incidentDate <= monthEnd;
      }).length;
      incidentsPerMonth.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        count
      });
    }

    // Team performance stats
    const teams = await Team.findAll({
      where: { manager_id: req.user.id },
      include: [{
        model: TeamMember,
        include: [User]
      }, {
        model: JobCard,
        include: [Incident]
      }]
    });

    const teamStats = teams.map(team => {
      const totalJobs = team.JobCards?.length || 0;
      const completedJobs = team.JobCards?.filter(job => job.status === 'completed').length || 0;
      const pendingJobs = team.JobCards?.filter(job => job.status !== 'completed').length || 0;
      const memberCount = team.TeamMembers?.length || 0;

      return {
        id: team.id,
        name: team.name,
        memberCount,
        totalJobs,
        completedJobs,
        pendingJobs,
        completionRate: totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0
      };
    });

    // Status distribution
    const statusDistribution = {};
    incidents.forEach(incident => {
      statusDistribution[incident.status] = (statusDistribution[incident.status] || 0) + 1;
    });

    // Recent incidents (last 5)
    const recentIncidents = incidents
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(incident => ({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        created_at: incident.created_at,
        assignedTeam: incident.JobCard?.Team?.name || 'Unassigned'
      }));

    res.json({
      incidentsPerDay,
      incidentsPerWeek,
      incidentsPerMonth,
      teamStats,
      statusDistribution,
      recentIncidents,
      summary: {
        totalIncidents: incidents.length,
        totalTeams: teams.length,
        totalMembers: teams.reduce((sum, team) => sum + (team.TeamMembers?.length || 0), 0),
        averageCompletionRate: teamStats.length > 0 
          ? Math.round(teamStats.reduce((sum, team) => sum + team.completionRate, 0) / teamStats.length)
          : 0
      }
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Message admins and team leaders - placeholder
router.post('/message', async (req, res) => {
  const { message, to } = req.body; // to: 'admins' or 'team_leaders'
  await ActivityLog.create({
    user_id: req.user.id,
    action: `Sent message to ${to}: ${message}`,
  });
  res.json({ message: 'Message sent' });
});

// Get all available users (for adding to teams)
router.get('/users', async (req, res) => {
  try {
    // Get users who are workers and not already in a team
    const users = await User.findAll({
      where: { role: 'worker' },
      attributes: ['id', 'name', 'email'],
    });

    // Filter out users who are already in teams
    const teamMembers = await TeamMember.findAll();
    const userIdsInTeams = teamMembers.map(tm => tm.user_id);
    const availableUsers = users.filter(user => !userIdsInTeams.includes(user.id));

    res.json(availableUsers);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =================== AUTOMATED ASSIGNMENT ROUTES ===================

/**
 * Get automation status and configuration
 * Managers can only access automation settings for their own teams
 */
router.get('/automation/status', AssignmentAuthorization.verifyAutomationAuthorization, async (req, res) => {
  try {
    const automationService = new AutomatedAssignmentService();
    const status = await automationService.getAutomationStatus(req.user.id);
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error fetching automation status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Trigger automated bulk assignment for all unassigned incidents
 * Managers have exclusive authorization for this operation
 */
router.post('/automation/assign-all', 
  AssignmentAuthorization.verifyAutomationAuthorization,
  AssignmentAuthorization.assignmentRateLimit,
  async (req, res) => {
    try {
      const automationService = new AutomatedAssignmentService();
      const options = {
        dryRun: req.body.dryRun || false,
        priority: req.body.priority || 'all',
        maxIncidents: req.body.maxIncidents || null,
        forceAssign: req.body.forceAssign || false
      };
      
      await AssignmentAuthorization.logAuthorizationAttempt(req, res, async () => {});
      
      const result = await automationService.autoAssignAllIncidents(req.user.id, options);
      
      res.json({
        success: true,
        message: result.dryRun ? 'Dry run completed - no assignments made' : 'Automated assignment completed',
        data: result
      });
    } catch (error) {
      console.error('Error in automated bulk assignment:', error);
      res.status(500).json({ 
        success: false,
        error: error.message || 'Automated assignment failed' 
      });
    }
  }
);

/**
 * Assign single incident using automated rule-based system
 */
router.post('/automation/assign/:incidentId',
  AssignmentAuthorization.verifyIncidentAssignmentAccess,
  async (req, res) => {
    try {
      const automationService = new AutomatedAssignmentService();
      const options = {
        forceAssign: req.body.forceAssign || false,
        overrideRules: req.body.overrideRules || false
      };
      
      const result = await automationService.assignIncidentWithRules(
        req.params.incidentId,
        req.user.id,
        options
      );

      // Send notifications for automated assignment
      const teamMembers = await TeamMember.findAll({
        where: { team_id: result.selectedTeam.id },
        include: [User]
      });

      // Find team leader
      const teamLeader = teamMembers.find(member => member.User.role === 'team_leader') || teamMembers[0];

      // Notify team leader (Team Leader: job assignments)
      if (teamLeader) {
        global.sendNotification(teamLeader.user_id, 'new-assignment', {
          type: 'task',
          title: 'Automated Team Assignment',
          message: `New incident automatically assigned to your team: ${result.jobCard.Incident?.title || 'Unknown'}`,
          related_type: 'incident',
          related_id: req.params.incidentId
        });
      }

      // Notify all team members (Worker: job updates)
      teamMembers.forEach(member => {
        if (member.User.role === 'worker') {
          global.sendNotification(member.user_id, 'new-assignment', {
            type: 'task',
            title: 'New Automated Assignment',
            message: `New incident assigned to your team: ${result.jobCard.Incident?.title || 'Unknown'}`,
            related_type: 'incident',
            related_id: req.params.incidentId
          });
        }
      });

      // Notify managers about the automated assignment (Manager: assignment updates)
      global.sendRoleNotification('manager', 'assignment-update', {
        type: 'info',
        title: 'Automated Assignment Completed',
        message: `Incident "${result.jobCard.Incident?.title || 'Unknown'}" automatically assigned to team ${result.selectedTeam.name}`,
        related_type: 'incident',
        related_id: req.params.incidentId
      });

      res.json({
        success: true,
        message: result.message,
        data: {
          jobCard: result.jobCard,
          selectedTeam: {
            id: result.selectedTeam.id,
            name: result.selectedTeam.name,
            score: result.selectedTeam.finalScore
          },
          categorization: result.categorization,
          rulesApplied: result.selectedTeam.appliedRules
        }
      });
    } catch (error) {
      console.error('Error in rule-based assignment:', error);
      res.status(500).json({ 
        success: false,
        error: error.message || 'Rule-based assignment failed' 
      });
    }
  }
);

/**
 * Preview automated assignment results without making changes
 */
router.post('/automation/preview',
  AssignmentAuthorization.verifyAutomationAuthorization,
  async (req, res) => {
    try {
      const automationService = new AutomatedAssignmentService();
      const options = {
        dryRun: true,
        priority: req.body.priority || 'all',
        maxIncidents: req.body.maxIncidents || null
      };
      
      const result = await automationService.autoAssignAllIncidents(req.user.id, options);
      
      res.json({
        success: true,
        message: 'Preview of automated assignment results',
        data: {
          summary: {
            processedCount: result.processedCount,
            wouldAssignCount: result.assignedCount,
            totalUnassigned: result.totalUnassigned
          },
          results: result.results,
          errors: result.errors
        }
      });
    } catch (error) {
      console.error('Error in assignment preview:', error);
      res.status(500).json({ 
        success: false,
        error: error.message || 'Assignment preview failed' 
      });
    }
  }
);

/**
 * Bulk assign specific incidents to a specific team
 * Manager exclusive authorization required
 */
router.post('/automation/bulk-assign',
  AssignmentAuthorization.verifyBulkAssignmentAuthorization,
  AssignmentAuthorization.assignmentRateLimit,
  async (req, res) => {
    try {
      const { incidentIds, teamId, reason } = req.body;
      const managerId = req.user.id;
      
      const assignmentResults = [];
      const errors = [];
      
      // If specific team is provided, use manual assignment
      if (teamId && req.targetTeam) {
        for (const incidentId of incidentIds) {
          try {
            const incident = await Incident.findByPk(incidentId);
            if (!incident || incident.status !== 'verified') {
              throw new Error(`Incident ${incidentId} not ready for assignment`);
            }

            // Create job card
            const jobCard = await JobCard.create({
              incident_id: incidentId,
              team_id: teamId,
              team_leader_id: null,
              status: 'not_started',
              assigned_at: new Date()
            });

            // Update incident
            await incident.update({
              status: 'In Progress',
              assigned_team_id: teamId,
              assigned_at: new Date()
            });

            // Log the assignment
            await ActivityLog.create({
              user_id: managerId,
              action: `Bulk assignment: team ${req.targetTeam.name} to incident "${incident.title}"`,
              table_name: 'job_cards',
              reference_id: jobCard.id,
              details: JSON.stringify({
                type: 'bulk_manual_assignment',
                reason: reason || 'Manager bulk assignment',
                assignmentCount: incidentIds.length
              })
            });

            assignmentResults.push({
              incidentId,
              incidentTitle: incident.title,
              status: 'assigned',
              teamName: req.targetTeam.name
            });
            
          } catch (error) {
            console.error(`Error assigning incident ${incidentId}:`, error);
            errors.push({
              incidentId,
              error: error.message
            });
          }
        }
      } else {
        // Use automated assignment for each incident
        const automationService = new AutomatedAssignmentService();
        
        for (const incidentId of incidentIds) {
          try {
            const result = await automationService.assignIncidentWithRules(incidentId, managerId);
            
            assignmentResults.push({
              incidentId,
              incidentTitle: result.jobCard.Incident?.title || 'Unknown',
              status: 'assigned',
              teamName: result.selectedTeam.name,
              category: result.categorization.category
            });
            
          } catch (error) {
            console.error(`Error automated assigning incident ${incidentId}:`, error);
            errors.push({
              incidentId,
              error: error.message
            });
          }
        }
      }
      
      // Log the bulk operation
      await ActivityLog.create({
        user_id: managerId,
        action: `Bulk assignment operation: ${assignmentResults.length} assigned, ${errors.length} failed`,
        table_name: 'incidents',
        reference_id: null,
        details: JSON.stringify({
          type: 'bulk_assignment_operation',
          totalIncidents: incidentIds.length,
          successfulAssignments: assignmentResults.length,
          failedAssignments: errors.length,
          teamId: teamId || 'automated',
          reason: reason || 'Manager bulk assignment'
        })
      });
      
      res.json({
        success: true,
        message: `Bulk assignment completed: ${assignmentResults.length} assigned, ${errors.length} failed`,
        data: {
          assignmentResults,
          errors,
          summary: {
            totalIncidents: incidentIds.length,
            assigned: assignmentResults.length,
            failed: errors.length
          }
        }
      });
    } catch (error) {
      console.error('Error in bulk assignment:', error);
      res.status(500).json({ 
        success: false,
        error: error.message || 'Bulk assignment failed' 
      });
    }
  }
);

/**
 * Revert automated assignment (manager exclusive operation)
 */
router.post('/automation/revert/:incidentId',
  AssignmentAuthorization.verifyIncidentAssignmentAccess,
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { reason } = req.body;
      
      if (!req.incident.JobCards || req.incident.JobCards.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Incident is not currently assigned'
        });
      }
      
      const jobCard = req.incident.JobCards[0];
      
      // Remove the job card
      await jobCard.destroy();
      
      // Update incident status back to verified
      await req.incident.update({
        status: 'verified',
        assigned_team_id: null,
        assigned_at: null,
        priority: null,
        category_reasoning: null
      });
      
      // Log the revert operation
      await ActivityLog.create({
        user_id: req.user.id,
        action: `Reverted automated assignment for incident "${req.incident.title}"`,
        table_name: 'job_cards',
        reference_id: jobCard.id,
        details: JSON.stringify({
          type: 'assignment_revert',
          reason: reason || 'Manager reverted automated assignment',
          originalAssignment: {
            teamId: jobCard.team_id,
            assignedAt: jobCard.assigned_at
          }
        })
      });
      
      res.json({
        success: true,
        message: 'Automated assignment reverted successfully',
        data: {
          incidentId,
          previousStatus: 'verified',
          revertedAt: new Date()
        }
      });
    } catch (error) {
      console.error('Error reverting assignment:', error);
      res.status(500).json({ 
        success: false,
        error: error.message || 'Failed to revert assignment' 
      });
    }
  }
);

/**
 * Get assignment history and audit trail
 */
router.get('/automation/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0, incidentId } = req.query;
    
    const whereClause = {
      user_id: req.user.id,
      action: {
        [Op.like]: '%assignment%'
      }
    };
    
    if (incidentId) {
      whereClause.reference_id = incidentId;
    }
    
    const activities = await ActivityLog.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: activities.length === parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching assignment history:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// =================== STATUS VALIDATION ROUTES ===================

/**
 * Get status progression recommendations for an incident
 */
router.get('/incidents/:incidentId/status/progression', StatusValidationMiddleware.getStatusProgression);

/**
 * Change incident status with full validation
 */
router.patch('/incidents/:incidentId/status', 
  StatusValidationMiddleware.requireManagerAuthForStatus,
  StatusValidationMiddleware.validateIncidentStatusChange,
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { result, reason } = req.statusValidation;
      const { id: userId } = req.user;

      const validationService = new StatusValidationService();
      const updateResult = await validationService.applyStatusChange(
        incidentId,
        req.body.status,
        result,
        userId,
        reason
      );

      if (!updateResult.success) {
        return res.status(500).json({
          success: false,
          error: updateResult.error
        });
      }

      // Send notifications for status updates
      if (updateResult.jobCard) {
        // Notify team members about status change (Worker: job updates, Team Leader: team work updates)
        const teamMembers = await TeamMember.findAll({
          where: { team_id: updateResult.jobCard.team_id },
          include: [User]
        });

        teamMembers.forEach(member => {
          const notificationType = member.User.role === 'team_leader' ? 'warning' : 'info';
          const title = member.User.role === 'team_leader' ? 'Team Status Update' : 'Job Status Update';

          global.sendNotification(member.user_id, 'status-update', {
            type: notificationType,
            title: title,
            message: `Incident "${updateResult.incident.title}" status changed to ${req.body.status}`,
            related_type: 'incident',
            related_id: updateResult.incident.id
          });
        });

        // Notify managers about status changes (Manager: status updates from team leaders)
        global.sendRoleNotification('manager', 'status-update', {
          type: 'info',
          title: 'Team Status Update',
          message: `Incident "${updateResult.incident.title}" status updated to ${req.body.status}`,
          related_type: 'incident',
          related_id: updateResult.incident.id
        });
      }

      res.json({
        success: true,
        message: updateResult.message,
        data: {
          incident: {
            id: updateResult.incident.id,
            title: updateResult.incident.title,
            status: updateResult.incident.status,
            updated_at: updateResult.incident.updated_at
          },
          jobCard: updateResult.jobCard ? {
            id: updateResult.jobCard.id,
            status: updateResult.jobCard.status,
            started_at: updateResult.jobCard.started_at,
            completed_at: updateResult.jobCard.completed_at
          } : null,
          validationDetails: result.validationDetails
        }
      });
    } catch (error) {
      console.error('Error updating incident status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update incident status'
      });
    }
  }
);

/**
 * Mark incident as In Progress (with strict validation)
 */
router.patch('/incidents/:incidentId/status/in-progress',
  StatusValidationMiddleware.validateInProgressTransition,
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { result } = req.statusValidation;
      const { id: userId } = req.user;

      const validationService = new StatusValidationService();
      const updateResult = await validationService.applyStatusChange(
        incidentId,
        'In Progress',
        result,
        userId,
        'Marked as In Progress'
      );

      if (!updateResult.success) {
        return res.status(500).json({
          success: false,
          error: updateResult.error
        });
      }

      res.json({
        success: true,
        message: 'Incident successfully marked as In Progress',
        data: {
          incident: updateResult.incident,
          jobCard: updateResult.jobCard,
          requirementsMet: {
            teamAssigned: !!result.team,
            teamActive: result.team?.is_available,
            hasActiveMembers: result.team?.TeamMembers?.length > 0,
            managerAuthorized: true
          }
        }
      });
    } catch (error) {
      console.error('Error marking incident as In Progress:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark incident as In Progress'
      });
    }
  }
);

/**
 * Mark incident as Completed (with strict validation and reasoning)
 */
router.patch('/incidents/:incidentId/status/completed',
  StatusValidationMiddleware.validateCompletedTransition,
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { result, reason } = req.statusValidation;
      const { id: userId } = req.user;

      const validationService = new StatusValidationService();
      const updateResult = await validationService.applyStatusChange(
        incidentId,
        'Completed',
        result,
        userId,
        reason
      );

      if (!updateResult.success) {
        return res.status(500).json({
          success: false,
          error: updateResult.error
        });
      }

      res.json({
        success: true,
        message: 'Incident successfully marked as Completed',
        data: {
          incident: updateResult.incident,
          jobCard: updateResult.jobCard,
          completionDetails: {
            completionTime: new Date(),
            completionReason: reason,
            timeAssigned: result.incident.assigned_at,
            totalDuration: new Date() - new Date(result.incident.assigned_at),
            requirementsMet: {
              teamAssigned: !!result.team,
              teamActive: result.team?.is_available,
              minimumTimeElapsed: true,
              properStatusProgression: result.incident.status === 'In Progress',
              managerAuthorized: true
            }
          }
        }
      });
    } catch (error) {
      console.error('Error marking incident as Completed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark incident as Completed'
      });
    }
  }
);

/**
 * Cancel incident (manager exclusive, requires detailed reason)
 */
router.patch('/incidents/:incidentId/status/cancelled',
  StatusValidationMiddleware.validateCancelledTransition,
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { result, reason } = req.statusValidation;
      const { id: userId } = req.user;

      const validationService = new StatusValidationService();
      const updateResult = await validationService.applyStatusChange(
        incidentId,
        'Cancelled',
        result,
        userId,
        reason
      );

      if (!updateResult.success) {
        return res.status(500).json({
          success: false,
          error: updateResult.error
        });
      }

      res.json({
        success: true,
        message: 'Incident successfully cancelled',
        data: {
          incident: updateResult.incident,
          jobCard: updateResult.jobCard,
          cancellationDetails: {
            cancellationTime: new Date(),
            cancellationReason: reason,
            requirementsMet: {
              managerAuthorization: true,
              detailedReasonProvided: reason.length >= 15
            }
          }
        }
      });
    } catch (error) {
      console.error('Error cancelling incident:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel incident'
      });
    }
  }
);

/**
 * Get validation status for a specific status change
 */
router.post('/incidents/:incidentId/status/validate', 
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { status } = req.body;
      const { id: userId, role: userRole } = req.user;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required for validation'
        });
      }

      const validationService = new StatusValidationService();
      const validationResult = await validationService.validateIncidentStatusChange(
        incidentId,
        status,
        userId,
        userRole
      );

      res.json({
        success: true,
        data: {
          valid: validationResult.valid,
          error: validationResult.error || null,
          currentStatus: validationResult.currentStatus,
          requestedStatus: status,
          validationDetails: {
            transitionAllowed: validationResult.valid,
            teamAssignmentRequired: validationService.requiresTeamAssignment(status),
            managerAuthRequired: validationService.requiresManagerAuthorization(status),
            requirements: validationResult.valid ? [] : [
              ...(validationService.requiresTeamAssignment(status) ? ['Incident must be assigned to active team'] : []),
              ...(validationService.requiresManagerAuthorization(status) ? ['Manager authorization required'] : [])
            ]
          }
        }
      });
    } catch (error) {
      console.error('Error validating status change:', error);
      res.status(500).json({
        success: false,
        error: 'Status validation failed'
      });
    }
  }
);

/**
 * Get status transition rules and requirements
 */
router.get('/status-rules', async (req, res) => {
  try {
    const validationService = new StatusValidationService();
    
    res.json({
      success: true,
      data: {
        statusTransitions: validationService.statusTransitions,
        statusesRequiringTeamAssignment: validationService.statusesRequiringTeamAssignment,
        statusesRequiringManagerAuth: validationService.statusesRequiringManagerAuth,
        businessRules: {
          minimumTimeBeforeCompletion: '1 hour',
          completionReasonRequired: true,
          cancellationReasonRequired: true,
          managerOnlyCancellation: true,
          teamAssignmentRequiredForProgress: true,
          teamAssignmentRequiredForCompletion: true
        }
      }
    });
  } catch (error) {
    console.error('Error fetching status rules:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch status rules'
    });
  }
});

// =================== AUTOMATED SCHEDULING CONTROL ROUTES ===================

/**
 * Get automated scheduling service status
 */
router.get('/scheduling/status', async (req, res) => {
  try {
    const scheduler = require('../services/AutomatedSchedulingService');
    const status = scheduler.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error fetching scheduling status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Start automated scheduling service
 */
router.post('/scheduling/start', async (req, res) => {
  try {
    const scheduler = require('../services/AutomatedSchedulingService');
    const { interval, dryRunMode, enabled } = req.body;
    
    const options = {};
    if (interval) options.interval = parseInt(interval);
    if (dryRunMode !== undefined) options.dryRunMode = dryRunMode;
    if (enabled !== undefined) options.enabled = enabled;
    
    scheduler.startScheduling(options);
    
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'Started automated scheduling service',
      table_name: 'system',
      reference_id: null,
      details: JSON.stringify({
        type: 'scheduler_start',
        options: options
      })
    });
    
    res.json({
      success: true,
      message: 'Automated scheduling service started',
      data: scheduler.getStatus()
    });
  } catch (error) {
    console.error('Error starting scheduling service:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to start scheduling service' 
    });
  }
});

/**
 * Stop automated scheduling service
 */
router.post('/scheduling/stop', async (req, res) => {
  try {
    const scheduler = require('../services/AutomatedSchedulingService');
    
    scheduler.stopScheduling();
    
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'Stopped automated scheduling service',
      table_name: 'system',
      reference_id: null,
      details: JSON.stringify({
        type: 'scheduler_stop'
      })
    });
    
    res.json({
      success: true,
      message: 'Automated scheduling service stopped',
      data: scheduler.getStatus()
    });
  } catch (error) {
    console.error('Error stopping scheduling service:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to stop scheduling service' 
    });
  }
});

/**
 * Manually trigger scheduling cycle
 */
router.post('/scheduling/trigger', async (req, res) => {
  try {
    const scheduler = require('../services/AutomatedSchedulingService');
    const { dryRun } = req.body;
    
    const result = await scheduler.triggerManualAssignment({ dryRun });
    
    res.json({
      success: true,
      message: dryRun ? 'Manual scheduling cycle completed (dry run)' : 'Manual scheduling cycle completed',
      data: result
    });
  } catch (error) {
    console.error('Error triggering manual scheduling:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to trigger manual scheduling cycle' 
    });
  }
});

/**
 * Update scheduling configuration
 */
router.post('/scheduling/config', async (req, res) => {
  try {
    const scheduler = require('../services/AutomatedSchedulingService');
    const { interval, maxConcurrentAssignments, priorityOrder, emergencyAssignment } = req.body;
    
    const newConfig = {};
    if (interval) newConfig.interval = parseInt(interval);
    if (maxConcurrentAssignments) newConfig.maxConcurrentAssignments = parseInt(maxConcurrentAssignments);
    if (priorityOrder) newConfig.priorityOrder = priorityOrder;
    if (emergencyAssignment !== undefined) newConfig.emergencyAssignment = emergencyAssignment;
    
    scheduler.updateConfig(newConfig);
    
    await ActivityLog.create({
      user_id: req.user.id,
      action: 'Updated automated scheduling configuration',
      table_name: 'system',
      reference_id: null,
      details: JSON.stringify({
        type: 'scheduler_config_update',
        newConfig: newConfig
      })
    });
    
    res.json({
      success: true,
      message: 'Scheduling configuration updated',
      data: scheduler.getStatus()
    });
  } catch (error) {
    console.error('Error updating scheduling config:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to update scheduling configuration' 
    });
  }
});

module.exports = router;