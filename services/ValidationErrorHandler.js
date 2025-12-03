const { ActivityLog, User, Team, Incident } = require('../models');

/**
 * Enhanced Error Handling and Validation Feedback Service
 * Provides comprehensive error categorization, detailed feedback, and actionable remediation steps
 */
class ValidationErrorHandler {
  constructor() {
    this.errorCategories = {
      AUTHORIZATION: 'AUTHORIZATION',
      VALIDATION: 'VALIDATION', 
      BUSINESS_RULE: 'BUSINESS_RULE',
      DATA_INTEGRITY: 'DATA_INTEGRITY',
      SYSTEM: 'SYSTEM',
      CONSTRAINT: 'CONSTRAINT'
    };

    this.errorSeverity = {
      BLOCKING: 'BLOCKING',
      WARNING: 'WARNING',
      INFO: 'INFO'
    };

    this.statusCodeMapping = {
      'TEAM_ASSIGNMENT_REQUIRED': { httpStatus: 400, category: 'VALIDATION', severity: 'BLOCKING' },
      'INVALID_TRANSITION': { httpStatus: 400, category: 'VALIDATION', severity: 'BLOCKING' },
      'MANAGER_AUTHORIZATION_REQUIRED': { httpStatus: 403, category: 'AUTHORIZATION', severity: 'BLOCKING' },
      'MANAGER_TEAM_OWNERSHIP_VIOLATION': { httpStatus: 403, category: 'AUTHORIZATION', severity: 'BLOCKING' },
      'TEAM_UNAVAILABLE': { httpStatus: 400, category: 'BUSINESS_RULE', severity: 'BLOCKING' },
      'TEAM_AT_CAPACITY': { httpStatus: 400, category: 'BUSINESS_RULE', severity: 'BLOCKING' },
      'TEAM_NO_ACTIVE_MEMBERS': { httpStatus: 400, category: 'BUSINESS_RULE', severity: 'BLOCKING' },
      'JOB_CARD_REQUIRED': { httpStatus: 400, category: 'DATA_INTEGRITY', severity: 'BLOCKING' },
      'DATA_INTEGRITY_VIOLATION': { httpStatus: 500, category: 'DATA_INTEGRITY', severity: 'BLOCKING' },
      'VALIDATION_SYSTEM_ERROR': { httpStatus: 500, category: 'SYSTEM', severity: 'BLOCKING' }
    };
  }

  /**
   * Process and enhance validation errors with comprehensive feedback
   * @param {Object} errorResult - Error result from validation
   * @param {Object} context - Additional context for error enhancement
   * @returns {Object} Enhanced error response
   */
  processValidationError(errorResult, context = {}) {
    const {
      error,
      code,
      validationStage,
      incident,
      currentUser,
      timestamp = new Date().toISOString()
    } = errorResult;

    // Determine error category and HTTP status
    const errorInfo = this.getErrorInfo(code);
    
    // Generate remediation steps
    const remediationSteps = this.generateRemediationSteps(code, errorResult, context);
    
    // Generate helpful guidance
    const guidance = this.generateGuidance(code, errorResult, context);
    
    // Create enhanced error response
    const enhancedError = {
      success: false,
      error: error,
      code: code || 'VALIDATION_ERROR',
      category: errorInfo.category,
      severity: errorInfo.severity,
      httpStatus: errorInfo.httpStatus,
      timestamp: timestamp,
      validationStage: validationStage || 'unknown',
      context: {
        incidentId: incident?.id,
        incidentTitle: incident?.title,
        incidentStatus: incident?.status,
        userId: currentUser?.id,
        userRole: currentUser?.role,
        ...context
      },
      remediation: {
        immediateSteps: remediationSteps.immediate,
        longTermSteps: remediationSteps.longTerm,
        requiredResources: remediationSteps.resources,
        estimatedTime: remediationSteps.estimatedTime
      },
      guidance: {
        description: guidance.description,
        examples: guidance.examples,
        relatedDocumentation: guidance.documentation
      },
      technical: {
        stackTrace: process.env.NODE_ENV === 'development' ? errorResult.stackTrace : undefined,
        validationDetails: errorResult.validationDetails,
        systemState: this.sanitizeSystemState(errorResult)
      }
    };

    return enhancedError;
  }

