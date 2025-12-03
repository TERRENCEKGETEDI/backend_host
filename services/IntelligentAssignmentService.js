const { Team, TeamMember, JobCard, Incident, ActivityLog, User } = require('../models');
const { Op } = require('sequelize');

class IntelligentAssignmentService {
  constructor() {
    this.SLA_TARGETS = {
      critical: 4 * 60 * 60 * 1000, // 4 hours in milliseconds
      high: 8 * 60 * 60 * 1000,     // 8 hours
      medium: 24 * 60 * 60 * 1000,  // 24 hours
      low: 48 * 60 * 60 * 1000      // 48 hours
    };
  }

  /**
   * Get all available teams with their current workload and capacity information
   * @param {string} managerId - The manager's ID
   * @returns {Promise<Array>} Teams with detailed capacity and workload information
   */
  async getAvailableTeams(managerId) {
    try {
      const teams = await Team.findAll({
        where: { manager_id: managerId },
        include: [
          {
            model: JobCard,
            required: false,
            where: {
              status: {
                [Op.ne]: 'completed'
              }
            }
          },
          {
            model: TeamMember,
            include: [{
              model: User,
              where: { status: 'active' },
              required: false
            }]
          }
        ]
      });

      // Update current capacity and filter available teams
      const updatedTeams = await Promise.all(teams.map(async (team) => {
        const currentCapacity = team.JobCards?.length || 0;
        const memberCount = team.TeamMembers?.filter(tm => tm.User?.status === 'active').length || 0;
        
        // Update current capacity if changed
        if (team.current_capacity !== currentCapacity) {
          await team.update({ 
            current_capacity: currentCapacity,
            last_activity: new Date()
          });
        }

        // Calculate availability
        const isAvailable = team.is_available && 
                           currentCapacity < team.max_capacity &&
                           (!team.available_from || new Date() >= team.available_from);

        return {
          id: team.id,
          name: team.name,
          isAvailable,
          currentCapacity,
          maxCapacity: team.max_capacity,
          priorityLevel: team.priority_level,
          memberCount,
          lastActivity: team.last_activity,
          availableFrom: team.available_from,
          utilizationRate: team.max_capacity > 0 ? (currentCapacity / team.max_capacity) : 0,
          totalJobs: team.JobCards?.length || 0,
          activeJobs: team.JobCards?.filter(jc => jc.status === 'in_progress').length || 0,
          pendingJobs: team.JobCards?.filter(jc => jc.status === 'not_started').length || 0
        };
      }));

      return updatedTeams;
    } catch (error) {
      console.error('Error fetching available teams:', error);
      throw error;
    }
  }

  /**
   * Multi-tiered team selection algorithm
   * @param {Array} availableTeams - Teams available for assignment
   * @param {Object} incident - The incident to assign
   * @returns {Promise<Object>} Selected team with assignment details
   */
  async selectBestTeam(availableTeams, incident) {
    try {
      // Tier 1: Filter teams by availability and capacity
      let eligibleTeams = availableTeams.filter(team => 
        team.isAvailable && 
        team.currentCapacity < team.maxCapacity &&
        team.memberCount > 0
      );

      if (eligibleTeams.length === 0) {
        throw new Error('No eligible teams available for assignment');
      }

      // Tier 2: Apply capacity-based weighting
      const weightedTeams = eligibleTeams.map(team => ({
        ...team,
        // Lower capacity = higher weight
        capacityWeight: team.maxCapacity - team.currentCapacity,
        // Lower utilization rate = higher weight
        utilizationWeight: 1 - team.utilizationRate,
        // Higher priority level = higher weight
        priorityWeight: team.priorityLevel
      }));

      // Tier 3: Calculate final selection score
      const scoredTeams = weightedTeams.map(team => {
        // Weighted scoring: capacity (50%), utilization (30%), priority (20%)
        const score = (
          (team.capacityWeight / Math.max(...weightedTeams.map(t => t.capacityWeight))) * 0.5 +
          (team.utilizationWeight / Math.max(...weightedTeams.map(t => t.utilizationWeight))) * 0.3 +
          (team.priorityWeight / Math.max(...weightedTeams.map(t => t.priorityWeight))) * 0.2
        );

        return { ...team, score };
      });

      // Tier 4: Randomized tiebreaker for equivalent workloads
      const maxScore = Math.max(...scoredTeams.map(t => t.score));
      const topTeams = scoredTeams.filter(t => t.score === maxScore);

      const selectedTeam = topTeams[Math.floor(Math.random() * topTeams.length)];

      return selectedTeam;
    } catch (error) {
      console.error('Error in team selection algorithm:', error);
      throw error;
    }
  }

