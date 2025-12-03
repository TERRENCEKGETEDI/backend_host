const AutomatedAssignmentService = require('./AutomatedAssignmentService');
const { ActivityLog, Team, Incident } = require('../models');
const { Op } = require('sequelize');

/**
 * Automated Scheduling Service
 * Handles continuous automated assignment of incidents TO teams based on predefined rules
 * Runs in the background and ensures incidents are assigned TO teams automatically
 */
class AutomatedSchedulingService {
  constructor() {
    this.assignmentService = new AutomatedAssignmentService();
    this.isRunning = false;
    this.schedulerInterval = null;
    this.assignmentHistory = new Set(); // Track recently processed incidents
    this.lastRun = null;
    this.runStats = {
      totalRuns: 0,
      totalAssignments: 0,
      totalErrors: 0,
      lastError: null
    };
    
    // Configuration
    this.config = {
      enabled: process.env.AUTOMATION_ENABLED === 'true',
      interval: parseInt(process.env.AUTO_ASSIGN_INTERVAL) || 300000, // 5 minutes
      maxConcurrentAssignments: parseInt(process.env.MAX_CONCURRENT_ASSIGNMENTS) || 10,
      priorityOrder: ['critical', 'high', 'medium', 'low'], // Process critical first
      dryRunMode: process.env.AUTOMATION_DRY_RUN === 'true',
      emergencyAssignment: process.env.EMERGENCY_AUTO_ASSIGN === 'true'
    };
  }

  /**
   * Start the automated scheduling service
   * @param {Object} options - Scheduling options
   */
  startScheduling(options = {}) {
    if (this.isRunning) {
      console.log('Automated scheduling service is already running');
      return;
    }

    // Override config with options if provided
    if (options.enabled !== undefined) this.config.enabled = options.enabled;
    if (options.interval) this.config.interval = options.interval;
    if (options.dryRunMode !== undefined) this.config.dryRunMode = options.dryRunMode;

    if (!this.config.enabled) {
      console.log('Automated scheduling is disabled. Set AUTOMATION_ENABLED=true to enable.');
      return;
    }

    console.log(`Starting automated scheduling service with interval: ${this.config.interval}ms`);
    
    this.isRunning = true;
    
    // Run initial assignment
    this.runScheduledAssignment();

    // Set up recurring schedule
    this.schedulerInterval = setInterval(() => {
      this.runScheduledAssignment();
    }, this.config.interval);

    console.log('Automated scheduling service started successfully');
  }

  /**
   * Stop the automated scheduling service
   */
  stopScheduling() {
    if (!this.isRunning) {
      console.log('Automated scheduling service is not running');
      return;
    }

    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    this.isRunning = false;
    console.log('Automated scheduling service stopped');
  }

  /**
   * Get scheduling status and statistics
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      lastRun: this.lastRun,
      stats: this.runStats,
      uptime: this.isRunning ? Date.now() - (this.startTime || Date.now()) : 0
    };
  }

  /**
   * Execute scheduled assignment cycle
   */
  async runScheduledAssignment() {
    if (!this.isRunning) return;

    const runStartTime = Date.now();
    this.runStats.totalRuns++;

    try {
      console.log(`[${new Date().toISOString()}] Starting scheduled assignment cycle`);

      // Clean up old entries from assignment history
      this.cleanupAssignmentHistory();

      // Get all managers with teams
      const managers = await this.getActiveManagers();

      let totalAssigned = 0;
      let totalErrors = 0;

      for (const manager of managers) {
        try {
          // Skip if manager has no teams
          const teamCount = await Team.count({
            where: { manager_id: manager.id }
          });

          if (teamCount === 0) {
            continue;
          }

          // Get unassigned incidents for this manager
          const unassignedIncidents = await this.getUnassignedIncidents(manager.id);

          if (unassignedIncidents.length === 0) {
            continue;
          }

          // Process incidents by priority
          const assignments = await this.processIncidentsByPriority(
            unassignedIncidents, 
            manager.id
          );

          totalAssigned += assignments.success;
          totalErrors += assignments.errors;

          // Log manager-specific results
          if (assignments.success > 0 || assignments.errors > 0) {
            await ActivityLog.create({
              user_id: manager.id,
              action: `Scheduled assignment: ${assignments.success} assigned, ${assignments.errors} failed`,
              table_name: 'incidents',
              reference_id: null,
              details: JSON.stringify({
                type: 'scheduled_automated_assignment',
                processedIncidents: unassignedIncidents.length,
                successfulAssignments: assignments.success,
                failedAssignments: assignments.errors,
                dryRunMode: this.config.dryRunMode,
                runDuration: Date.now() - runStartTime
              })
            });
          }

        } catch (managerError) {
          console.error(`Error processing manager ${manager.id}:`, managerError);
          totalErrors++;
        }
      }

      // Update run statistics
      this.runStats.totalAssignments += totalAssigned;
      this.runStats.totalErrors += totalErrors;
      this.lastRun = new Date();

      const runDuration = Date.now() - runStartTime;
      console.log(
        `[${new Date().toISOString()}] Scheduled assignment completed: ` +
        `${totalAssigned} assigned, ${totalErrors} errors in ${runDuration}ms`
      );

      // Log overall system results
      await ActivityLog.create({
        user_id: null, // System log
        action: `System scheduled assignment cycle completed: ${totalAssigned} assigned, ${totalErrors} errors`,
        table_name: 'system',
        reference_id: null,
        details: JSON.stringify({
          type: 'system_scheduled_assignment',
          totalAssigned,
          totalErrors,
          runDuration,
          activeManagers: managers.length,
          config: this.config
        })
      });

    } catch (error) {
      this.runStats.totalErrors++;
      this.runStats.lastError = {
        message: error.message,
        timestamp: new Date(),
        stack: error.stack
      };

      console.error('Error in scheduled assignment cycle:', error);

      // Log the error
      await ActivityLog.create({
        user_id: null, // System log
        action: 'Scheduled assignment cycle failed',
        table_name: 'system',
        reference_id: null,
        details: JSON.stringify({
          type: 'system_assignment_error',
          error: error.message,
          runStats: this.runStats,
          config: this.config
        })
      });
    }
  }