  /**
   * Get error information including category and HTTP status
   * @param {string} errorCode - Error code
   * @returns {Object} Error information
   */
  getErrorInfo(errorCode) {
    return this.statusCodeMapping[errorCode] || {
      httpStatus: 400,
      category: this.errorCategories.VALIDATION,
      severity: this.errorSeverity.BLOCKING
    };
  }

  /**
   * Generate specific remediation steps for error resolution
   * @param {string} errorCode - Error code
   * @param {Object} errorResult - Error result
   * @param {Object} context - Error context
   * @returns {Object} Remediation steps
   */
  generateRemediationSteps(errorCode, errorResult, context) {
    const remediationMap = {
      'TEAM_ASSIGNMENT_REQUIRED': {
        immediate: [
          'Verify incident is in correct status for team assignment',
          'Ensure team exists and is active',
          'Check team has available capacity',
          'Confirm team has active members'
        ],
        longTerm: [
          'Review team management processes',
          'Implement automated team availability monitoring'
        ],
        resources: ['Team management interface', 'Team availability dashboard'],
        estimatedTime: '5-10 minutes'
      },
      'INVALID_TRANSITION': {
        immediate: [
          'Review valid status transitions for current status',
          'Follow proper progression sequence',
          'Complete required intermediate steps'
        ],
        longTerm: [
          'Update status transition workflows',
          'Provide status transition training'
        ],
        resources: ['Status transition documentation', 'Incident workflow guide'],
        estimatedTime: '2-5 minutes'
      },
      'MANAGER_AUTHORIZATION_REQUIRED': {
        immediate: [
          'Verify user has manager or admin role',
          'Check manager account status is active',
          'Confirm manager owns the relevant teams'
        ],
        longTerm: [
          'Review role assignments',
          'Update user permissions if needed'
        ],
        resources: ['User management interface', 'Role assignment documentation'],
        estimatedTime: '5-15 minutes'
      },
      'TEAM_UNAVAILABLE': {
        immediate: [
          'Check team availability status',
          'Set team to available if appropriate',
          'Verify team has active members',
          'Consider alternative team assignment'
        ],
        longTerm: [
          'Implement team availability monitoring',
          'Review team management practices'
        ],
        resources: ['Team management interface', 'Team status dashboard'],
        estimatedTime: '3-7 minutes'
      },
      'TEAM_AT_CAPACITY': {
        immediate: [
          'Check current team assignments',
          'Consider redistributing workload',
          'Increase team capacity if appropriate',
          'Use alternative team for assignment'
        ],
        longTerm: [
          'Review capacity planning',
          'Optimize team resource allocation'
        ],
        resources: ['Team capacity dashboard', 'Workload management tools'],
        estimatedTime: '10-20 minutes'
      },
      'DATA_INTEGRITY_VIOLATION': {
        immediate: [
          'Review data consistency',
          'Verify all related records exist',
          'Check for orphaned records',
          'Restore data integrity manually if needed'
        ],
        longTerm: [
          'Implement data integrity monitoring',
          'Review data entry processes',
          'Add validation constraints'
        ],
        resources: ['Database administration tools', 'Data integrity reports'],
        estimatedTime: '15-30 minutes'
      }
    };

    return remediationMap[errorCode] || {
      immediate: ['Review error details and context', 'Consult system documentation'],
      longTerm: ['Implement process improvements', 'Provide additional training'],
      resources: ['System documentation', 'Support team'],
      estimatedTime: 'Variable'
    };
  }

