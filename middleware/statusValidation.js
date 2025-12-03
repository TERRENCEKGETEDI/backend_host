const StatusValidationService = require('../services/StatusValidationService');

/**
 * Status Validation Middleware
 * Enforces business logic constraints for incident status changes
 * Ensures incidents cannot transition to progress/completed without team assignment
 * Requires manager authorization for critical status modifications
 */
class StatusValidationMiddleware {
  constructor() {
    this.validationService = new StatusValidationService();
  }

  /**
   * Validate incident status change
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async validateIncidentStatusChange(req, res, next) {
    try {
      const { incidentId } = req.params;
      const { status, reason } = req.body;
      const { id: userId, role: userRole } = req.user;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required'
        });
      }

      const validationService = new StatusValidationService();
      const validationResult = await validationService.validateIncidentStatusChange(
        incidentId,
        status,
        userId,
        userRole
      );

      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: validationResult.error,
          validationDetails: {
            currentStatus: validationResult.currentStatus,
            requestedStatus: status,
            requiresTeamAssignment: validationService.requiresTeamAssignment(status),
            requiresManagerAuth: validationService.requiresManagerAuthorization(status)
          }
        });
      }

      // Store validation result for use in route handler
      req.statusValidation = {
        result: validationResult,
        reason: reason || 'Status change via API'
      };

      next();
    } catch (error) {
      console.error('Error in status validation middleware:', error);
      res.status(500).json({
        success: false,
        error: 'Status validation failed'
      });
    }
  }

  /**
   * Validate that incident can be marked as In Progress
   * Requires team assignment and proper authorization
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async validateInProgressTransition(req, res, next) {
    try {
      const { incidentId } = req.params;
      const { id: userId, role: userRole } = req.user;

      const validationService = new StatusValidationService();
      const validationResult = await validationService.validateIncidentStatusChange(
        incidentId,
        'In Progress',
        userId,
        userRole
      );

      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: validationResult.error,
          code: 'INVALID_IN_PROGRESS_TRANSITION',
          details: {
            requirements: [
              'Incident must be assigned to an active team',
              'Team must have active members',
              'Proper manager authorization required'
            ]
          }
        });
      }

      req.statusValidation = {
        result: validationResult,
        reason: 'Marked as In Progress'
      };

      next();
    } catch (error) {
      console.error('Error validating In Progress transition:', error);
      res.status(500).json({
        success: false,
        error: 'In Progress validation failed'
      });
    }
  }

  /**
   * Validate that incident can be marked as Completed
   * Most restrictive validation - requires team assignment, proper timing, and authorization
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async validateCompletedTransition(req, res, next) {
    try {
      const { incidentId } = req.params;
      const { id: userId, role: userRole } = req.user;
      const { reason } = req.body;

      const validationService = new StatusValidationService();
      const validationResult = await validationService.validateIncidentStatusChange(
        incidentId,
        'Completed',
        userId,
        userRole
      );

      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: validationResult.error,
          code: 'INVALID_COMPLETION_TRANSITION',
          details: {
            requirements: [
              'Incident must be assigned to an active team',
              'Team must have active members with proper job card',
              'Incident must have been In Progress for at least 1 hour',
              'Manager authorization required',
              'Valid business justification required'
            ],
            providedReason: reason
          }
        });
      }

      // Additional validation for completion reason
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({
          success: false,
          error: 'Completion reason is required and must be at least 10 characters',
          code: 'INCOMPLETE_COMPLETION_REASON'
        });
      }

      req.statusValidation = {
        result: validationResult,
        reason: reason
      };

      next();
    } catch (error) {
      console.error('Error validating Completed transition:', error);
      res.status(500).json({
        success: false,
        error: 'Completion validation failed'
      });
    }
  }

  /**
   * Validate that incident can be cancelled
   * Requires manager authorization and valid reason
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async validateCancelledTransition(req, res, next) {
    try {
      const { incidentId } = req.params;
      const { id: userId, role: userRole } = req.user;
      const { reason } = req.body;

      // Only managers and admins can cancel incidents
      if (!['manager', 'admin'].includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Only managers and admins can cancel incidents',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      const validationService = new StatusValidationService();
      const validationResult = await validationService.validateIncidentStatusChange(
        incidentId,
        'Cancelled',
        userId,
        userRole
      );

      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: validationResult.error,
          code: 'INVALID_CANCELLATION_TRANSITION'
        });
      }

      // Cancellation requires a detailed reason
      if (!reason || reason.trim().length < 15) {
        return res.status(400).json({
          success: false,
          error: 'Cancellation reason is required and must be at least 15 characters',
          code: 'INCOMPLETE_CANCELLATION_REASON'
        });
      }

      req.statusValidation = {
        result: validationResult,
        reason: reason
      };

      next();
    } catch (error) {
      console.error('Error validating Cancelled transition:', error);
      res.status(500).json({
        success: false,
        error: 'Cancellation validation failed'
      });
    }
  }

  /**
   * Get status progression recommendations for an incident
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async getStatusProgression(req, res, next) {
    try {
      const { incidentId } = req.params;

      const { Incident, JobCard, Team } = require('../models');
      const incident = await Incident.findByPk(incidentId, {
        include: [{
          model: JobCard,
          include: [Team]
        }]
      });

      if (!incident) {
        return res.status(404).json({
          success: false,
          error: 'Incident not found'
        });
      }

      const validationService = new StatusValidationService();
      const recommendations = validationService.getStatusProgressionRecommendations(
        incident.status,
        incident
      );

      res.json({
        success: true,
        data: {
          incident: {
            id: incident.id,
            title: incident.title,
            currentStatus: incident.status,
            assignedTeam: incident.assigned_team_id ? {
              id: incident.assigned_team_id,
              name: incident.JobCards?.[0]?.Team?.name || 'Unknown Team'
            } : null
          },
          recommendations
        }
      });
    } catch (error) {
      console.error('Error getting status progression:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get status progression recommendations'
      });
    }
  }

  /**
   * ENHANCED: Middleware to check if status change requires manager authorization with stricter validation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async requireManagerAuthForStatus(req, res, next) {
    try {
      const { status } = req.body;
      const { role: userRole } = req.user;

      const validationService = new StatusValidationService();
      
      if (validationService.requiresManagerAuthorization(status)) {
        if (!['manager', 'admin'].includes(userRole)) {
          return res.status(403).json({
            success: false,
            error: `STRICT AUTHORIZATION DENIED: Status '${status}' requires manager or admin authorization. Current role: ${userRole}`,
            code: 'MANAGER_AUTHORIZATION_REQUIRED',
            requiredRole: ['manager', 'admin'],
            currentRole: userRole,
            statusRequiringAuth: status
          });
        }

        // Additional authorization check for managers
        if (userRole === 'manager') {
          const { incidentId } = req.params;
          if (incidentId) {
            const validationResult = await validationService.validateManagerAuthorization(
              { id: incidentId }, req.user.id, userRole
            );
            if (!validationResult.valid) {
              return res.status(403).json({
                success: false,
                error: `STRICT MANAGER AUTHORIZATION FAILED: ${validationResult.error}`,
                code: 'MANAGER_TEAM_AUTHORIZATION_FAILED',
                managerId: req.user.id
              });
            }
          }
        }
      }

      next();
    } catch (error) {
      console.error('Error checking manager authorization requirement:', error);
      res.status(500).json({
        success: false,
        error: 'Enhanced authorization check failed',
        code: 'AUTHORIZATION_SYSTEM_ERROR'
      });
    }
  }

  /**
   * AUTOMATED PROGRESSION VALIDATION: Ensure incidents follow proper progression
   * This middleware enforces that incidents cannot skip required status steps
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async validateAutomatedProgression(req, res, next) {
    try {
      const { status: newStatus } = req.body;
      const { incidentId } = req.params;
      
      if (!incidentId || !newStatus) {
        return next(); // Skip validation if essential params missing
      }

      const { Incident } = require('../models');
      const incident = await Incident.findByPk(incidentId);
      
      if (!incident) {
        return res.status(404).json({
          success: false,
          error: 'Incident not found for automated progression validation'
        });
      }

      const currentStatus = incident.status;
      const validationService = new StatusValidationService();
      
      // Check if this is a direct progression attempt
      const isDirectProgression = validationService.validateStatusTransition(currentStatus, newStatus);
      
      if (!isDirectProgression.valid) {
        return res.status(400).json({
          success: false,
          error: `AUTOMATED PROGRESSION BLOCKED: Cannot transition directly from '${currentStatus}' to '${newStatus}'. Required progression steps must be followed.`,
          code: 'INVALID_DIRECT_PROGRESSION',
          currentStatus,
          requestedStatus: newStatus,
          validTransitions: validationService.getValidTransitions(currentStatus),
          requiredSteps: this.getRequiredProgressionSteps(currentStatus, newStatus)
        });
      }

      // Additional validation for team assignment requirements
      if (validationService.requiresTeamAssignment(newStatus)) {
        const strictValidation = await validationService.validateStrictTeamAssignment(incident, newStatus);
        if (!strictValidation.valid) {
          return res.status(400).json({
            success: false,
            error: strictValidation.error,
            code: strictValidation.code || 'TEAM_ASSIGNMENT_VALIDATION_FAILED',
            requirements: strictValidation.requirements,
            currentStatus,
            requestedStatus: newStatus
          });
        }
      }

      next();
    } catch (error) {
      console.error('Error in automated progression validation:', error);
      res.status(500).json({
        success: false,
        error: 'Automated progression validation failed',
        code: 'AUTOMATED_VALIDATION_ERROR'
      });
    }
  }

  /**
   * STRICT TEAM ASSIGNMENT VALIDATION: Enforce team assignment before status changes
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async requireStrictTeamAssignment(req, res, next) {
    try {
      const { status: newStatus } = req.body;
      const { incidentId } = req.params;
      
      if (!newStatus) {
        return next(); // No status to validate
      }

      const validationService = new StatusValidationService();
      
      if (!validationService.requiresTeamAssignment(newStatus)) {
        return next(); // This status doesn't require team assignment
      }

      if (!incidentId) {
        return res.status(400).json({
          success: false,
          error: 'Incident ID required for team assignment validation',
          code: 'INCIDENT_ID_REQUIRED'
        });
      }

      const { Incident } = require('../models');
      const incident = await Incident.findByPk(incidentId, {
        include: [{
          model: require('../models/JobCard'),
          include: [{
            model: require('../models/Team'),
            include: [{
              model: require('../models/TeamMember'),
              include: [require('../models/User')]
            }]
          }]
        }]
      });

      if (!incident) {
        return res.status(404).json({
          success: false,
          error: 'Incident not found for team assignment validation'
        });
      }

      const strictValidation = await validationService.validateStrictTeamAssignment(incident, newStatus);
      
      if (!strictValidation.valid) {
        return res.status(400).json({
          success: false,
          error: `STRICT TEAM ASSIGNMENT VALIDATION FAILED: ${strictValidation.error}`,
          code: strictValidation.code || 'STRICT_TEAM_VALIDATION_FAILED',
          validationDetails: {
            incidentId: incident.id,
            currentStatus: incident.status,
            requestedStatus: newStatus,
            hasTeamAssignment: !!incident.assigned_team_id,
            teamAssignmentRequired: true
          },
          nextSteps: this.getTeamAssignmentSteps(incident)
        });
      }

      // Store validation result for route handler
      req.teamAssignmentValidation = strictValidation;
      next();
      
    } catch (error) {
      console.error('Error in strict team assignment validation:', error);
      res.status(500).json({
        success: false,
        error: 'Strict team assignment validation failed',
        code: 'TEAM_VALIDATION_SYSTEM_ERROR'
      });
    }
  }

  /**
   * VALIDATION ORCHESTRATOR: Coordinate all validation layers
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async orchestrateValidation(req, res, next) {
    try {
      const { status: newStatus } = req.body;
      const { incidentId } = req.params;
      
      if (!newStatus || !incidentId) {
        return next(); // Skip if essential params missing
      }

      const validationService = new StatusValidationService();
      
      // Get comprehensive incident data
      const { Incident } = require('../models');
      const incident = await Incident.findByPk(incidentId, {
        include: [{
          model: require('../models/JobCard'),
          include: [{
            model: require('../models/Team'),
            include: [{
              model: require('../models/TeamMember'),
              include: [require('../models/Status')]
            }]
          }]
        }]
      });

      if (!incident) {
        return res.status(404).json({
          success: false,
          error: 'Incident not found for comprehensive validation'
        });
      }

      // Run comprehensive validation
      const validationResult = await validationService.validateIncidentStatusChange(
        incidentId, newStatus, req.user.id, req.user.role
      );

      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: validationResult.error,
          code: validationResult.code || 'COMPREHENSIVE_VALIDATION_FAILED',
          validationStage: validationResult.validationStage,
          incidentDetails: {
            id: incident.id,
            currentStatus: incident.status,
            requestedStatus: newStatus,
            hasTeamAssignment: !!incident.assigned_team_id
          },
          requirements: validationResult.requirements,
          remediationSteps: this.getRemediationSteps(validationResult, incident)
        });
      }

      // Store comprehensive validation result
      req.comprehensiveValidation = validationResult;
      next();
      
    } catch (error) {
      console.error('Error in validation orchestration:', error);
      res.status(500).json({
        success: false,
        error: 'Validation orchestration failed',
        code: 'VALIDATION_ORCHESTRATION_ERROR'
      });
    }
  }

  /**
   * Get required progression steps between statuses
   * @param {string} fromStatus - Starting status
   * @param {string} toStatus - Target status
   * @returns {Array} Required progression steps
   */
  static getRequiredProgressionSteps(fromStatus, toStatus) {
    const progressionMap = {
      'Not Started': {
        'verified': [],
        'assigned': ['verified'],
        'In Progress': ['verified', 'assigned'],
        'Completed': ['verified', 'assigned', 'In Progress']
      },
      'verified': {
        'assigned': [],
        'In Progress': ['assigned'],
        'Completed': ['assigned', 'In Progress']
      },
      'assigned': {
        'In Progress': [],
        'Completed': ['In Progress']
      }
    };

    return progressionMap[fromStatus]?.[toStatus] || ['Required progression steps not defined'];
  }

