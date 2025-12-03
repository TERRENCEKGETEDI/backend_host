const { Incident, JobCard, Team, TeamMember, User, ActivityLog } = require('../models');
const { Op } = require('sequelize');

/**
 * Status Validation Service
 * Enforces business logic constraints for incident status progression
 * Ensures incidents cannot transition to progress/completed without team assignment
 * Requires manager authorization for all status modifications
 */
class StatusValidationService {
  constructor() {
    // Define valid status progression rules (STRICT)
    this.statusTransitions = {
      // From 'Not Started' can only go to:
      'Not Started': ['verified'],

      // From 'verified' can go to:
      'verified': ['In Progress', 'Completed', 'Cancelled'],

      // From 'In Progress' can go to:
      'In Progress': ['Completed', 'Cancelled'],

      // From 'Completed' can only be:
      'Completed': [], // Terminal state

      // From 'Cancelled' can only be:
      'Cancelled': [] // Terminal state
    };

    // Define which statuses STRICTLY require team assignment
    this.statusesRequiringTeamAssignment = ['assigned', 'In Progress', 'Completed'];
    
    // Define which statuses require manager authorization (EXPANDED)
    this.statusesRequiringManagerAuth = ['verified', 'assigned', 'In Progress', 'Completed', 'Cancelled'];
    
    // Define automated progression requirements
    this.automatedProgressionRequirements = {
      'In Progress': {
        requiresTeamAssignment: true,
        requiresJobCard: true,
        requiresTeamActiveMembers: true,
        minimumTimeSinceAssignment: 0, // minutes
        requiresManagerAuthorization: true
      },
      'Completed': {
        requiresTeamAssignment: true,
        requiresJobCard: true,
        requiresTeamActiveMembers: true,
        minimumTimeSinceAssignment: 60, // 1 hour minimum
        requiresManagerAuthorization: true,
        requiresCompletionReason: true,
        requiresProperStatusProgression: true
      }
    };
  }