  /**
   * Generate helpful guidance for error resolution
   * @param {string} errorCode - Error code
   * @param {Object} errorResult - Error result
   * @param {Object} context - Error context
   * @returns {Object} Guidance information
   */
  generateGuidance(errorCode, errorResult, context) {
    const guidanceMap = {
      'TEAM_ASSIGNMENT_REQUIRED': {
        description: 'This error occurs when an incident requires team assignment before the requested status change. The system enforces strict team assignment requirements for incident progression.',
        examples: [
          'Cannot mark incident as "In Progress" without team assignment',
          'Cannot complete incident without proper team assignment',
          'Team must be active and have available capacity'
        ],
        documentation: '/docs/team-assignment-requirements'
      },
      'INVALID_TRANSITION': {
        description: 'The system enforces a strict status progression workflow. Incidents must follow the defined sequence and cannot skip required steps.',
        examples: [
          'Must go: Not Started → verified → assigned → In Progress → Completed',
          'Cannot jump from "verified" directly to "Completed"',
          'Each status change must be authorized by a manager'
        ],
        documentation: '/docs/status-transition-rules'
      },
      'MANAGER_AUTHORIZATION_REQUIRED': {
        description: 'Only managers and admins are authorized to perform certain operations. This ensures proper oversight and control of critical incident management functions.',
        examples: [
          'Team assignment requires manager authorization',
          'Status changes to critical states need manager approval',
          'Cross-manager team access is restricted'
        ],
        documentation: '/docs/manager-authorization'
      }
    };

    return guidanceMap[errorCode] || {
      description: 'An error occurred during validation. Please review the error details and follow the provided remediation steps.',
      examples: [],
      documentation: '/docs/troubleshooting'
    };
  }

  /**
   * Log validation errors for monitoring and analysis
   * @param {Object} errorResult - Error result to log
   * @param {Object} context - Additional context
   */
  async logValidationError(errorResult, context = {}) {
    try {
      const logEntry = {
        user_id: context.userId || 'system',
        action: `Validation Error: ${errorResult.code || 'UNKNOWN_ERROR'}`,
        table_name: 'validation_errors',
        reference_id: errorResult.incident?.id || null,
        details: JSON.stringify({
          type: 'validation_error',
          errorCode: errorResult.code,
          errorMessage: errorResult.error,
          validationStage: errorResult.validationStage,
          incidentId: errorResult.incident?.id,
          userRole: context.userRole,
          timestamp: new Date().toISOString(),
          context: context,
          remediation: this.generateRemediationSteps(errorResult.code, errorResult, context)
        }),
        created_at: new Date()
      };

      await ActivityLog.create(logEntry);
    } catch (logError) {
      console.error('Failed to log validation error:', logError);
      // Don't throw - logging failure shouldn't break the error handling flow
    }
  }

  /**
   * Create user-friendly error messages
   * @param {Object} enhancedError - Enhanced error object
   * @param {string} userRole - User role for message customization
   * @returns {Object} User-friendly error response
   */
  createUserFriendlyMessage(enhancedError, userRole) {
    const { code, error, remediation, guidance, context } = enhancedError;
    
    // Customize message based on user role
    let roleSpecificMessage = '';
    switch (userRole) {
      case 'manager':
        roleSpecificMessage = 'As a manager, you have the authority to resolve most validation issues through the team management interface.';
        break;
      case 'admin':
        roleSpecificMessage = 'As an admin, you have elevated privileges to resolve system-level validation issues.';
        break;
      case 'team_leader':
        roleSpecificMessage = 'Team leaders should coordinate with their manager for status changes that require authorization.';
        break;
      case 'worker':
        roleSpecificMessage = 'Workers should contact their team leader or manager for assistance with validation errors.';
        break;
      default:
        roleSpecificMessage = 'Please contact your system administrator for assistance.';
    }

    return {
      success: false,
      message: this.sanitizeErrorMessage(error),
      code: code,
      userMessage: `Validation Error: ${this.getHumanReadableError(code)}`,
      explanation: this.getErrorExplanation(code),
      nextSteps: remediation.immediateSteps.slice(0, 3), // Show top 3 immediate steps
      help: {
        contactSupport: 'If you continue to experience issues, please contact support.',
        documentation: guidance.documentation,
        roleSpecificGuidance: roleSpecificMessage
      },
      technical: {
        reference: code,
        timestamp: enhancedError.timestamp,
        incident: context.incidentId ? `Incident ${context.incidentId}` : 'No incident reference'
      }
    };
  }

