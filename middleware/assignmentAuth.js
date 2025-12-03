const { Team, JobCard, Incident } = require('../models');
const { Op } = require('sequelize');

/**
 * Manager Exclusive Assignment Authorization Middleware
 * Ensures only managers can modify incident assignments TO teams and automated assignments of incidents TO teams
 */
class AssignmentAuthorization {
  /**
   * Verify manager owns the team for assignment operations
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async verifyTeamOwnership(req, res, next) {
    try {
      const { teamId } = req.params;
      const managerId = req.user.id;

      const team = await Team.findOne({
        where: { id: teamId, manager_id: managerId }
      });

      if (!team) {
        return res.status(403).json({
          success: false,
          error: 'Manager does not have authorization to modify this team'
        });
      }

      req.team = team;
      next();
    } catch (error) {
      console.error('Error in team ownership verification:', error);
      res.status(500).json({ success: false, error: 'Authorization verification failed' });
    }
  }

  /**
   * Verify manager can access/modify the specific incident assignment
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async verifyIncidentAssignmentAccess(req, res, next) {
    try {
      const { incidentId } = req.params;
      const managerId = req.user.id;

      // Find incident with its job card and team
      const incident = await Incident.findOne({
        where: { id: incidentId },
        include: [{
          model: JobCard,
          include: [{
            model: Team,
            where: { manager_id: managerId }
          }]
        }]
      });

      if (!incident) {
        return res.status(404).json({
          success: false,
          error: 'Incident not found or not accessible to this manager'
        });
      }

      // If incident has a job card, verify team ownership
      if (incident.JobCards && incident.JobCards.length > 0) {
        const jobCard = incident.JobCards[0];
        if (!jobCard.Team || jobCard.Team.manager_id !== managerId) {
          return res.status(403).json({
            success: false,
            error: 'Manager does not have authorization to modify this incident assignment'
          });
        }
        req.jobCard = jobCard;
      }

      req.incident = incident;
      next();
    } catch (error) {
      console.error('Error in incident assignment access verification:', error);
      res.status(500).json({ success: false, error: 'Authorization verification failed' });
    }
  }

  /**
   * Verify manager authorization for bulk assignment operations
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async verifyBulkAssignmentAuthorization(req, res, next) {
    try {
      const managerId = req.user.id;
      const { incidentIds, teamId } = req.body;

      // If specific team is provided, verify ownership
      if (teamId) {
        const team = await Team.findOne({
          where: { id: teamId, manager_id: managerId }
        });

        if (!team) {
          return res.status(403).json({
            success: false,
            error: 'Manager does not have authorization to assign incidents to this team'
          });
        }
        req.targetTeam = team;
      }

      // If specific incidents are provided, verify access
      if (incidentIds && incidentIds.length > 0) {
        const incidents = await Incident.findAll({
          where: { id: { [Op.in]: incidentIds } },
          include: [{
            model: JobCard,
            include: [{
              model: Team,
              where: { manager_id: managerId },
              required: false
            }]
          }]
        });

        // Check if any incidents belong to other managers
        const unauthorizedIncidents = incidents.filter(incident => 
          incident.JobCards && incident.JobCards.length > 0 && 
          !incident.JobCards[0].Team
        );

        if (unauthorizedIncidents.length > 0) {
          return res.status(403).json({
            success: false,
            error: 'Manager does not have authorization to modify some of the specified incidents',
            unauthorizedIncidentIds: unauthorizedIncidents.map(i => i.id)
          });
        }
      }

      next();
    } catch (error) {
      console.error('Error in bulk assignment authorization verification:', error);
      res.status(500).json({ success: false, error: 'Authorization verification failed' });
    }
  }

  /**
   * Verify manager authorization for automation configuration
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async verifyAutomationAuthorization(req, res, next) {
    try {
      const managerId = req.user.id;
      
      // Only managers can configure automation settings
      if (req.user.role !== 'manager') {
        return res.status(403).json({
          success: false,
          error: 'Only managers are authorized to configure automated assignment settings'
        });
      }

      // Check if manager has teams (can only automate if they manage teams)
      const teamCount = await Team.count({
        where: { manager_id: managerId }
      });

      if (teamCount === 0) {
        return res.status(403).json({
          success: false,
          error: 'Manager must have at least one team to configure automated assignments'
        });
      }

      req.managedTeamCount = teamCount;
      next();
    } catch (error) {
      console.error('Error in automation authorization verification:', error);
      res.status(500).json({ success: false, error: 'Authorization verification failed' });
    }
  }

  /**
   * Log assignment authorization attempts for audit trail
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async logAuthorizationAttempt(req, res, next) {
    try {
      const { action } = req.body;
      const { method, originalUrl } = req;
      
      // Log the authorization check (but not the actual assignment details for privacy)
      console.log(`Assignment Authorization: Manager ${req.user.id} attempted ${method} ${originalUrl} for action: ${action || 'unknown'}`);
      
      next();
    } catch (error) {
      console.error('Error logging authorization attempt:', error);
      // Don't block the request if logging fails
      next();
    }
  }

  /**
   * ENHANCED RATE LIMITING for bulk assignment operations with stricter controls
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static assignmentRateLimit(req, res, next) {
    const managerId = req.user.id;
    const now = Date.now();
    const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
    const RATE_LIMIT_MAX_REQUESTS = 5; // Reduced to 5 bulk operations per 5 minutes
    const EMERGENCY_WINDOW = 60 * 1000; // 1 minute emergency window
    const EMERGENCY_MAX_REQUESTS = 1; // Max 1 emergency operation per minute

    if (!global.assignmentRateLimits) {
      global.assignmentRateLimits = new Map();
    }

    const managerLimit = global.assignmentRateLimits.get(managerId) || { 
      count: 0, 
      resetTime: now + RATE_LIMIT_WINDOW,
      emergencyCount: 0,
      emergencyResetTime: now + EMERGENCY_WINDOW
    };

    // Check if we need to reset the main window
    if (now > managerLimit.resetTime) {
      managerLimit.count = 0;
      managerLimit.resetTime = now + RATE_LIMIT_WINDOW;
    }

    // Check if we need to reset the emergency window
    if (now > managerLimit.emergencyResetTime) {
      managerLimit.emergencyCount = 0;
      managerLimit.emergencyResetTime = now + EMERGENCY_WINDOW;
    }

    // Determine if this is an emergency request
    const isEmergencyRequest = req.body?.emergency === true || req.body?.forceAssign === true;
    
    if (isEmergencyRequest) {
      if (managerLimit.emergencyCount >= EMERGENCY_MAX_REQUESTS) {
        return res.status(429).json({
          success: false,
          error: 'EMERGENCY ASSIGNMENT RATE LIMIT EXCEEDED: Only 1 emergency assignment allowed per minute',
          code: 'EMERGENCY_RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((managerLimit.emergencyResetTime - now) / 1000),
          limitType: 'emergency',
          maxRequests: EMERGENCY_MAX_REQUESTS,
          windowSeconds: EMERGENCY_WINDOW / 1000
        });
      }
      managerLimit.emergencyCount++;
    } else {
      if (managerLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({
          success: false,
          error: 'BULK ASSIGNMENT RATE LIMIT EXCEEDED: Maximum 5 bulk assignments allowed per 5 minutes',
          code: 'BULK_RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((managerLimit.resetTime - now) / 1000),
          limitType: 'bulk',
          maxRequests: RATE_LIMIT_MAX_REQUESTS,
          windowMinutes: RATE_LIMIT_WINDOW / (60 * 1000)
        });
      }
      managerLimit.count++;
    }

    global.assignmentRateLimits.set(managerId, managerLimit);
    next();
  }

  /**
   * STRICT MANAGER OWNERSHIP VERIFICATION for all assignment operations
   * Enhanced verification that ensures managers can only operate on their own teams
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async verifyStrictManagerOwnership(req, res, next) {
    try {
      const { teamId, incidentId } = req.params;
      const managerId = req.user.id;

      // Only managers and admins can perform assignment operations
      if (!['manager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: `STRICT AUTHORIZATION DENIED: Only managers and admins are authorized for assignment operations. Current role: ${req.user.role}`,
          code: 'INSUFFICIENT_ROLE_FOR_ASSIGNMENT',
          requiredRoles: ['manager', 'admin'],
          currentRole: req.user.role
        });
      }

      // If incidentId is provided, verify manager owns the incident's team
      if (incidentId) {
        const { Incident, JobCard, Team } = require('../models');
        
        const incident = await Incident.findOne({
          where: { id: incidentId },
          include: [{
            model: JobCard,
            include: [{
              model: Team,
              required: false
            }]
          }]
        });

        if (!incident) {
          return res.status(404).json({
            success: false,
            error: 'Incident not found for ownership verification'
          });
        }

        // If incident has a team assignment, verify ownership
        if (incident.JobCards && incident.JobCards.length > 0 && incident.JobCards[0].Team) {
          const team = incident.JobCards[0].Team;
          
          if (req.user.role === 'manager' && team.manager_id !== managerId) {
            return res.status(403).json({
              success: false,
              error: `STRICT OWNERSHIP VIOLATION: Manager ${managerId} does not own team ${team.id} assigned to incident ${incidentId}`,
              code: 'MANAGER_TEAM_OWNERSHIP_VIOLATION',
              managerId: managerId,
              incidentId: incidentId,
              teamId: team.id,
              teamOwnerId: team.manager_id
            });
          }
          
          req.targetTeam = team;
        }
      }

      // If teamId is provided, verify manager owns the team
      if (teamId) {
        const { Team } = require('../models');
        
        const team = await Team.findOne({
          where: { id: teamId, manager_id: managerId }
        });

        if (!team) {
          return res.status(403).json({
            success: false,
            error: `STRICT TEAM OWNERSHIP DENIED: Manager ${managerId} does not own team ${teamId}`,
            code: 'MANAGER_DOES_NOT_OWN_TEAM',
            managerId: managerId,
            teamId: teamId
          });
        }

        req.targetTeam = team;
      }

      req.strictManagerAuth = {
        verified: true,
        managerId: managerId,
        timestamp: new Date(),
        operation: req.method + ' ' + req.originalUrl
      };

      next();
    } catch (error) {
      console.error('Error in strict manager ownership verification:', error);
      res.status(500).json({
        success: false,
        error: 'Strict manager ownership verification failed',
        code: 'OWNERSHIP_VERIFICATION_ERROR'
      });
    }
  }

  /**
   * ENHANCED INCIDENT ACCESS VERIFICATION with comprehensive checks
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async verifyEnhancedIncidentAccess(req, res, next) {
    try {
      const { incidentId } = req.params;
      const managerId = req.user.id;

      const { Incident, JobCard, Team, TeamMember, User } = require('../models');

      // Get incident with comprehensive includes
      const incident = await Incident.findOne({
        where: { id: incidentId },
        include: [{
          model: JobCard,
          include: [{
            model: Team,
            include: [{
              model: TeamMember,
              include: [{
                model: User,
                where: { status: 'active' }
              }]
            }]
          }]
        }]
      });

      if (!incident) {
        return res.status(404).json({
          success: false,
          error: 'Incident not found for enhanced access verification'
        });
      }

      // If incident has a team assignment, verify manager ownership
      if (incident.JobCards && incident.JobCards.length > 0) {
        const jobCard = incident.JobCards[0];
        
        if (req.user.role === 'manager' && jobCard.Team && jobCard.Team.manager_id !== managerId) {
          return res.status(403).json({
            success: false,
            error: `ENHANCED ACCESS DENIED: Manager ${managerId} cannot access incident ${incidentId} assigned to team owned by manager ${jobCard.Team.manager_id}`,
            code: 'CROSS_MANAGER_ACCESS_DENIED',
            managerId: managerId,
            incidentId: incidentId,
            teamOwnerId: jobCard.Team.manager_id,
            teamName: jobCard.Team.name
          });
        }

        // Verify team integrity
        if (jobCard.team_id !== incident.assigned_team_id) {
          return res.status(400).json({
            success: false,
            error: 'Team assignment integrity check failed',
            code: 'TEAM_INTEGRITY_VIOLATION'
          });
        }
      }

      req.enhancedIncident = incident;
      next();
    } catch (error) {
      console.error('Error in enhanced incident access verification:', error);
      res.status(500).json({
        success: false,
        error: 'Enhanced incident access verification failed'
      });
    }
  }

  /**
   * COMPREHENSIVE ASSIGNMENT AUTHORIZATION ORCHESTRATOR
   * Coordinates all authorization checks for assignment operations
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static async orchestrateAssignmentAuthorization(req, res, next) {
    try {
      const managerId = req.user.id;
      const { teamId, incidentId } = req.params;
      const { method, originalUrl } = req;

      // Log authorization attempt
      console.log(`COMPREHENSIVE ASSIGNMENT AUTH: Manager ${managerId} attempting ${method} ${originalUrl}`);

      const authorizationResults = {
        managerRoleValid: ['manager', 'admin'].includes(req.user.role),
        teamOwnershipValid: false,
        incidentAccessValid: false,
        rateLimitPassed: true,
        timestamp: new Date()
      };

      // 1. Verify manager role
      if (!authorizationResults.managerRoleValid) {
        return res.status(403).json({
          success: false,
          error: `COMPREHENSIVE AUTHORIZATION FAILED: Insufficient role for assignment operations`,
          code: 'INSUFFICIENT_ROLE',
          authorizationResults
        });
      }

      // 2. If teamId provided, verify team ownership
      if (teamId) {
        const { Team } = require('../models');
        const team = await Team.findOne({
          where: { id: teamId, manager_id: managerId }
        });
        
        authorizationResults.teamOwnershipValid = !!team;
        req.targetTeam = team;

        if (!authorizationResults.teamOwnershipValid) {
          return res.status(403).json({
            success: false,
            error: `COMPREHENSIVE AUTHORIZATION FAILED: Team ownership verification failed`,
            code: 'TEAM_OWNERSHIP_FAILED',
            authorizationResults,
            requestedTeamId: teamId
          });
        }
      }

      // 3. If incidentId provided, verify incident access
      if (incidentId) {
        const { Incident } = require('../models');
        const incident = await Incident.findOne({
          where: { id: incidentId },
          include: [{
            model: require('../models/JobCard'),
            include: [{
              model: require('../models/Team'),
              required: false
            }]
          }]
        });

        if (!incident) {
          return res.status(404).json({
            success: false,
            error: 'Incident not found for comprehensive authorization'
          });
        }

        // Verify cross-manager access
        if (req.user.role === 'manager' && 
            incident.assigned_team_id && 
            incident.JobCards && incident.JobCards.length > 0) {
          const jobCard = incident.JobCards[0];
          if (jobCard.Team && jobCard.Team.manager_id !== managerId) {
            return res.status(403).json({
              success: false,
              error: `COMPREHENSIVE AUTHORIZATION FAILED: Cross-manager access denied`,
              code: 'CROSS_MANAGER_ACCESS_DENIED',
              authorizationResults,
              incidentOwnerId: jobCard.Team.manager_id
            });
          }
        }

        authorizationResults.incidentAccessValid = true;
        req.targetIncident = incident;
      }

      // Store comprehensive authorization result
      req.comprehensiveAuthorization = {
        verified: true,
        managerId: managerId,
        results: authorizationResults,
        operation: method + ' ' + originalUrl,
        timestamp: new Date()
      };

      next();
    } catch (error) {
      console.error('Error in comprehensive assignment authorization:', error);
      res.status(500).json({
        success: false,
        error: 'Comprehensive assignment authorization failed',
        code: 'COMPREHENSIVE_AUTH_ERROR'
      });
    }
  }
}

module.exports = AssignmentAuthorization;