  /**
   * Get all active managers who have teams
   * @returns {Promise<Array>} Array of manager objects
   */
  async getActiveManagers() {
    const { User } = require('../models');
    
    return await User.findAll({
      where: { 
        role: 'manager',
        status: 'active'
      },
      attributes: ['id', 'name', 'email']
    });
  }

  /**
   * Get unassigned incidents for a specific manager
   * @param {string} managerId - Manager ID
   * @returns {Promise<Array>} Array of unassigned incidents
   */
  async getUnassignedIncidents(managerId) {
    // Only get incidents that are ready for assignment
    const incidents = await Incident.findAll({
      where: {
        status: 'verified',
        assigned_team_id: null
      },
      order: [['created_at', 'ASC']] // Process oldest first
    });

    // Filter out recently processed incidents
    const recentThreshold = Date.now() - (5 * 60 * 1000); // 5 minutes
    return incidents.filter(incident => 
      !this.assignmentHistory.has(incident.id) ||
      this.assignmentHistory.get(incident.id) < recentThreshold
    );
  }

  /**
   * Process incidents by priority order
   * @param {Array} incidents - Array of incidents to process
   * @param {string} managerId - Manager ID
   * @returns {Promise<Object>} Processing results
   */
  async processIncidentsByPriority(incidents, managerId) {
    let success = 0;
    let errors = 0;

    // Group incidents by priority
    const priorityGroups = {};
    for (const priority of this.config.priorityOrder) {
      priorityGroups[priority] = [];
    }

    // Categorize incidents
    for (const incident of incidents) {
      const categorization = this.assignmentService.categorizeIncident(incident);
      const priority = categorization.category;
      
      if (priorityGroups[priority]) {
        priorityGroups[priority].push({
          incident,
          categorization
        });
      }
    }

    // Process by priority (critical first)
    for (const priority of this.config.priorityOrder) {
      const priorityIncidents = priorityGroups[priority];
      
      if (priorityIncidents.length === 0) continue;

      console.log(`Processing ${priorityIncidents.length} ${priority} priority incidents`);

      // Process up to max concurrent assignments per priority
      const maxToProcess = Math.min(
        priorityIncidents.length,
        this.config.maxConcurrentAssignments
      );

      for (let i = 0; i < maxToProcess; i++) {
        const { incident, categorization } = priorityIncidents[i];
        
        try {
          if (this.config.dryRunMode) {
            // Dry run - just log what would happen
            console.log(`[DRY RUN] Would assign ${incident.id} (${priority}) using rules: ${categorization.reasoning}`);
            this.assignmentHistory.set(incident.id, Date.now());
            success++;
          } else {
            // Actual assignment
            const result = await this.assignmentService.assignIncidentWithRules(
              incident.id, 
              managerId,
              {
                emergencyAssignment: this.config.emergencyAssignment,
                priority: priority
              }
            );
            
            this.assignmentHistory.set(incident.id, Date.now());
            success++;
            
            console.log(`Assigned ${incident.id} to ${result.selectedTeam.name} (${priority})`);
          }
        } catch (error) {
          console.error(`Error assigning incident ${incident.id}:`, error);
          errors++;
        }

        // Small delay between assignments to prevent overwhelming the system
        if (i < maxToProcess - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    return { success, errors };
  }

  /**
   * Clean up old entries from assignment history
   */
  cleanupAssignmentHistory() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    
    for (const [incidentId, timestamp] of this.assignmentHistory.entries()) {
      if (timestamp < cutoff) {
        this.assignmentHistory.delete(incidentId);
      }
    }

    // Limit history size
    if (this.assignmentHistory.size > 5000) {
      const entries = Array.from(this.assignmentHistory.entries())
        .sort((a, b) => a[1] - b[1]); // Sort by timestamp
      
      // Remove oldest 1000 entries
      const toRemove = entries.slice(0, 1000);
      for (const [incidentId] of toRemove) {
        this.assignmentHistory.delete(incidentId);
      }
    }
  }

  /**
   * Manually trigger assignment cycle (for testing or immediate assignment)
   * @param {Object} options - Assignment options
   * @returns {Promise<Object>} Results summary
   */
  async triggerManualAssignment(options = {}) {
    console.log('Manual assignment cycle triggered');
    
    const originalDryRun = this.config.dryRunMode;
    
    try {
      // Override config for manual run
      if (options.dryRun !== undefined) {
        this.config.dryRunMode = options.dryRun;
      }
      
      await this.runScheduledAssignment();
      
      return {
        success: true,
        message: 'Manual assignment cycle completed',
        stats: this.runStats,
        config: this.config
      };
    } finally {
      // Restore original config
      this.config.dryRunMode = originalDryRun;
    }
  }

  /**
   * Update scheduling configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfig(newConfig) {
    const wasRunning = this.isRunning;
    
    // Stop if running
    if (wasRunning) {
      this.stopScheduling();
    }

    // Update config
    Object.assign(this.config, newConfig);

    // Restart if it was running
    if (wasRunning) {
      this.startScheduling();
    }

    console.log('Scheduling configuration updated:', this.config);
  }
}

// Create global instance
global.automatedScheduler = global.automatedScheduler || new AutomatedSchedulingService();

module.exports = global.automatedScheduler;