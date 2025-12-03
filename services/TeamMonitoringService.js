const { Team, JobCard, ActivityLog } = require('../models');
const { Op } = require('sequelize');

class TeamMonitoringService {
  constructor() {
    this.monitoringInterval = null;
    this.isMonitoring = false;
  }

  /**
   * Start real-time team monitoring
   * @param {number} intervalMs - Monitoring interval in milliseconds (default: 5 minutes)
   */
  startMonitoring(intervalMs = 5 * 60 * 1000) {
    if (this.isMonitoring) {
      console.log('Team monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.updateAllTeamCapacities();
        await this.checkTeamAvailability();
        await this.updateTeamActivity();
      } catch (error) {
        console.error('Error in team monitoring:', error);
      }
    }, intervalMs);

    console.log('Team monitoring started with interval:', intervalMs, 'ms');
  }

  /**
   * Stop team monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.isMonitoring = false;
      console.log('Team monitoring stopped');
    }
  }

  /**
   * Update current capacity for all teams
   */
  async updateAllTeamCapacities() {
    try {
      const teams = await Team.findAll();
      
      for (const team of teams) {
        await this.updateTeamCapacity(team.id);
      }
    } catch (error) {
      console.error('Error updating team capacities:', error);
      throw error;
    }
  }

  /**
   * Update current capacity for a specific team
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Updated team data
   */
  async updateTeamCapacity(teamId) {
    try {
      const team = await Team.findByPk(teamId);
      if (!team) {
        throw new Error('Team not found');
      }

      // Count active (non-completed) job cards
      const activeJobCount = await JobCard.count({
        where: {
          team_id: teamId,
          status: {
            [Op.ne]: 'completed'
          }
        }
      });

      // Only update if capacity has changed
      if (team.current_capacity !== activeJobCount) {
        await team.update({
          current_capacity: activeJobCount,
          last_activity: new Date()
        });

        console.log(`Updated team ${team.name} capacity: ${activeJobCount}`);
      }

      return {
        id: team.id,
        name: team.name,
        current_capacity: activeJobCount,
        max_capacity: team.max_capacity,
        utilization_rate: team.max_capacity > 0 ? (activeJobCount / team.max_capacity) : 0
      };
    } catch (error) {
      console.error('Error updating team capacity:', error);
      throw error;
    }
  }

  /**
   * Check and update team availability based on capacity and scheduled availability
   */
  async checkTeamAvailability() {
    try {
      const teams = await Team.findAll();
      const now = new Date();
      
      for (const team of teams) {
        const shouldBeAvailable = this.shouldTeamBeAvailable(team, now);
        
        if (team.is_available !== shouldBeAvailable) {
          await team.update({
            is_available: shouldBeAvailable,
            last_activity: now
          });

          // Log availability change
          await ActivityLog.create({
            user_id: null, // System action
            action: `Team ${team.name} availability ${shouldBeAvailable ? 'enabled' : 'disabled'} automatically`,
            table_name: 'teams',
            reference_id: team.id,
            details: JSON.stringify({
              reason: 'Automatic capacity check',
              previous_state: team.is_available,
              new_state: shouldBeAvailable,
              current_capacity: team.current_capacity,
              max_capacity: team.max_capacity
            })
          });

          console.log(`Team ${team.name} availability updated: ${shouldBeAvailable}`);
        }
      }
    } catch (error) {
      console.error('Error checking team availability:', error);
      throw error;
    }
  }

  /**
   * Determine if a team should be available based on capacity and schedule
   * @param {Object} team - Team object
   * @param {Date} now - Current date/time
   * @returns {boolean} Whether team should be available
   */
  shouldTeamBeAvailable(team, now) {
    // If team has available_from set and it's in the future, team should not be available
    if (team.available_from && new Date(team.available_from) > now) {
      return false;
    }

    // If team is over capacity, it should not be available
    if (team.current_capacity >= team.max_capacity) {
      return false;
    }

    // If available_from is in the past or null, team should be available
    return true;
  }

  /**
   * Update team last_activity timestamp
   */
  async updateTeamActivity() {
    try {
      const teams = await Team.findAll();
      const now = new Date();

      for (const team of teams) {
        // Check if team has recent activity (job started/completed in last hour)
        const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
        
        const recentActivity = await JobCard.findOne({
          where: {
            team_id: team.id,
            updated_at: {
              [Op.gte]: oneHourAgo
            }
          }
        });

        // If team has recent activity but no last_activity, or last activity is stale
        if (recentActivity && (!team.last_activity || new Date(team.last_activity) < oneHourAgo)) {
          await team.update({
            last_activity: now
          });
        }
      }
    } catch (error) {
      console.error('Error updating team activity:', error);
      throw error;
    }
  }

  /**
   * Get detailed team monitoring data
   * @param {string} teamId - Optional team ID to get data for specific team
   * @returns {Promise<Object>} Monitoring data
   */
  async getTeamMonitoringData(teamId = null) {
    try {
      let teams;
      if (teamId) {
        const team = await Team.findByPk(teamId);
        teams = team ? [team] : [];
      } else {
        teams = await Team.findAll();
      }

      const monitoringData = [];
      
      for (const team of teams) {
        // Get job distribution
        const jobDistribution = await this.getJobDistribution(team.id);
        
        // Calculate health metrics
        const healthMetrics = await this.calculateHealthMetrics(team.id);
        
        // Get capacity trends (simplified)
        const capacityTrends = await this.getCapacityTrends(team.id);

        monitoringData.push({
          teamId: team.id,
          teamName: team.name,
          capacity: {
            current: team.current_capacity,
            max: team.max_capacity,
            utilization: team.max_capacity > 0 ? (team.current_capacity / team.max_capacity) : 0,
            availableSlots: Math.max(0, team.max_capacity - team.current_capacity)
          },
          availability: {
            isAvailable: team.is_available,
            availableFrom: team.available_from,
            lastActivity: team.last_activity
          },
          jobDistribution,
          healthMetrics,
          capacityTrends,
          lastUpdated: new Date()
        });
      }

      return {
        success: true,
        data: teamId ? monitoringData[0] : monitoringData,
        totalTeams: teams.length,
        monitoringStatus: this.isMonitoring,
        monitoringInterval: this.monitoringInterval ? 'active' : 'inactive'
      };
    } catch (error) {
      console.error('Error fetching monitoring data:', error);
      throw error;
    }
  }

  /**
   * Get job distribution for a team
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Job distribution data
   */
  async getJobDistribution(teamId) {
    try {
      const jobCounts = await JobCard.findAll({
        where: { team_id: teamId },
        attributes: [
          'status',
          [JobCard.sequelize.fn('COUNT', JobCard.sequelize.col('status')), 'count']
        ],
        group: ['status']
      });

      const distribution = {
        not_started: 0,
        in_progress: 0,
        completed: 0,
        total: 0
      };

      jobCounts.forEach(row => {
        distribution[row.status] = parseInt(row.get('count'));
        distribution.total += parseInt(row.get('count'));
      });

      return distribution;
    } catch (error) {
      console.error('Error getting job distribution:', error);
      throw error;
    }
  }

  /**
   * Calculate health metrics for a team
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Health metrics
   */
  async calculateHealthMetrics(teamId) {
    try {
      const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
      
      const recentJobs = await JobCard.findAll({
        where: {
          team_id: teamId,
          assigned_at: {
            [Op.gte]: sevenDaysAgo
          }
        }
      });

      const totalJobs = recentJobs.length;
      const completedJobs = recentJobs.filter(job => job.status === 'completed').length;
      const completionRate = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;
      
      // Calculate average completion time (simplified)
      let averageCompletionTime = 0;
      if (completedJobs > 0) {
        const completedJobTimes = recentJobs
          .filter(job => job.status === 'completed' && job.completed_at && job.assigned_at)
          .map(job => new Date(job.completed_at) - new Date(job.assigned_at));
        
        if (completedJobTimes.length > 0) {
          averageCompletionTime = completedJobTimes.reduce((sum, time) => sum + time, 0) / completedJobTimes.length;
        }
      }

      return {
        totalJobs7Days: totalJobs,
        completedJobs7Days: completedJobs,
        completionRate: Math.round(completionRate),
        averageCompletionTime: Math.round(averageCompletionTime / (1000 * 60 * 60)), // Convert to hours
        isHealthy: completionRate >= 80 && averageCompletionTime <= 24 // Health criteria
      };
    } catch (error) {
      console.error('Error calculating health metrics:', error);
      throw error;
    }
  }

  /**
   * Get capacity trends for a team (simplified)
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Capacity trends
   */
  async getCapacityTrends(teamId) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
      
      const dailyCounts = [];
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const count = await JobCard.count({
          where: {
            team_id: teamId,
            assigned_at: {
              [Op.gte]: date,
              [Op.lt]: nextDate
            },
            status: {
              [Op.ne]: 'completed'
            }
          }
        });

        dailyCounts.push({
          date: date.toISOString().split('T')[0],
          activeJobs: count
        });
      }

      return {
        dailyActiveJobs: dailyCounts,
        trend: this.calculateTrend(dailyCounts)
      };
    } catch (error) {
      console.error('Error getting capacity trends:', error);
      throw error;
    }
  }

  /**
   * Calculate trend from daily data
   * @param {Array} dailyData - Daily capacity data
   * @returns {string} Trend direction
   */
  calculateTrend(dailyData) {
    if (dailyData.length < 7) return 'insufficient_data';
    
    const recent = dailyData.slice(-7).reduce((sum, d) => sum + d.activeJobs, 0) / 7;
    const previous = dailyData.slice(-14, -7).reduce((sum, d) => sum + d.activeJobs, 0) / 7;
    
    const change = ((recent - previous) / previous) * 100;
    
    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  }

  /**
   * Get system-wide monitoring summary
   * @returns {Promise<Object>} System monitoring summary
   */
  async getSystemMonitoringSummary() {
    try {
      const teams = await Team.findAll();
      
      const summary = {
        totalTeams: teams.length,
        availableTeams: teams.filter(t => t.is_available).length,
        overCapacityTeams: teams.filter(t => t.current_capacity >= t.max_capacity).length,
        averageUtilization: 0,
        totalActiveJobs: 0,
        totalCapacity: 0,
        usedCapacity: 0
      };

      teams.forEach(team => {
        summary.totalActiveJobs += team.current_capacity;
        summary.totalCapacity += team.max_capacity;
        summary.usedCapacity += team.current_capacity;
      });

      summary.averageUtilization = summary.totalCapacity > 0 
        ? Math.round((summary.usedCapacity / summary.totalCapacity) * 100)
        : 0;

      return {
        success: true,
        data: summary,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Error getting system monitoring summary:', error);
      throw error;
    }
  }
}

module.exports = TeamMonitoringService;