  /**
   * Get human-readable error description
   * @param {string} errorCode - Error code
   * @returns {string} Human-readable error description
   */
  getHumanReadableError(errorCode) {
    const readableErrors = {
      'TEAM_ASSIGNMENT_REQUIRED': 'Team Assignment Required',
      'INVALID_TRANSITION': 'Invalid Status Transition',
      'MANAGER_AUTHORIZATION_REQUIRED': 'Manager Authorization Required',
      'TEAM_UNAVAILABLE': 'Team Not Available',
      'TEAM_AT_CAPACITY': 'Team at Maximum Capacity',
      'TEAM_NO_ACTIVE_MEMBERS': 'Team Has No Active Members',
      'JOB_CARD_REQUIRED': 'Job Card Required',
      'DATA_INTEGRITY_VIOLATION': 'Data Integrity Issue'
    };

    return readableErrors[errorCode] || 'Validation Error';
  }

  /**
   * Get detailed error explanation
   * @param {string} errorCode - Error code
   * @returns {string} Error explanation
   */
  getErrorExplanation(errorCode) {
    const explanations = {
      'TEAM_ASSIGNMENT_REQUIRED': 'The incident must be assigned to an active team before proceeding with this status change. This ensures proper resource allocation and accountability.',
      'INVALID_TRANSITION': 'The requested status change is not allowed from the current incident status. The system enforces a strict progression workflow to maintain data integrity.',
      'MANAGER_AUTHORIZATION_REQUIRED': 'This operation requires manager or admin authorization to ensure proper oversight and control of critical incident management functions.',
      'TEAM_UNAVAILABLE': 'The assigned team is currently unavailable. Please make the team available or select an alternative team for assignment.',
      'TEAM_AT_CAPACITY': 'The team has reached its maximum capacity for concurrent assignments. Please redistribute workload or increase team capacity.',
      'TEAM_NO_ACTIVE_MEMBERS': 'The team must have active members to handle incident assignments. Please add active team members.',
      'JOB_CARD_REQUIRED': 'A job card must exist for all team assignments to maintain proper workflow tracking and accountability.'
    };

    return explanations[errorCode] || 'An error occurred during system validation. Please review the details and follow the suggested remediation steps.';
  }

  /**
   * Sanitize error message for user display
   * @param {string} errorMessage - Raw error message
   * @returns {string} Sanitized error message
   */
  sanitizeErrorMessage(errorMessage) {
    // Remove technical details and system-specific information
    return errorMessage
      .replace(/STRICT\s+/gi, '')
      .replace(/VALIDATION\s+FAILED:\s*/gi, '')
      .replace(/\(CODE:.*?\)/g, '')
      .replace(/\(.*?manager.*?\)/gi, '')
      .substring(0, 200); // Limit length
  }

  /**
   * Sanitize system state for error reporting
   * @param {Object} errorResult - Error result
   * @returns {Object} Sanitized system state
   */
  sanitizeSystemState(errorResult) {
    const sanitized = {};
    
    if (errorResult.incident) {
      sanitized.incident = {
        id: errorResult.incident.id,
        status: errorResult.incident.status,
        hasTeamAssignment: !!errorResult.incident.assigned_team_id
      };
    }

    if (errorResult.validationDetails) {
      sanitized.validationDetails = {
        stage: errorResult.validationStage,
        requirements: Object.keys(errorResult.validationDetails || {})
      };
    }

    return sanitized;
  }

  /**
   * Create comprehensive error report for monitoring
   * @param {Array} errors - Array of error results
   * @returns {Object} Error report summary
   */
  createErrorReport(errors) {
    const summary = {
      totalErrors: errors.length,
      errorCategories: {},
      errorCodes: {},
      severityLevels: {},
      timestamps: [],
      mostCommonErrors: [],
      remediationSuggestions: {}
    };

    errors.forEach(error => {
      const errorInfo = this.getErrorInfo(error.code);
      
      // Count by category
      summary.errorCategories[errorInfo.category] = 
        (summary.errorCategories[errorInfo.category] || 0) + 1;
      
      // Count by error code
      summary.errorCodes[error.code] = (summary.errorCodes[error.code] || 0) + 1;
      
      // Count by severity
      summary.severityLevels[errorInfo.severity] = 
        (summary.severityLevels[errorInfo.severity] || 0) + 1;
      
      // Collect timestamps
      if (error.timestamp) {
        summary.timestamps.push(error.timestamp);
      }
    });

    // Find most common errors
    summary.mostCommonErrors = Object.entries(summary.errorCodes)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([code, count]) => ({ code, count }));

    return summary;
  }
}

module.exports = ValidationErrorHandler;