  /**
   * Get team assignment steps for incident
   * @param {Object} incident - Incident object
   * @returns {Array} Steps to complete team assignment
   */
  static getTeamAssignmentSteps(incident) {
    const steps = [];
    
    if (!incident.assigned_team_id) {
      steps.push('Assign incident to an active team');
    }
    
    if (incident.assigned_team_id && (!incident.JobCards || incident.JobCards.length === 0)) {
      steps.push('Create job card for assigned incident');
    }
    
    const team = incident.JobCards?.[0]?.Team;
    if (team && !team.is_available) {
      steps.push('Make assigned team available');
    }
    
    if (team && (!team.TeamMembers || team.TeamMembers.length === 0)) {
      steps.push('Add active members to assigned team');
    }
    
    return steps;
  }

  /**
   * Get remediation steps based on validation failure
   * @param {Object} validationResult - Validation result
   * @param {Object} incident - Incident object
   * @returns {Array} Remediation steps
   */
  static getRemediationSteps(validationResult, incident) {
    const steps = [];
    
    switch (validationResult.code) {
      case 'TEAM_ASSIGNMENT_REQUIRED':
        steps.push('Assign incident to an active team');
        steps.push('Ensure team has active members');
        steps.push('Verify team capacity is available');
        break;
      case 'TEAM_UNAVAILABLE':
        steps.push('Make assigned team available');
        break;
      case 'TEAM_AT_CAPACITY':
        steps.push('Reduce team load or increase capacity');
        break;
      case 'TEAM_NO_ACTIVE_MEMBERS':
        steps.push('Add active members to team');
        break;
      case 'JOB_CARD_REQUIRED':
        steps.push('Create job card for incident');
        break;
      case 'INVALID_TRANSITION':
        steps.push(`Follow proper progression: ${this.getRequiredProgressionSteps(incident.status, validationResult.newStatus || 'target status').join(' → ')}`);
        break;
      default:
        steps.push('Review incident status and requirements');
    }
    
    return steps;
  }

  /**
   * Log unauthorized status change attempt
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async logUnauthorizedAttempt(req, res, next) {
    try {
      const { incidentId } = req.params;
      const { status } = req.body;
      const { id: userId, role: userRole } = req.user;

      const { ActivityLog } = require('../models');
      
      await ActivityLog.create({
        user_id: userId,
        action: `Unauthorized attempt to change incident ${incidentId} status to '${status}'`,
        table_name: 'incidents',
        reference_id: incidentId,
        details: JSON.stringify({
          type: 'unauthorized_status_attempt',
          attemptedStatus: status,
          userRole: userRole,
          requiresManagerAuth: true
        })
      });

      next();
    } catch (error) {
      console.error('Error logging unauthorized attempt:', error);
      // Don't block the request if logging fails
      next();
    }
  }
}

module.exports = StatusValidationMiddleware;