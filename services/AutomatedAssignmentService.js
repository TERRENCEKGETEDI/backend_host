const { Team, TeamMember, JobCard, Incident, ActivityLog, User } = require('../models');
const { Op } = require('sequelize');
const IntelligentAssignmentService = require('./IntelligentAssignmentService');

/**
 * Automated Assignment Service
 * Handles automatic batch assignment of incidents TO teams
 * Ensures managers retain exclusive authorization while providing automated assignment capabilities for incidents TO teams
 */
class AutomatedAssignmentService {
  constructor() {
    this.assignmentRules = this.initializeAssignmentRules();
    this.intelligentService = new IntelligentAssignmentService();
    this.assignmentHistory = new Map(); // Track recent assignments to prevent duplicates
    this.AUTOMATION_ENABLED = process.env.AUTOMATION_ENABLED === 'true';
    this.AUTO_ASSIGN_INTERVAL = process.env.AUTO_ASSIGN_INTERVAL || 300000; // 5 minutes
  }

  /**
   * Initialize predefined assignment rules and criteria
   * These rules will be used to automatically categorize and assign incidents
   */
  initializeAssignmentRules() {
    return {
      // Critical/Emergency incidents
      critical: {
        keywords: [
          'emergency', 'urgent', 'flood', 'overflow', 'sewage backup',
          'public health', 'environmental', 'contamination', 'blockage severe',
          'pipe burst', 'manhole overflow', 'sewage spill'
        ],
        priority: 'critical',
        sla_target: 4 * 60 * 60 * 1000, // 4 hours
        max_assignments_per_team: 2, // Limit critical assignments per team
        required_team_capabilities: ['emergency_response', 'heavy_equipment']
      },
      
      // High priority incidents
      high: {
        keywords: [
          'backup', 'slow drainage', 'odour', 'noise', 'localized flooding',
          'manhole damaged', 'pipe damaged', 'access issues'
        ],
        priority: 'high',
        sla_target: 8 * 60 * 60 * 1000, // 8 hours
        max_assignments_per_team: 3,
        required_team_capabilities: ['standard_response']
      },
      
      // Medium priority incidents  
      medium: {
        keywords: [
          'maintenance', 'inspection', 'cleaning', 'routine', 'preventive',
          'minor blockage', 'odor control', 'access repair'
        ],
        priority: 'medium',
        sla_target: 24 * 60 * 60 * 1000, // 24 hours
        max_assignments_per_team: 5,
        required_team_capabilities: ['standard_response', 'maintenance']
      },
      
      // Low priority incidents
      low: {
        keywords: [
          'consultation', 'advice', 'general inquiry', 'scheduled maintenance',
          'documentation', 'follow-up', 'routine check'
        ],
        priority: 'low',
        sla_target: 48 * 60 * 60 * 1000, // 48 hours
        max_assignments_per_team: 10,
        required_team_capabilities: ['standard_response']
      },

      // Geographic assignment rules
      geographic: {
        north_zone: {
          areas: ['northern suburbs', 'north end', 'uptown'],
          team_preference: 'north_team'
        },
        south_zone: {
          areas: ['southern suburbs', 'south end', 'downtown'],
          team_preference: 'south_team'
        },
        central_zone: {
          areas: ['central', 'midtown', 'business district'],
          team_preference: 'central_team'
        }
      },

      // Time-based assignment rules
      time_based: {
        business_hours: {
          start: 8,
          end: 17,
          preferred_teams: ['day_shift_team', 'standard_team']
        },
        after_hours: {
          start: 17,
          end: 8,
          preferred_teams: ['emergency_team', 'on_call_team']
        },
        weekend: {
          preferred_teams: ['emergency_team', 'minimal_staff_team']
        }
      },

      // Team capability-based rules
      team_capabilities: {
        emergency_response: {
          description: 'Teams equipped for emergency response',
          max_concurrent: 3,
          priority_boost: 1.5
        },
        heavy_equipment: {
          description: 'Teams with heavy machinery access',
          max_concurrent: 2,
          priority_boost: 1.2
        },
        standard_response: {
          description: 'Standard response teams',
          max_concurrent: 5,
          priority_boost: 1.0
        },
        maintenance: {
          description: 'Maintenance-focused teams',
          max_concurrent: 8,
          priority_boost: 0.8
        }
      }
    };
  }