  /**
   * Validate if a status transition is allowed
   * @param {string} currentStatus - Current incident status
   * @param {string} newStatus - Desired new status
   * @returns {Object} Validation result
   */
  validateStatusTransition(currentStatus, newStatus) {
    const allowedTransitions = this.statusTransitions[currentStatus] || [];
    
    if (!allowedTransitions.includes(newStatus)) {
      return {
        valid: false,
        error: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(', ') || 'None'}`
      };
    }

    return { valid: true };
  }

  /**
   * Check if status requires team assignment
   * @param {string} status - Status to check
   * @returns {boolean} True if status requires team assignment
   */
  requiresTeamAssignment(status) {
    return this.statusesRequiringTeamAssignment.includes(status);
  }

  /**
   * Check if status requires manager authorization
   * @param {string} status - Status to check
   * @returns {boolean} True if status requires manager authorization
   */
  requiresManagerAuthorization(status) {
    return this.statusesRequiringManagerAuth.includes(status);
  }

  /**
   * Validate incident status change with ENHANCED STRICT BUSINESS RULES
   * @param {string} incidentId - Incident ID
   * @param {string} newStatus - Desired new status
   * @param {string} userId - User attempting the change
   * @param {string} userRole - User role
   * @returns {Promise<Object>} Validation result
   */
  async validateIncidentStatusChange(incidentId, newStatus, userId, userRole) {
    try {
      // Get current incident with comprehensive includes
      const incident = await Incident.findByPk(incidentId, {
        include: [{
          model: JobCard,
          include: [{
            model: Team,
            include: [{
              model: TeamMember,
              include: [User]
            }]
          }]
        }]
      });

      if (!incident) {
        return {
          valid: false,
          error: 'Incident not found',
          code: 'INCIDENT_NOT_FOUND'
        };
      }

      const currentStatus = incident.status;
      
      // 1. STRICT STATUS TRANSITION VALIDATION
      const transitionValidation = this.validateStatusTransition(currentStatus, newStatus);
      if (!transitionValidation.valid) {
        return {
          ...transitionValidation,
          code: transitionValidation.code || 'INVALID_TRANSITION',
          validationStage: 'status_transition'
        };
      }

      // 2. ENHANCED TEAM ASSIGNMENT VALIDATION (CRITICAL FOR PROGRESSION)
      if (this.requiresTeamAssignment(newStatus)) {
        const teamAssignmentValidation = await this.validateTeamAssignment(incident, newStatus);
        if (!teamAssignmentValidation.valid) {
          return {
            ...teamAssignmentValidation,
            validationStage: 'team_assignment_validation'
          };
        }
      }

      // 3. ENHANCED MANAGER AUTHORIZATION VALIDATION
      if (this.requiresManagerAuthorization(newStatus)) {
        const authValidation = await this.validateManagerAuthorization(incident, userId, userRole);
        if (!authValidation.valid) {
          return {
            ...authValidation,
            validationStage: 'manager_authorization'
          };
        }
      }

      // 4. COMPREHENSIVE BUSINESS RULE VALIDATIONS
      const businessRuleValidation = await this.validateBusinessRules(incident, newStatus, userId);
      if (!businessRuleValidation.valid) {
        return {
          ...businessRuleValidation,
          validationStage: 'business_rules'
        };
      }

      // 5. AUTOMATED PROGRESSION REQUIREMENTS VALIDATION
      const automatedValidation = await this.validateAutomatedProgressionRequirements(incident, newStatus, userId);
      if (!automatedValidation.valid) {
        return {
          ...automatedValidation,
          validationStage: 'automated_requirements'
        };
      }

      // 6. ENHANCED DATA INTEGRITY VALIDATION
      const integrityValidation = await this.validateDataIntegrity(incident, newStatus);
      if (!integrityValidation.valid) {
        return {
          ...integrityValidation,
          validationStage: 'data_integrity'
        };
      }

      // SUCCESS VALIDATION RESULT
      return {
        valid: true,
        incident,
        currentStatus,
        newStatus,
        validationStage: 'complete',
        validationDetails: {
          transitionAllowed: true,
          teamAssignmentRequired: this.requiresTeamAssignment(newStatus),
          managerAuthRequired: this.requiresManagerAuthorization(newStatus),
          businessRulesPassed: true,
          automatedRequirementsPassed: true,
          dataIntegrityValid: true,
          strictModeEnabled: true,
          validationTimestamp: new Date().toISOString()
        },
        requirements: this.getStatusRequirements(newStatus)
      };

    } catch (error) {
      console.error('Error validating incident status change:', error);
      return {
        valid: false,
        error: 'Critical validation error occurred - system cannot proceed with status change',
        code: 'VALIDATION_SYSTEM_ERROR',
        validationStage: 'system_error',
        technicalDetails: error.message
      };
    }
  }

  /**
   * Validate that incident has proper team assignment with ENHANCED STRICT RULES
   * @param {Object} incident - Incident object with includes
   * @param {string} targetStatus - The status being validated for
   * @returns {Promise<Object>} Validation result
   */
  async validateTeamAssignment(incident, targetStatus = null) {
    const status = targetStatus || incident.status;
    
    // Check if incident has assigned team (CRITICAL REQUIREMENT)
    if (!incident.assigned_team_id) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: Incident must be assigned to an active team before transitioning to '${status}' status. No team assignment found.`,
        code: 'TEAM_ASSIGNMENT_REQUIRED',
        requirements: [
          'Incident must be assigned to an active team',
          `Status '${status}' requires team assignment per business rules`,
          'Assignment must be completed before any status progression'
        ]
      };
    }

    // Check if assigned team is active with COMPREHENSIVE VALIDATION
    const team = await Team.findOne({
      where: { 
        id: incident.assigned_team_id
      },
      include: [{
        model: TeamMember,
        include: [{
          model: User,
          where: { status: 'active' }
        }]
      }]
    });