  /**
   * Calculate incident priority level based on SLA requirements
   * @param {Object} incident - The incident to prioritize
   * @returns {string} Priority level (critical, high, medium, low)
   */
  calculateIncidentPriority(incident) {
    try {
      // Check if incident has explicit priority
      if (incident.priority) {
        return incident.priority.toLowerCase();
      }

      // Check for high-priority keywords in title/description
      const highPriorityKeywords = [
        'emergency', 'urgent', 'flood', 'overflow', 'sewage backup',
        'public health', 'environmental', 'contamination'
      ];

      const text = `${incident.title || ''} ${incident.description || ''}`.toLowerCase();
      const hasHighPriorityKeywords = highPriorityKeywords.some(keyword => 
        text.includes(keyword)
      );

      if (hasHighPriorityKeywords) {
        return 'critical';
      }

      // Default to medium priority
      return 'medium';
    } catch (error) {
      console.error('Error calculating incident priority:', error);
      return 'medium'; // Default to medium if calculation fails
    }
  }

  /**
   * Get SLA compliance information for a team
   * @param {string} teamId - The team ID
   * @returns {Promise<Object>} SLA compliance metrics
   */
  async getTeamSLACompliance(teamId) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));

      const jobCards = await JobCard.findAll({
        where: {
          team_id: teamId,
          assigned_at: {
            [Op.gte]: thirtyDaysAgo
          }
        },
        include: [Incident]
      });

      let totalIncidents = 0;
      let slaCompliantIncidents = 0;
      let averageResponseTime = 0;

      for (const job of jobCards) {
        if (job.Incident) {
          totalIncidents++;
          const assignedAt = new Date(job.assigned_at);
          const completedAt = job.completed_at ? new Date(job.completed_at) : new Date();
          const responseTime = completedAt - assignedAt;

          // Calculate priority-based SLA target
          const priority = this.calculateIncidentPriority(job.Incident);
          const slaTarget = this.SLA_TARGETS[priority] || this.SLA_TARGETS.medium;

          if (responseTime <= slaTarget) {
            slaCompliantIncidents++;
          }

          averageResponseTime += responseTime;
        }
      }

      const complianceRate = totalIncidents > 0 ? (slaCompliantIncidents / totalIncidents) * 100 : 0;
      const avgResponseTimeHours = totalIncidents > 0 ? (averageResponseTime / totalIncidents) / (1000 * 60 * 60) : 0;

      return {
        totalIncidents,
        slaCompliantIncidents,
        complianceRate: Math.round(complianceRate),
        averageResponseTime: Math.round(avgResponseTimeHours * 100) / 100, // Round to 2 decimals
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Error calculating SLA compliance:', error);
      throw error;
    }
  }

  /**
   * ENHANCED: Assign an incident to the best available team using strict validation
   * @param {string} incidentId - The incident ID
   * @param {string} managerId - The manager's ID
   * @param {Object} options - Assignment options
   * @returns {Promise<Object>} Assignment result
   */
  async assignIncident(incidentId, managerId, options = {}) {
    try {
      console.log(`STRICT ASSIGNMENT: Manager ${managerId} attempting to assign incident ${incidentId}`);
      
      // Load StatusValidationService for strict validation
      const StatusValidationService = require('./StatusValidationService');
      const validationService = new StatusValidationService();

      // 1. COMPREHENSIVE INCIDENT VALIDATION
      const incident = await Incident.findByPk(incidentId);
      if (!incident) {
        throw new Error(`STRICT ASSIGNMENT FAILED: Incident ${incidentId} not found`);
      }

      // 2. ENHANCED STATUS VALIDATION
      if (incident.status !== 'verified') {
        return {
          success: false,
          error: `STRICT ASSIGNMENT BLOCKED: Incident must be in 'verified' status for assignment. Current status: '${incident.status}'`,
          code: 'INCIDENT_NOT_READY_FOR_ASSIGNMENT',
          currentStatus: incident.status,
          requiredStatus: 'verified',
          incidentDetails: {
            id: incident.id,
            title: incident.title,
            createdAt: incident.created_at
          }
        };
      }

      // 3. STRICT MANAGER AUTHORIZATION VALIDATION
      const managerAuthValidation = await this.validateManagerAuthorization(managerId, incident);
      if (!managerAuthValidation.valid) {
        return {
          success: false,
          error: `STRICT AUTHORIZATION FAILED: ${managerAuthValidation.error}`,
          code: 'MANAGER_AUTHORIZATION_FAILED',
          managerId: managerId,
          incidentId: incidentId
        };
      }

      // 4. COMPREHENSIVE TEAM AVAILABILITY VALIDATION
      const availableTeams = await this.getAvailableTeams(managerId);
      const teamValidation = await this.validateTeamAvailability(availableTeams);
      
      if (!teamValidation.valid) {
        return {
          success: false,
          error: `STRICT TEAM VALIDATION FAILED: ${teamValidation.error}`,
          code: 'NO_VALID_TEAMS_AVAILABLE',
          validationDetails: teamValidation,
          availableTeamsCount: availableTeams.length
        };
      }

      // 5. ENHANCED TEAM SELECTION WITH VALIDATION
      const selectedTeam = await this.selectBestTeamWithValidation(availableTeams, incident, validationService);
      
      if (!selectedTeam) {
        return {
          success: false,
          error: 'STRICT TEAM SELECTION FAILED: No suitable team found for assignment after comprehensive validation',
          code: 'NO_SUITABLE_TEAM_FOUND',
          requirements: {
            teamMustBeAvailable: true,
            teamMustHaveCapacity: true,
            teamMustHaveActiveMembers: true,
            teamMustBeOwnedByManager: true
          }
        };
      }

      // 6. FINAL ASSIGNMENT INTEGRITY CHECK
      const assignmentIntegrity = await this.validateAssignmentIntegrity(incident, selectedTeam, managerId);
      if (!assignmentIntegrity.valid) {
        return {
          success: false,
          error: `ASSIGNMENT INTEGRITY CHECK FAILED: ${assignmentIntegrity.error}`,
          code: 'ASSIGNMENT_INTEGRITY_VIOLATION'
        };
      }

      // 7. PERFORM ASSIGNMENT WITH TRANSACTION SAFETY
      const assignmentResult = await this.performValidatedAssignment(
        incident, 
        selectedTeam, 
        managerId, 
        options
      );

      if (!assignmentResult.success) {
        return assignmentResult;
      }

      // 8. POST-ASSIGNMENT VALIDATION
      const postAssignmentValidation = await this.validatePostAssignment(incident.id, selectedTeam.id);
      if (!postAssignmentValidation.valid) {
        console.error('Post-assignment validation failed:', postAssignmentValidation.error);
        // Don't rollback here, but log the issue
      }

      return {
        success: true,
        jobCard: assignmentResult.jobCard,
        selectedTeam: assignmentResult.selectedTeam,
        priority: assignmentResult.priority,
        slaTarget: assignmentResult.slaTarget,
        validationDetails: {
          preAssignmentValidation: 'PASSED',
          teamSelectionValidation: 'PASSED',
          assignmentIntegrityCheck: 'PASSED',
          postAssignmentValidation: postAssignmentValidation.valid ? 'PASSED' : 'WARNING',
          strictModeEnabled: true,
          timestamp: new Date().toISOString()
        },
        message: `Incident successfully assigned to team ${selectedTeam.name} with comprehensive validation`
      };
      
    } catch (error) {
      console.error('Error in strict intelligent assignment:', error);
      return {
        success: false,
        error: `STRICT ASSIGNMENT SYSTEM ERROR: ${error.message}`,
        code: 'ASSIGNMENT_SYSTEM_ERROR',
        technicalDetails: error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validate manager authorization for assignment operations
   * @param {string} managerId - Manager ID
   * @param {Object} incident - Incident object
   * @returns {Promise<Object>} Validation result
   */
  async validateManagerAuthorization(managerId, incident) {
    try {
      // Verify manager exists and is active
      const manager = await User.findOne({
        where: { 
          id: managerId, 
          role: 'manager',
          status: 'active'
        }
      });

      if (!manager) {
        return {
          valid: false,
          error: `Manager ${managerId} not found, inactive, or not a manager role`
        };
      }

      // Verify manager owns teams that can be used for assignment
      const teams = await Team.findAll({
        where: { 
          manager_id: managerId,
          is_available: true
        },
        include: [{
          model: TeamMember,
          include: [{
            model: User,
            where: { status: 'active' }
          }]
        }]
      });

      if (teams.length === 0) {
        return {
          valid: false,
          error: `Manager ${managerId} has no available teams for assignment`
        };
      }

      return { valid: true, manager, availableTeams: teams };
      
    } catch (error) {
      return {
        valid: false,
        error: `Manager authorization validation error: ${error.message}`
      };
    }
  }

  /**
   * Validate team availability with strict requirements
   * @param {Array} availableTeams - Teams to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateTeamAvailability(availableTeams) {
    const validTeams = [];
    const validationErrors = [];

    for (const team of availableTeams) {
      const teamValidation = await this.validateSingleTeam(team);
      
      if (teamValidation.valid) {
        validTeams.push(team);
      } else {
        validationErrors.push({
          teamId: team.id,
          teamName: team.name,
          issues: teamValidation.issues
        });
      }
    }

    if (validTeams.length === 0) {
      return {
        valid: false,
        error: `No teams available for assignment. Validation failures: ${validationErrors.map(e => `${e.teamName}: ${e.issues.join(', ')}`).join('; ')}`,
        failedTeams: validationErrors
      };
    }

    return {
      valid: true,
      availableTeams: validTeams,
      totalTeamsChecked: availableTeams.length,
      validTeamsCount: validTeams.length,
      failedTeamsCount: validationErrors.length
    };
  }

  /**
   * Validate a single team for assignment eligibility
   * @param {Object} team - Team to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateSingleTeam(team) {
    const issues = [];

    // Check team availability
    if (!team.isAvailable) {
      issues.push('Team is not available');
    }

    // Check capacity
    if (team.currentCapacity >= team.maxCapacity) {
      issues.push(`Team at capacity (${team.currentCapacity}/${team.maxCapacity})`);
    }

    // Check member count
    if (team.memberCount === 0) {
      issues.push('Team has no active members');
    }

    // Check last activity (optional - teams inactive for > 24 hours)
    if (team.lastActivity) {
      const hoursSinceActivity = (Date.now() - new Date(team.lastActivity)) / (1000 * 60 * 60);
      if (hoursSinceActivity > 24) {
        issues.push(`Team inactive for ${Math.round(hoursSinceActivity)} hours`);
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues,
      teamId: team.id,
      teamName: team.name
    };
  }

  /**
   * Enhanced team selection with comprehensive validation
   * @param {Array} availableTeams - Available teams
   * @param {Object} incident - Incident to assign
   * @param {Object} validationService - Status validation service
   * @returns {Promise<Object>} Selected team
   */
  async selectBestTeamWithValidation(availableTeams, incident, validationService) {
    try {
      // Filter teams that pass strict validation
      const validTeams = [];
      
      for (const team of availableTeams) {
        const teamValidation = await this.validateSingleTeam(team);
        if (teamValidation.valid) {
          validTeams.push(team);
        }
      }

      if (validTeams.length === 0) {
        throw new Error('No teams passed strict validation requirements');
      }

      // Apply original selection algorithm to validated teams
      const selectedTeam = await this.selectBestTeam(validTeams, incident);
      
      if (!selectedTeam) {
        throw new Error('Team selection algorithm failed to find suitable team');
      }

      // Additional validation for selected team
      const finalValidation = await this.validateSingleTeam(selectedTeam);
      if (!finalValidation.valid) {
        throw new Error(`Selected team failed final validation: ${finalValidation.issues.join(', ')}`);
      }

      return selectedTeam;
      
    } catch (error) {
      console.error('Error in validated team selection:', error);
      throw error;
    }
  }

  /**
   * Validate assignment integrity before performing assignment
   * @param {Object} incident - Incident object
   * @param {Object} selectedTeam - Selected team object
   * @param {string} managerId - Manager ID
   * @returns {Promise<Object>} Validation result
   */
  async validateAssignmentIntegrity(incident, selectedTeam, managerId) {
    try {
      // Check if incident is already assigned
      if (incident.assigned_team_id) {
        return {
          valid: false,
          error: `Incident ${incident.id} is already assigned to team ${incident.assigned_team_id}`
        };
      }

      // Verify team ownership
      if (selectedTeam.manager_id && selectedTeam.manager_id !== managerId) {
        return {
          valid: false,
          error: `Team ${selectedTeam.id} is owned by manager ${selectedTeam.manager_id}, not ${managerId}`
        };
      }

      // Check for conflicting assignments
      const existingJobCard = await JobCard.findOne({
        where: {
          incident_id: incident.id,
          team_id: selectedTeam.id
        }
      });

      if (existingJobCard) {
        return {
          valid: false,
          error: `Job card already exists for incident ${incident.id} and team ${selectedTeam.id}`
        };
      }

      return { valid: true };
      
    } catch (error) {
      return {
        valid: false,
        error: `Assignment integrity validation error: ${error.message}`
      };
    }
  }

  /**
   * Perform the actual assignment with transaction safety
   * @param {Object} incident - Incident object
   * @param {Object} selectedTeam - Selected team object
   * @param {string} managerId - Manager ID
   * @param {Object} options - Assignment options
   * @returns {Promise<Object>} Assignment result
   */
  async performValidatedAssignment(incident, selectedTeam, managerId, options = {}) {
    const { Op } = require('sequelize');
    
    try {
      // Calculate priority and SLA target
      const priority = this.calculateIncidentPriority(incident);
      const slaTarget = this.SLA_TARGETS[priority];

      // Perform assignment in a transaction-like manner
      const jobCard = await JobCard.create({
        incident_id: incident.id,
        team_id: selectedTeam.id,
        team_leader_id: null,
        status: 'not_started',
        assigned_at: new Date()
      });

      // Update team capacity
      await Team.update(
        { 
          current_capacity: selectedTeam.currentCapacity + 1,
          last_activity: new Date()
        },
        { where: { id: selectedTeam.id } }
      );

      // Create worker progress for each team member
      const teamMembers = await TeamMember.findAll({
        where: { team_id: selectedTeam.id },
        include: [{
          model: User,
          where: { status: 'active' }
        }]
      });

      for (const member of teamMembers) {
        await require('../models/WorkerProgress').create({
          job_card_id: jobCard.id,
          worker_id: member.user_id,
          status: 'pending'
        });
      }

      // Update incident
      await incident.update({
        status: 'In Progress',
        assigned_team_id: selectedTeam.id,
        assigned_at: new Date(),
        priority: priority
      });

      // Log activity
      await ActivityLog.create({
        user_id: managerId,
        action: `Validated assignment: team ${selectedTeam.name} to incident "${incident.title}"`,
        table_name: 'job_cards',
        reference_id: jobCard.id,
        details: JSON.stringify({
          type: 'validated_assignment',
          selectedTeam: selectedTeam.name,
          capacityBefore: selectedTeam.currentCapacity,
          capacityAfter: selectedTeam.currentCapacity + 1,
          priority: priority,
          slaTarget: slaTarget,
          validationPassed: true,
          assignmentTimestamp: new Date().toISOString()
        })
      });

      return {
        success: true,
        jobCard,
        selectedTeam,
        priority,
        slaTarget
      };
      
    } catch (error) {
      console.error('Error performing validated assignment:', error);
      return {
        success: false,
        error: `Assignment execution failed: ${error.message}`,
        code: 'ASSIGNMENT_EXECUTION_ERROR'
      };
    }
  }

  /**
   * Validate assignment after completion
   * @param {string} incidentId - Incident ID
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Validation result
   */
  async validatePostAssignment(incidentId, teamId) {
    try {
      const incident = await Incident.findByPk(incidentId, {
        include: [{
          model: JobCard,
          where: { team_id: teamId }
        }]
      });

      if (!incident) {
        return { valid: false, error: 'Incident not found after assignment' };
      }

      if (incident.status !== 'assigned') {
        return { valid: false, error: `Incident status is '${incident.status}', expected 'assigned'` };
      }

      if (incident.assigned_team_id !== teamId) {
        return { valid: false, error: 'Team assignment mismatch after assignment' };
      }

      if (!incident.JobCards || incident.JobCards.length === 0) {
        return { valid: false, error: 'No job card found after assignment' };
      }

      return { valid: true };
      
    } catch (error) {
      return {
        valid: false,
        error: `Post-assignment validation error: ${error.message}`
      };
    }
  }

  /**
   * Get assignment analytics and performance metrics
   * @param {string} managerId - The manager's ID
   * @returns {Promise<Object>} Analytics data
   */
  async getAssignmentAnalytics(managerId) {
    try {
      const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

      const teams = await this.getAvailableTeams(managerId);
      
      // Calculate analytics for each team
      const teamAnalytics = await Promise.all(teams.map(async (team) => {
        const slaCompliance = await this.getTeamSLACompliance(team.id);
        
        return {
          teamId: team.id,
          teamName: team.name,
          capacityUtilization: Math.round(team.utilizationRate * 100),
          currentLoad: team.currentCapacity,
          maxCapacity: team.maxCapacity,
          memberCount: team.memberCount,
          slaCompliance: slaCompliance.complianceRate,
          averageResponseTime: slaCompliance.averageResponseTime
        };
      }));

      // Overall system metrics
      const totalTeams = teams.length;
      const availableTeams = teams.filter(t => t.isAvailable).length;
      const averageUtilization = totalTeams > 0 
        ? Math.round(teams.reduce((sum, t) => sum + t.utilizationRate, 0) / totalTeams * 100)
        : 0;

      return {
        totalTeams,
        availableTeams,
        averageUtilization,
        teamAnalytics,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Error fetching assignment analytics:', error);
      throw error;
    }
  }
}

module.exports = IntelligentAssignmentService;