  /**
   * Categorize incident based on predefined rules
   * @param {Object} incident - The incident to categorize
   * @returns {Object} Category information with rules to apply
   */
  categorizeIncident(incident) {
    const { title = '', description = '', location = '' } = incident;
    const fullText = `${title} ${description} ${location}`.toLowerCase();
    
    // Check each priority category
    for (const [category, rules] of Object.entries(this.assignmentRules)) {
      if (typeof rules === 'object' && rules.keywords) {
        const matchCount = rules.keywords.filter(keyword => 
          fullText.includes(keyword.toLowerCase())
        ).length;
        
        if (matchCount > 0) {
          return {
            category,
            rules,
            matchScore: matchCount,
            reasoning: `Matched ${matchCount} keywords: ${rules.keywords.filter(k => fullText.includes(k.toLowerCase())).join(', ')}`
          };
        }
      }
    }

    // Default to medium priority if no specific rules match
    return {
      category: 'medium',
      rules: this.assignmentRules.medium,
      matchScore: 0,
      reasoning: 'Default classification - no specific keywords matched'
    };
  }

  /**
   * Apply geographic assignment rules
   * @param {Object} incident - The incident to analyze
   * @param {Array} availableTeams - Available teams
   * @returns {Object} Geographic preferences
   */
  applyGeographicRules(incident, availableTeams) {
    const { location = '' } = incident;
    const locationLower = location.toLowerCase();
    
    for (const [zone, rules] of Object.entries(this.assignmentRules.geographic)) {
      if (rules.areas) {
        const matchedArea = rules.areas.find(area => 
          locationLower.includes(area.toLowerCase())
        );
        
        if (matchedArea) {
          // Find teams that match geographic preference
          const preferredTeams = availableTeams.filter(team => 
            team.name.toLowerCase().includes(rules.team_preference.toLowerCase()) ||
            team.geographic_zone === zone
          );
          
          if (preferredTeams.length > 0) {
            return {
              zone,
              matchedArea,
              preferredTeams,
              boostFactor: 1.3 // Boost teams in the right geographic area
            };
          }
        }
      }
    }
    
    return {
      zone: 'unknown',
      matchedArea: null,
      preferredTeams: availableTeams,
      boostFactor: 1.0
    };
  }

  /**
   * Apply time-based assignment rules
   * @param {Date} incidentTime - Time of incident creation
   * @param {Array} availableTeams - Available teams
   * @returns {Object} Time-based preferences
   */
  applyTimeBasedRules(incidentTime, availableTeams) {
    const hour = incidentTime.getHours();
    const dayOfWeek = incidentTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Weekend check
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const weekendTeams = availableTeams.filter(team => 
        this.assignmentRules.time_based.weekend.preferred_teams.some(preferred => 
          team.name.toLowerCase().includes(preferred.toLowerCase())
        )
      );
      
      return {
        period: 'weekend',
        preferredTeams: weekendTeams.length > 0 ? weekendTeams : availableTeams,
        boostFactor: weekendTeams.length > 0 ? 1.2 : 1.0
      };
    }
    
    // Business hours check
    if (hour >= this.assignmentRules.time_based.business_hours.start && 
        hour < this.assignmentRules.time_based.business_hours.end) {
      const businessTeams = availableTeams.filter(team => 
        this.assignmentRules.time_based.business_hours.preferred_teams.some(preferred => 
          team.name.toLowerCase().includes(preferred.toLowerCase())
        )
      );
      
      return {
        period: 'business_hours',
        preferredTeams: businessTeams.length > 0 ? businessTeams : availableTeams,
        boostFactor: businessTeams.length > 0 ? 1.1 : 1.0
      };
    }
    
    // After hours
    const afterHoursTeams = availableTeams.filter(team => 
      this.assignmentRules.time_based.after_hours.preferred_teams.some(preferred => 
        team.name.toLowerCase().includes(preferred.toLowerCase())
      )
    );
    