    if (!team) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: Assigned team ID '${incident.assigned_team_id}' does not exist in the system`,
        code: 'TEAM_NOT_FOUND',
        requirements: [
          'Assigned team must exist in the system',
          'Team assignment must be valid and current'
        ]
      };
    }

    // Check if team is available for operations
    if (!team.is_available) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: Assigned team '${team.name}' is currently unavailable. Team must be marked as available before incident can progress to '${status}' status.`,
        code: 'TEAM_UNAVAILABLE',
        requirements: [
          'Assigned team must be available for assignments',
          'Team availability must be active and current'
        ],
        teamDetails: {
          teamId: team.id,
          teamName: team.name,
          isAvailable: team.is_available
        }
      };
    }

    // Check team capacity (CRITICAL BUSINESS RULE)
    if (team.current_capacity >= team.max_capacity) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: Assigned team '${team.name}' is at maximum capacity (${team.current_capacity}/${team.max_capacity}). Cannot proceed to '${status}' status.`,
        code: 'TEAM_AT_CAPACITY',
        requirements: [
          'Team must have available capacity for incident progression',
          'Current assignments must not exceed team maximum capacity'
        ],
        teamDetails: {
          teamId: team.id,
          teamName: team.name,
          currentCapacity: team.current_capacity,
          maxCapacity: team.max_capacity
        }
      };
    }

    // Check if team has active members (CRITICAL REQUIREMENT)
    const activeMembers = team.TeamMembers ? team.TeamMembers.filter(tm => tm.User && tm.User.status === 'active') : [];
    if (activeMembers.length === 0) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: Assigned team '${team.name}' has no active members. Team must have at least one active member before incident can progress to '${status}' status.`,
        code: 'TEAM_NO_ACTIVE_MEMBERS',
        requirements: [
          'Assigned team must have at least one active member',
          'All team members must be in active status'
        ],
        teamDetails: {
          teamId: team.id,
          teamName: team.name,
          totalMembers: team.TeamMembers ? team.TeamMembers.length : 0,
          activeMembers: activeMembers.length
        }
      };
    }

    // Check if there's a corresponding job card (MANDATORY FOR PROGRESSION)
    const jobCard = incident.JobCards && incident.JobCards[0];
    if (!jobCard) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: No job card found for incident despite team assignment. Job card is mandatory before progressing to '${status}' status.`,
        code: 'JOB_CARD_REQUIRED',
        requirements: [
          'Job card must exist for all team assignments',
          'Job card creation is mandatory during team assignment process'
        ]
      };
    }

    // Validate job card integrity
    if (jobCard.team_id !== incident.assigned_team_id) {
      return {
        valid: false,
        error: `STRICT VALIDATION FAILED: Job card team mismatch. Job card team ID (${jobCard.team_id}) does not match incident team ID (${incident.assigned_team_id})`,
        code: 'JOB_CARD_TEAM_MISMATCH',
        requirements: [
          'Job card team assignment must match incident team assignment',
          'Team assignment integrity must be maintained'
        ]
      };
    }

    // Check team manager authorization (ENHANCED SECURITY)
    if (targetStatus === 'In Progress' || targetStatus === 'Completed') {
      const automatedRequirements = this.automatedProgressionRequirements[targetStatus];
      if (automatedRequirements && automatedRequirements.requiresManagerAuthorization) {
        const teamOwner = await User.findByPk(team.manager_id);
        if (!teamOwner || teamOwner.status !== 'active') {
          return {
            valid: false,
            error: `STRICT VALIDATION FAILED: Team '${team.name}' is not properly managed. Team manager must be active and authorized.`,
            code: 'TEAM_MANAGER_INVALID',
            requirements: [
              'Team must have an active manager',
              'Manager authorization is required for status progression'
            ]
          };
        }
      }
    }

    // Enhanced validation summary
    return {
      valid: true,
      team,
      jobCard,
      validationSummary: {
        teamAssignmentValid: true,
        teamAvailable: team.is_available,
        teamCapacityOk: team.current_capacity < team.max_capacity,
        activeMembersCount: activeMembers.length,
        jobCardValid: !!jobCard,
        teamManagerValid: true,
        requirementsMet: this.getRequirementsSummary(incident, team, jobCard, status)
      }
    };
  }

  /**
   * Get requirements summary for validation feedback
   * @param {Object} incident - Incident object
   * @param {Object} team - Team object
   * @param {Object} jobCard - Job card object
   * @param {string} status - Target status
   * @returns {Object} Requirements summary
   */
  getRequirementsSummary(incident, team, jobCard, status) {
    return {
      status: status,
      incidentAssigned: !!incident.assigned_team_id,
      teamActive: team.is_available,
      teamHasCapacity: team.current_capacity < team.max_capacity,
      teamHasMembers: team.TeamMembers && team.TeamMembers.length > 0,
      jobCardExists: !!jobCard,
      teamAssignmentValid: incident.assigned_team_id === (jobCard ? jobCard.team_id : null)
    };
  }

  /**
   * Validate manager authorization for status change
   * @param {Object} incident - Incident object
   * @param {string} userId - User ID
   * @param {string} userRole - User role
   * @returns {Promise<Object>} Validation result
   */
  async validateManagerAuthorization(incident, userId, userRole) {
    // Only managers and admins can change critical statuses
    if (!['manager', 'admin'].includes(userRole)) {
      return {
        valid: false,
        error: 'Only managers and admins can modify incident status to this level'
      };
    }

    // If it's a manager, verify they own the team
    if (userRole === 'manager') {
      const jobCard = incident.JobCards && incident.JobCards[0];
      if (jobCard && jobCard.Team && jobCard.Team.manager_id !== userId) {
        return {
          valid: false,
          error: 'Manager can only modify incidents assigned to their teams'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate additional business rules
   * @param {Object} incident - Incident object
   * @param {string} newStatus - New status
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Validation result
   */
  async validateBusinessRules(incident, newStatus, userId) {
    // Rule 1: Cannot complete an incident that's already completed
    if (incident.status === 'Completed' && newStatus !== 'Completed') {
      return {
        valid: false,
        error: 'Cannot change status of a completed incident'
      };
    }

    // Rule 2: Cannot cancel a completed incident
    if (incident.status === 'Completed' && newStatus === 'Cancelled') {
      return {
        valid: false,
        error: 'Cannot cancel a completed incident'
      };
    }

    // Rule 3: Ensure proper status progression timing
    if (newStatus === 'In Progress' && incident.status !== 'verified') {
      return {
        valid: false,
        error: 'Incident must be verified before it can be marked as In Progress'
      };
    }

    // Rule 4: Ensure completion requirements
    if (newStatus === 'Completed') {
      if (incident.status !== 'In Progress') {
        return {
          valid: false,
          error: 'Incident must be In Progress before it can be Completed'
        };
      }

      // Check if enough time has passed (minimum 1 hour for any incident)
      const timeAssigned = new Date(incident.assigned_at);
      const now = new Date();
      const hoursSinceAssigned = (now - timeAssigned) / (1000 * 60 * 60);

      if (hoursSinceAssigned < 1) {
        return {
          valid: false,
          error: 'Incident must be assigned for at least 1 hour before completion'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Apply the validated status change
   * @param {string} incidentId - Incident ID
   * @param {string} newStatus - New status
   * @param {Object} validationResult - Validation result
   * @param {string} userId - User ID
   * @param {string} reason - Reason for status change
   * @returns {Promise<Object>} Update result
   */
  async applyStatusChange(incidentId, newStatus, validationResult, userId, reason = '') {
    try {
      const { incident, jobCard } = validationResult;

      // Update incident status
      await incident.update({
        status: newStatus,
        updated_at: new Date()
      });

      // Update job card status if it exists
      if (jobCard) {
        const jobCardUpdates = {
          status: this.mapIncidentStatusToJobCardStatus(newStatus),
          updated_at: new Date()
        };

        // Set specific timestamps
        if (newStatus === 'In Progress' && !jobCard.started_at) {
          jobCardUpdates.started_at = new Date();
        } else if (newStatus === 'Completed' && !jobCard.completed_at) {
          jobCardUpdates.completed_at = new Date();
        }

        await jobCard.update(jobCardUpdates);
      }

      // Log the status change
      await ActivityLog.create({
        user_id: userId,
        action: `Changed incident status from '${validationResult.currentStatus}' to '${newStatus}'`,
        table_name: 'incidents',
        reference_id: incidentId,
        details: JSON.stringify({
          type: 'status_change',
          previousStatus: validationResult.currentStatus,
          newStatus: newStatus,
          reason: reason,
          validationDetails: validationResult.validationDetails,
          teamAssignment: validationResult.team ? {
            teamId: validationResult.team.id,
            teamName: validationResult.team.name
          } : null
        })
      });

      return {
        success: true,
        incident,
        jobCard,
        message: `Incident status successfully changed to '${newStatus}'`
      };

    } catch (error) {
      console.error('Error applying status change:', error);
      return {
        success: false,
        error: 'Failed to apply status change'
      };
    }
  }

  /**
   * Map incident status to job card status
   * @param {string} incidentStatus - Incident status
   * @returns {string} Job card status
   */
  mapIncidentStatusToJobCardStatus(incidentStatus) {
    const statusMapping = {
      'Not Started': 'not_started',
      'verified': 'not_started',
      'assigned': 'not_started',
      'In Progress': 'in_progress',
      'Completed': 'completed',
      'Cancelled': 'completed'
    };

    return statusMapping[incidentStatus] || 'not_started';
  }

  /**
   * Get valid status transitions for a given status
   * @param {string} status - Current status
   * @returns {Array} Array of valid next statuses
   */
  getValidTransitions(status) {
    return this.statusTransitions[status] || [];
  }

  /**
   * Check if status change requires team assignment
   * @param {string} status - Status to check
   * @returns {boolean} True if team assignment is required
   */
  isTeamAssignmentRequired(status) {
    return this.requiresTeamAssignment(status);
  }

  /**
   * Get status progression recommendations
   * @param {string} currentStatus - Current incident status
   * @param {Object} incident - Incident object
   * @returns {Object} Recommendations for next valid actions
   */
  getStatusProgressionRecommendations(currentStatus, incident) {
    const validTransitions = this.getValidTransitions(currentStatus);
    const recommendations = {
      currentStatus,
      validNextStatuses: validTransitions,
      requiresTeamAssignment: this.requiresTeamAssignment(currentStatus),
      requiresManagerAuth: this.requiresManagerAuthorization(currentStatus),
      canProceed: true,
      blockers: []
    };

    // Check for blockers
    if (this.requiresTeamAssignment(currentStatus) && !incident.assigned_team_id) {
      recommendations.canProceed = false;
      recommendations.blockers.push('Incident must be assigned to a team first');
    }

    if (this.requiresManagerAuthorization(currentStatus)) {
      // Additional manager-specific checks could be added here
    }

    return recommendations;
  }

  /**
   * Validate automated progression requirements for strict business rules
   * @param {Object} incident - Incident object
   * @param {string} newStatus - New status
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Validation result
   */
  async validateAutomatedProgressionRequirements(incident, newStatus, userId) {
    const requirements = this.automatedProgressionRequirements[newStatus];
    
    if (!requirements) {
      return { valid: true }; // No specific requirements for this status
    }

    const errors = [];
    
    // Check team assignment requirement
    if (requirements.requiresTeamAssignment && !incident.assigned_team_id) {
      errors.push('Team assignment is required before proceeding to this status');
    }
    
    // Check job card requirement
    if (requirements.requiresJobCard && (!incident.JobCards || incident.JobCards.length === 0)) {
      errors.push('Job card is required for this status progression');
    }
    
    // Check active team members requirement
    if (requirements.requiresTeamActiveMembers && incident.assigned_team_id) {
      const team = incident.JobCards && incident.JobCards[0] && incident.JobCards[0].Team;
      if (team && (!team.TeamMembers || team.TeamMembers.length === 0)) {
        errors.push('Team must have active members for this status progression');
      }
    }
    
    // Check minimum time since assignment
    if (requirements.minimumTimeSinceAssignment > 0 && incident.assigned_at) {
      const timeSinceAssignment = (new Date() - new Date(incident.assigned_at)) / (1000 * 60); // minutes
      if (timeSinceAssignment < requirements.minimumTimeSinceAssignment) {
        errors.push(`Minimum ${requirements.minimumTimeSinceAssignment} minutes must pass since assignment before proceeding to this status`);
      }
    }
    
    // Check proper status progression requirement
    if (requirements.requiresProperStatusProgression) {
      if (newStatus === 'Completed' && incident.status !== 'In Progress') {
        errors.push('Incident must be In Progress before it can be marked as Completed');
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        error: `AUTOMATED PROGRESSION VALIDATION FAILED: ${errors.join('; ')}`,
        code: 'AUTOMATED_REQUIREMENTS_NOT_MET',
        requirements: requirements
      };
    }

    return { valid: true };
  }

  /**
   * Validate data integrity for incident status changes
   * @param {Object} incident - Incident object
   * @param {string} newStatus - New status
   * @returns {Promise<Object>} Validation result
   */
  async validateDataIntegrity(incident, newStatus) {
    const errors = [];
    
    // Check incident status consistency
    if (incident.status === 'Completed' && newStatus !== 'Completed') {
      errors.push('Completed incidents cannot have their status changed');
    }
    
    // Check assigned team consistency
    if (incident.assigned_team_id && newStatus === 'verified') {
      errors.push('Cannot revert to verified status while team is assigned');
    }
    
    // Check job card status consistency
    if (incident.JobCards && incident.JobCards.length > 0) {
      const jobCard = incident.JobCards[0];
      if (jobCard.status === 'completed' && newStatus !== 'Completed') {
        errors.push('Cannot change status of incident with completed job card');
      }
    }
    
    // Validate team assignment integrity
    if (this.requiresTeamAssignment(newStatus) && incident.assigned_team_id) {
      // Verify team assignment timestamp
      if (!incident.assigned_at) {
        errors.push('Team assignment timestamp is missing');
      }
      
      // Verify assigned team still exists
      if (!incident.JobCards || incident.JobCards.length === 0 || 
          incident.JobCards[0].team_id !== incident.assigned_team_id) {
        errors.push('Team assignment integrity check failed');
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        error: `DATA INTEGRITY VALIDATION FAILED: ${errors.join('; ')}`,
        code: 'DATA_INTEGRITY_VIOLATION',
        integrityIssues: errors
      };
    }

    return { valid: true };
  }

  /**
   * Get comprehensive requirements for a specific status
   * @param {string} status - Status to get requirements for
   * @returns {Object} Status requirements
   */
  getStatusRequirements(status) {
    const baseRequirements = {
      status: status,
      requiresManagerAuth: this.requiresManagerAuthorization(status),
      requiresTeamAssignment: this.requiresTeamAssignment(status),
      validTransitionsFrom: this.getValidTransitions(status)
    };

    const automatedRequirements = this.automatedProgressionRequirements[status];
    if (automatedRequirements) {
      return {
        ...baseRequirements,
        automatedRequirements: automatedRequirements
      };
    }

    return baseRequirements;
  }

  /**
   * Enhanced validation for strict team assignment before status changes
   * @param {Object} incident - Incident object
   * @param {string} newStatus - New status
   * @returns {Promise<Object>} Validation result with detailed requirements
   */
  async validateStrictTeamAssignment(incident, newStatus) {
    const requirements = this.getStatusRequirements(newStatus);
    
    if (!requirements.requiresTeamAssignment) {
      return {
        valid: true,
        message: `Status '${newStatus}' does not require team assignment`
      };
    }

    // Check if incident has team assignment
    if (!incident.assigned_team_id) {
      return {
        valid: false,
        error: `STRICT VALIDATION: Status '${newStatus}' REQUIRES team assignment. Incident must be assigned to an active team before this status change is allowed.`,
        code: 'TEAM_ASSIGNMENT_MANDATORY',
        requirements: {
          teamAssignmentRequired: true,
          currentAssignmentStatus: 'none',
          requiredActions: ['Assign incident to active team', 'Ensure team has active members', 'Verify team capacity']
        }
      };
    }

    // Perform comprehensive team validation
    const teamValidation = await this.validateTeamAssignment(incident, newStatus);
    if (!teamValidation.valid) {
      return {
        ...teamValidation,
        code: 'TEAM_VALIDATION_FAILED',
        requirements: requirements
      };
    }

    return {
      valid: true,
      team: teamValidation.team,
      jobCard: teamValidation.jobCard,
      message: `Team assignment validated successfully for status '${newStatus}'`,
      requirements: requirements
    };
  }
}

module.exports = StatusValidationService;