    return {
      period: 'after_hours',
      preferredTeams: afterHoursTeams.length > 0 ? afterHoursTeams : availableTeams,
      boostFactor: afterHoursTeams.length > 0 ? 1.15 : 1.0
    };
  }

  /**
   * Enhanced team selection with rule-based scoring
   * @param {Array} availableTeams - Teams available for assignment
   * @param {Object} incident - The incident to assign
   * @param {Object} categorization - Incident categorization results
   * @returns {Promise<Object>} Selected team with detailed scoring
   */
  async selectBestTeamWithRules(availableTeams, incident, categorization) {
    try {
      // Apply geographic rules
      const geographicInfo = this.applyGeographicRules(incident, availableTeams);
      
      // Apply time-based rules
      const timeInfo = this.applyTimeBasedRules(new Date(incident.created_at), availableTeams);
      
      // Filter teams based on categorization rules
      const priorityCounts = await Promise.all(availableTeams.map(async (team) => ({
        team,
        count: await this.countPriorityAssignments(team.id, categorization.category)
      })));

      let eligibleTeams = priorityCounts.filter(({ team, count }) => {
        // Basic availability check
        if (!team.isAvailable || team.currentCapacity >= team.maxCapacity || team.memberCount === 0) {
          return false;
        }
        
        // Check priority-specific capacity limits
        const categoryRules = categorization.rules;
        return count < categoryRules.max_assignments_per_team;
      }).map(item => item.team);

      if (eligibleTeams.length === 0) {
        // Relax constraints if no teams available under strict rules
        eligibleTeams = availableTeams.filter(team => 
          team.isAvailable && team.currentCapacity < team.maxCapacity && team.memberCount > 0
        );
      }

      if (eligibleTeams.length === 0) {
        throw new Error('No eligible teams available for assignment under current rules');
      }

      // Enhanced scoring with rules
      const scoredTeams = eligibleTeams.map(team => {
        // Base capacity and utilization scores (from original algorithm)
        const capacityScore = team.maxCapacity - team.currentCapacity;
        const utilizationScore = 1 - (team.currentCapacity / team.maxCapacity);
        const priorityScore = team.priorityLevel;

        // Rule-based bonuses
        let ruleBonus = 1.0;
        
        // Geographic bonus
        if (geographicInfo.preferredTeams.includes(team)) {
          ruleBonus *= geographicInfo.boostFactor;
        }
        
        // Time-based bonus
        if (timeInfo.preferredTeams.includes(team)) {
          ruleBonus *= timeInfo.boostFactor;
        }
        
        // Team capability bonus
        const teamCapabilities = this.extractTeamCapabilities(team);
        const categoryCapabilities = categorization.rules.required_team_capabilities || [];
        
        const capabilityMatch = categoryCapabilities.some(cap => 
          teamCapabilities.includes(cap)
        );
        
        if (capabilityMatch) {
          ruleBonus *= 1.2; // 20% bonus for matching capabilities
        }
        
        // Apply capability-specific priority boost
        categoryCapabilities.forEach(cap => {
          const capRules = this.assignmentRules.team_capabilities[cap];
          if (capRules && teamCapabilities.includes(cap)) {
            ruleBonus *= capRules.priority_boost;
          }
        });

        // Final score calculation
        const finalScore = (
          (capacityScore / Math.max(...eligibleTeams.map(t => t.maxCapacity - t.currentCapacity))) * 0.3 +
          (utilizationScore) * 0.3 +
          (priorityScore / 5) * 0.2 +
          (ruleBonus - 1) * 0.2 // Rule bonus as 20% of final score
        );

        return {
          ...team,
          ruleBonus,
          finalScore,
          geographicMatch: geographicInfo.preferredTeams.includes(team),
          timeMatch: timeInfo.preferredTeams.includes(team),
          capabilityMatch,
          categorization: categorization.reasoning,
          appliedRules: {
            geographic: geographicInfo.zone !== 'unknown',
            timeBased: timeInfo.period !== 'business_hours' || timeInfo.preferredTeams.includes(team),
            capability: capabilityMatch
          }
        };
      });

      // Select team with highest score
      const selectedTeam = scoredTeams.reduce((best, current) => 
        current.finalScore > best.finalScore ? current : best
      );

      return selectedTeam;
    } catch (error) {
      console.error('Error in rule-based team selection:', error);
      throw error;
    }
  }

  /**
   * Extract team capabilities from team metadata
   * @param {Object} team - The team object
   * @returns {Array} List of team capabilities
   */
  extractTeamCapabilities(team) {
    // This would ideally come from team metadata/capabilities field
    // For now, infer from team name and properties
    const capabilities = ['standard_response']; // Default capability
    
    const teamName = team.name.toLowerCase();
    
    if (teamName.includes('emergency') || teamName.includes('urgent')) {
      capabilities.push('emergency_response');
    }
    
    if (teamName.includes('heavy') || teamName.includes('equipment')) {
      capabilities.push('heavy_equipment');
    }
    
    if (teamName.includes('maintenance')) {
      capabilities.push('maintenance');
    }
    
    return capabilities;
  }

  /**
   * Count current assignments of specific priority for a team
   * @param {string} teamId - Team ID
   * @param {string} priority - Priority category
   * @returns {Promise<number>} Count of assignments
   */
  async countPriorityAssignments(teamId, priority) {
    try {
      const jobCards = await JobCard.findAll({
        where: {
          team_id: teamId,
          status: { [Op.ne]: 'completed' }
        },
        include: [{
          model: Incident,
          where: { priority: priority },
          required: false
        }]
      });

      return jobCards.filter(jc => jc.Incident && jc.Incident.priority === priority).length;
    } catch (error) {
      console.error('Error counting priority assignments:', error);
      return 0;
    }
  }

  /**
   * Automatically assign all unassigned incidents
   * This is the main method for bulk automated assignment
   * @param {string} managerId - The manager's ID
   * @param {Object} options - Assignment options
   * @returns {Promise<Object>} Assignment results summary
   */
  async autoAssignAllIncidents(managerId, options = {}) {
    try {
      console.log(`Starting automated assignment for manager ${managerId}`);
      
      const {
        forceAssign = false, // Assign even if teams are at capacity
        dryRun = false, // Don't actually assign, just show what would happen
        priority = 'all', // 'critical', 'high', 'medium', 'low', 'all'
        maxIncidents = null // Limit number of incidents to process
      } = options;

      // Get all unassigned incidents
      const incidentWhere = {
        status: 'verified',
        assigned_team_id: null
      };

      if (priority !== 'all') {
        incidentWhere.priority = priority;
      }

      const unassignedIncidents = await Incident.findAll({
        where: incidentWhere,
        order: [['created_at', 'ASC']] // Process oldest first
      });

      let processedCount = 0;
      let assignedCount = 0;
      let failedCount = 0;
      const assignmentResults = [];
      const errors = [];

      for (const incident of unassignedIncidents) {
        // Check if we've reached the max incidents limit
        if (maxIncidents && processedCount >= maxIncidents) {
          break;
        }

        processedCount++;

        try {
          // Skip if recently processed (prevent duplicate assignments)
          const lastAssignment = this.assignmentHistory.get(incident.id);
          if (lastAssignment && Date.now() - lastAssignment < 60000) { // 1 minute cooldown
            console.log(`Skipping incident ${incident.id} - recently processed`);
            continue;
          }

          if (dryRun) {
            // Dry run - just analyze what would happen
            const categorization = this.categorizeIncident(incident);
            const availableTeams = await this.intelligentService.getAvailableTeams(managerId);
            const selectedTeam = await this.selectBestTeamWithRules(availableTeams, incident, categorization);
            
            assignmentResults.push({
              incidentId: incident.id,
              incidentTitle: incident.title,
              status: 'would_assign',
              selectedTeam: selectedTeam.name,
              category: categorization.category,
              reasoning: categorization.reasoning
            });
            
            assignedCount++;
          } else {
            // Actual assignment
            const result = await this.assignIncidentWithRules(incident.id, managerId);
            
            assignmentResults.push({
              incidentId: incident.id,
              incidentTitle: incident.title,
              status: 'assigned',
              teamName: result.selectedTeam.name,
              category: result.categorization.category,
              reasoning: result.categorization.reasoning
            });
            
            assignedCount++;
          }

          // Track assignment to prevent duplicates
          this.assignmentHistory.set(incident.id, Date.now());
          
          // Clean up old entries from history
          if (this.assignmentHistory.size > 1000) {
            const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
            for (const [incidentId, timestamp] of this.assignmentHistory.entries()) {
              if (timestamp < cutoff) {
                this.assignmentHistory.delete(incidentId);
              }
            }
          }

        } catch (error) {
          console.error(`Error processing incident ${incident.id}:`, error);
          failedCount++;
          errors.push({
            incidentId: incident.id,
            incidentTitle: incident.title,
            error: error.message
          });
        }
      }

      const summary = {
        success: true,
        processedCount,
        assignedCount,
        failedCount,
        totalUnassigned: unassignedIncidents.length,
        dryRun,
        timestamp: new Date(),
        results: assignmentResults,
        errors: errors.length > 0 ? errors : undefined
      };

      // Log the automated assignment activity
      await ActivityLog.create({
        user_id: managerId,
        action: `Automated assignment processed ${processedCount} incidents, assigned ${assignedCount}`,
        table_name: 'incidents',
        reference_id: null,
        details: JSON.stringify({
          type: 'automated_bulk_assignment',
          options: options,
          summary: summary
        })
      });

      console.log(`Automated assignment completed: ${assignedCount}/${processedCount} incidents assigned`);
      return summary;

    } catch (error) {
      console.error('Error in automated assignment:', error);
      throw error;
    }
  }

  /**
   * Assign single incident using rule-based system
   * @param {string} incidentId - The incident ID
   * @param {string} managerId - The manager's ID
   * @param {Object} options - Assignment options
   * @returns {Promise<Object>} Assignment result
   */
  async assignIncidentWithRules(incidentId, managerId, options = {}) {
    try {
      const incident = await Incident.findByPk(incidentId);
      if (!incident) {
        throw new Error('Incident not found');
      }

      if (incident.status !== 'verified') {
        throw new Error('Incident is not ready for assignment');
      }

      // Categorize the incident
      const categorization = this.categorizeIncident(incident);

      // Get available teams
      const availableTeams = await this.intelligentService.getAvailableTeams(managerId);

      // Select best team using rules
      const selectedTeam = await this.selectBestTeamWithRules(availableTeams, incident, categorization);

      if (!selectedTeam) {
        throw new Error('No suitable team found for assignment');
      }

      // Create job card
      const jobCard = await JobCard.create({
        incident_id: incidentId,
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

      // Update incident with categorization results
      await incident.update({
        status: 'In Progress',
        assigned_team_id: selectedTeam.id,
        assigned_at: new Date(),
        priority: categorization.category,
        category_reasoning: categorization.reasoning
      });

      // Log the rule-based assignment
      await ActivityLog.create({
        user_id: managerId,
        action: `Rule-based automated assignment: team ${selectedTeam.name} to incident "${incident.title}"`,
        table_name: 'job_cards',
        reference_id: jobCard.id,
        details: JSON.stringify({
          assignmentType: 'automated_rule_based',
          categorization: categorization,
          selectedTeam: {
            id: selectedTeam.id,
            name: selectedTeam.name,
            score: selectedTeam.finalScore
          },
          rulesApplied: selectedTeam.appliedRules,
          options: options
        })
      });

      return {
        success: true,
        jobCard,
        selectedTeam,
        categorization,
        reason: `Incident categorized as ${categorization.category}: ${categorization.reasoning}`,
        message: `Incident automatically assigned to team ${selectedTeam.name} based on rule analysis`
      };

    } catch (error) {
      console.error('Error in rule-based assignment:', error);
      throw error;
    }
  }

  /**
   * Get automation status and configuration
   * @param {string} managerId - The manager's ID
   * @returns {Promise<Object>} Automation status
   */
  async getAutomationStatus(managerId) {
    try {
      const unassignedIncidents = await Incident.count({
        where: {
          status: 'verified',
          assigned_team_id: null
        }
      });

      const totalIncidents = await Incident.count();
      const assignedIncidents = await Incident.count({
        where: {
          status: { [Op.ne]: 'verified' }
        }
      });

      return {
        automationEnabled: this.AUTOMATION_ENABLED,
        autoAssignInterval: this.AUTO_ASSIGN_INTERVAL,
        currentStats: {
          totalIncidents,
          assignedIncidents,
          unassignedIncidents,
          assignmentRate: totalIncidents > 0 ? Math.round((assignedIncidents / totalIncidents) * 100) : 0
        },
        assignmentRules: this.assignmentRules,
        lastAutomationRun: this.assignmentHistory.size > 0 ? 
          new Date(Math.max(...Array.from(this.assignmentHistory.values()))) : null
      };
    } catch (error) {
      console.error('Error fetching automation status:', error);
      throw error;
    }
  }
}

module.exports = AutomatedAssignmentService;