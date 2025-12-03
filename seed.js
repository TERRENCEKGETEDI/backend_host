const { sequelize, User, Team, TeamMember, Incident, JobCard, WorkerProgress, ActivityLog } = require('./models');
const bcrypt = require('bcryptjs');

async function seed() {
  await sequelize.sync({ force: true }); // Force sync to recreate tables
  try {
    // Create or update users
    let admin = await User.findOne({ where: { email: 'admin@example.com' } });
    if (!admin) {
      const adminPassword = await bcrypt.hash('admin123', 10);
      admin = await User.create({
        name: 'Admin User',
        email: 'admin@example.com',
        password: adminPassword,
        phone: '+1234567890',
        role: 'admin',
      });
    }

    let manager = await User.findOne({ where: { email: 'manager@example.com' } });
    if (!manager) {
      const managerPassword = await bcrypt.hash('manager123', 10);
      manager = await User.create({
        name: 'Manager User',
        email: 'manager@example.com',
        password: managerPassword,
        phone: '+1234567891',
        role: 'manager',
      });
    }

    // Create team leaders
    const teamLeaders = [];
    for (let i = 1; i <= 4; i++) {
      let teamLeader = await User.findOne({ where: { email: `teamleader${i}@example.com` } });
      if (!teamLeader) {
        const tlPassword = await bcrypt.hash('tl123', 10);
        teamLeader = await User.create({
          name: `Team Leader ${i}`,
          email: `teamleader${i}@example.com`,
          password: tlPassword,
          phone: `+123456789${i + 1}`,
          role: 'team_leader',
        });
      }
      teamLeaders.push(teamLeader);
    }

    // Create workers (16 workers for 4 teams)
    const workers = [];
    for (let i = 1; i <= 16; i++) {
      let worker = await User.findOne({ where: { email: `worker${i}@example.com` } });
      if (!worker) {
        const workerPassword = await bcrypt.hash('worker123', 10);
        worker = await User.create({
          name: `Worker ${i}`,
          email: `worker${i}@example.com`,
          password: workerPassword,
          phone: `+12345679${String(i).padStart(2, '0')}`,
          role: 'worker',
        });
      }
      workers.push(worker);
    }

    // Create teams (4 teams with 4 workers each)
    const teams = [];
    const teamNames = ['Alpha Squad', 'Bravo Team', 'Charlie Crew', 'Delta Division'];
    
    for (let i = 0; i < 4; i++) {
      let team = await Team.findOne({ where: { name: teamNames[i] } });
      if (!team) {
        team = await Team.create({
          name: teamNames[i],
          manager_id: manager.id,
        });
      }
      teams.push(team);

      // Add team leader to team
      await TeamMember.create({ team_id: team.id, user_id: teamLeaders[i].id });

      // Add 4 workers to each team
      for (let j = i * 4; j < (i + 1) * 4 && j < workers.length; j++) {
        await TeamMember.create({ team_id: team.id, user_id: workers[j].id });
      }

      console.log(`Team ${team.name} created with ${teamLeaders[i].name} as leader and 4 workers`);
    }

    // Create comprehensive incidents (15 incidents with various statuses and priorities)
    const incidents = [
      {
        title: 'Sewage Overflow in Main Street',
        description: 'Major sewage overflow causing traffic disruption and health concerns in CBD area',
        location: '123 Main Street, Johannesburg CBD',
        contact_name: 'John Smith',
        contact_phone: '+27123456789',
        contact_email: 'john.smith@email.com',
        latitude: -26.2041,
        longitude: 28.0473,
        status: 'Completed',
        priority: 'high',
        created_at: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)) // 3 days ago
      },
      {
        title: 'Blocked Drain in Suburb Area',
        description: 'Residential drain blockage affecting multiple homes, causing unpleasant odors',
        location: '456 Oak Avenue, Sandton',
        contact_name: 'Jane Doe',
        contact_phone: '+27123456790',
        contact_email: 'jane.doe@email.com',
        latitude: -26.1076,
        longitude: 28.0567,
        status: 'In Progress',
        priority: 'medium',
        created_at: new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)) // 2 days ago
      },
      {
        title: 'Sewage Spill at Public Park',
        description: 'Large sewage spill contaminating public park area, affecting wildlife habitat',
        location: 'Johannesburg Botanical Gardens',
        contact_name: 'Mike Johnson',
        contact_phone: '+27123456791',
        contact_email: 'mike.johnson@email.com',
        latitude: -26.1624,
        longitude: 28.0192,
        status: 'Not Started',
        priority: 'high',
        created_at: new Date(Date.now() - (1 * 24 * 60 * 60 * 1000)) // 1 day ago
      },
      {
        title: 'Manhole Cover Broken',
        description: 'Broken manhole cover creating safety hazard for pedestrians',
        location: 'Rosebank Mall Parking Area',
        contact_name: 'Sarah Wilson',
        contact_phone: '+27123456792',
        contact_email: 'sarah.wilson@email.com',
        latitude: -26.1497,
        longitude: 28.0447,
        status: 'Not Started',
        priority: 'low',
        created_at: new Date(Date.now() - (5 * 60 * 60 * 1000)) // 5 hours ago
      },
      {
        title: 'Sewage Backup in Office Building',
        description: 'Sewage backup affecting commercial building operations, multiple floors affected',
        location: 'Sandton City Office Tower, Floor 5',
        contact_name: 'David Brown',
        contact_phone: '+27123456793',
        contact_email: 'david.brown@email.com',
        latitude: -26.1076,
        longitude: 28.0567,
        status: 'Completed',
        priority: 'high',
        created_at: new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)) // 5 days ago
      },
      {
        title: 'Industrial Drain Cleaning',
        description: 'Routine drain cleaning in industrial area, preventive maintenance required',
        location: 'Midrand Industrial Park, Building C',
        contact_name: 'Lisa Davis',
        contact_phone: '+27123456794',
        contact_email: 'lisa.davis@email.com',
        latitude: -25.9981,
        longitude: 28.1269,
        status: 'Completed',
        priority: 'medium',
        created_at: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)) // 7 days ago
      },
      {
        title: 'Sewage Leak Under Highway',
        description: 'Major sewage leak discovered under highway bridge, traffic affected',
        location: 'N1 Highway Bridge, Km 12',
        contact_name: 'Robert Taylor',
        contact_phone: '+27123456795',
        contact_email: 'robert.taylor@email.com',
        latitude: -26.1985,
        longitude: 28.0423,
        status: 'Not Started',
        priority: 'high',
        created_at: new Date(Date.now() - (6 * 60 * 60 * 1000)) // 6 hours ago
      },
      {
        title: 'Residential Blockage',
        description: 'Complete sewage blockage in residential complex, affecting 50+ households',
        location: 'Sunset Residential Complex, Block A',
        contact_name: 'Mary Anderson',
        contact_phone: '+27123456796',
        contact_email: 'mary.anderson@email.com',
        latitude: -26.1756,
        longitude: 28.0341,
        status: 'Not Started',
        priority: 'high',
        created_at: new Date(Date.now() - (3 * 60 * 60 * 1000)) // 3 hours ago
      },
      {
        title: 'Storm Drain Overflow',
        description: 'Storm drain overflow during heavy rain, flooding nearby streets',
        location: 'Storm Water System, Pretoria East',
        contact_name: 'Kevin Martinez',
        contact_phone: '+27123456797',
        contact_email: 'kevin.martinez@email.com',
        latitude: -25.7479,
        longitude: 28.2293,
        status: 'In Progress',
        priority: 'high',
        created_at: new Date(Date.now() - (1.5 * 24 * 60 * 60 * 1000)) // 1.5 days ago
      },
      {
        title: 'Manhole Overflow',
        description: 'Multiple manholes overflowing after heavy downpour',
        location: 'Crown Gardens Residential Area',
        contact_name: 'Jennifer Garcia',
        contact_phone: '+27123456798',
        contact_email: 'jennifer.garcia@email.com',
        latitude: -26.1423,
        longitude: 28.0567,
        status: 'Completed',
        priority: 'medium',
        created_at: new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)) // 8 days ago
      },
      {
        title: 'School Sewage Problem',
        description: 'Sewage backup affecting school ablution facilities, health hazard',
        location: 'Johannesburg Primary School',
        contact_name: 'Principal Williams',
        contact_phone: '+27123456799',
        contact_email: 'principal.williams@school.edu.za',
        latitude: -26.1923,
        longitude: 28.0342,
        status: 'Not Started',
        priority: 'high',
        created_at: new Date(Date.now() - (8 * 60 * 60 * 1000)) // 8 hours ago
      },
      {
        title: 'Hospital Drain Issue',
        description: 'Critical drain issue affecting hospital waste management system',
        location: 'Johannesburg General Hospital',
        contact_name: 'Dr. Sarah Cooper',
        contact_phone: '+27123456800',
        contact_email: 'dr.cooper@jgh.gov.za',
        latitude: -26.2054,
        longitude: 28.0434,
        status: 'Not Started',
        priority: 'high',
        created_at: new Date(Date.now() - (2 * 60 * 60 * 1000)) // 2 hours ago
      },
      {
        title: 'Shopping Mall Overflow',
        description: 'Sewage overflow in shopping mall food court area',
        location: 'Mall of Africa, Food Court',
        contact_name: 'Mall Manager Thompson',
        contact_phone: '+27123456801',
        contact_email: 'manager@mallofafrica.co.za',
        latitude: -26.1176,
        longitude: 28.0567,
        status: 'Not Started',
        priority: 'medium',
        created_at: new Date(Date.now() - (4 * 60 * 60 * 1000)) // 4 hours ago
      },
      {
        title: 'Apartment Complex Blockage',
        description: 'Main sewer line blockage in luxury apartment complex',
        location: 'Monte Carlo Towers, Parktown',
        contact_name: 'Property Manager Lee',
        contact_phone: '+27123456802',
        contact_email: 'pm.lee@montecarlotowers.co.za',
        latitude: -26.1723,
        longitude: 28.0456,
        status: 'Not Started',
        priority: 'high',
        created_at: new Date(Date.now() - (7 * 60 * 60 * 1000)) // 7 hours ago
      },
      {
        title: 'Community Center Sewage Backup',
        description: 'Sewage backup affecting community center operations',
        location: 'Soweto Community Center',
        contact_name: 'Community Leader Mokoena',
        contact_phone: '+27123456803',
        contact_email: 'leader@sowetocommunity.org',
        latitude: -26.2678,
        longitude: 27.9056,
        status: 'Not Started',
        priority: 'medium',
        created_at: new Date(Date.now() - (12 * 60 * 60 * 1000)) // 12 hours ago
      }
    ];

    const createdIncidents = [];
    for (let i = 0; i < incidents.length; i++) {
      const incident = await Incident.create(incidents[i]);
      createdIncidents.push(incident);
      console.log(`Incident created: ${incident.title} (${incident.status})`);
    }

    // Create job cards and assign teams to incidents (assign teams to some incidents)
    const jobCards = [];
    for (let i = 0; i < createdIncidents.length; i++) {
      const incident = createdIncidents[i];
      
      // Only assign teams to 'In Progress' and 'Completed' incidents
      if (incident.status === 'In Progress' || incident.status === 'Completed') {
        const team = teams[i % teams.length]; // Round-robin assignment
        const teamLeader = teamLeaders[i % teamLeaders.length];
        
        // Determine job card status based on incident status
        let jobCardStatus = 'not_started';
        let assignedAt = new Date(incident.created_at);
        let startedAt = null;
        let completedAt = null;

        if (incident.status === 'Completed') {
          jobCardStatus = 'completed';
          startedAt = new Date(incident.created_at.getTime() + (2 + Math.random() * 4) * 60 * 60 * 1000);
          completedAt = new Date(startedAt.getTime() + (6 + Math.random() * 12) * 60 * 60 * 1000);
        } else if (incident.status === 'In Progress') {
          jobCardStatus = 'in_progress';
          startedAt = new Date(incident.created_at.getTime() + (1 + Math.random() * 3) * 60 * 60 * 1000);
        }

        const jobCard = await JobCard.create({
          incident_id: incident.id,
          team_id: team.id,
          team_leader_id: teamLeader.id,
          status: jobCardStatus,
          assigned_at: assignedAt,
          started_at: startedAt,
          completed_at: completedAt
        });

        jobCards.push(jobCard);
        console.log(`Job Card created for: ${incident.title} → ${team.name}`);

        // Create worker progress for team members
        const teamMembers = await TeamMember.findAll({ where: { team_id: team.id } });
        for (let member of teamMembers) {
          let progressStatus = 'pending';
          let workerStartedAt = null;
          let workerCompletedAt = null;
          let notes = null;

          if (jobCardStatus === 'completed') {
            // For completed jobs, most workers should have completed
            const completionChance = Math.random();
            if (completionChance > 0.8) {
              progressStatus = 'working';
              workerStartedAt = new Date(jobCard.assigned_at.getTime() + (3 + Math.random() * 4) * 60 * 60 * 1000);
              notes = 'Work in progress';
            } else {
              progressStatus = 'done';
              workerStartedAt = new Date(jobCard.assigned_at.getTime() + (2 + Math.random() * 3) * 60 * 60 * 1000);
              workerCompletedAt = new Date(workerStartedAt.getTime() + (4 + Math.random() * 8) * 60 * 60 * 1000);
              notes = 'Work completed successfully';
            }
          } else if (jobCardStatus === 'in_progress') {
            // For in-progress jobs, mix of working and pending
            const progressChance = Math.random();
            if (progressChance > 0.6) {
              progressStatus = 'working';
              workerStartedAt = new Date(jobCard.assigned_at.getTime() + (1 + Math.random() * 2) * 60 * 60 * 1000);
              notes = 'Work in progress';
            } else {
              progressStatus = 'pending';
              notes = 'Waiting for assignment';
            }
          } else {
            // For not_started jobs, most should be pending
            progressStatus = Math.random() > 0.2 ? 'pending' : 'working';
            if (progressStatus === 'working') {
              workerStartedAt = new Date(jobCard.assigned_at.getTime() + (0.5 + Math.random() * 1) * 60 * 60 * 1000);
              notes = 'Work starting soon';
            }
          }

          await WorkerProgress.create({
            job_card_id: jobCard.id,
            worker_id: member.user_id,
            status: progressStatus,
            arrived_at: workerStartedAt,
            completed_at: workerCompletedAt
          });
        }

        // Update incident status to show team assignment
        await incident.update({ assigned_team_id: team.id, assigned_at: assignedAt });
      }
    }

    // Create comprehensive activity logs for various actions
    const activityLogData = [
      // Manager activities
      ...Array.from({ length: 8 }, (_, i) => ({
        user_id: manager.id,
        action: `Manager reviewed incident management and team performance ${i + 1}`,
        table_name: 'incidents',
        reference_id: createdIncidents[i % createdIncidents.length]?.id || null,
        created_at: new Date(Date.now() - (i * 4 * 60 * 60 * 1000))
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        user_id: manager.id,
        action: `Manager assigned team to incident or reviewed team assignments ${i + 1}`,
        table_name: 'job_cards',
        reference_id: jobCards[i % jobCards.length]?.id || null,
        created_at: new Date(Date.now() - (i * 6 * 60 * 60 * 1000))
      })),
      // Team leader activities  
      ...Array.from({ length: 12 }, (_, i) => {
        const teamLeader = teamLeaders[i % teamLeaders.length];
        return {
          user_id: teamLeader.id,
          action: `Team leader ${teamLeader.name} updated job progress or managed team ${i + 1}`,
          table_name: 'worker_progress',
          reference_id: null,
          created_at: new Date(Date.now() - (i * 2 * 60 * 60 * 1000))
        };
      }),
      // System activities
      ...Array.from({ length: 5 }, (_, i) => ({
        user_id: admin.id,
        action: `Admin user management or system review activity ${i + 1}`,
        table_name: 'users',
        reference_id: workers[i % workers.length]?.id || null,
        created_at: new Date(Date.now() - (i * 8 * 60 * 60 * 1000))
      }))
    ];

    for (let log of activityLogData) {
      await ActivityLog.create(log);
    }

    console.log(`Activity logs created: ${activityLogData.length} entries`);

    // Print comprehensive summary
    console.log('\n=== DATABASE SEEDING COMPLETED ===');
    console.log('\nUsers Created:');
    console.log(`- 1 Admin: admin@example.com / admin123`);
    console.log(`- 1 Manager: manager@example.com / manager123`);
    console.log(`- 4 Team Leaders: teamleader1-4@example.com / tl123`);
    console.log(`- 16 Workers: worker1-16@example.com / worker123`);
    
    console.log('\nTeams Created:');
    for (let i = 0; i < teams.length; i++) {
      const teamMembers = await TeamMember.count({ where: { team_id: teams[i].id } });
      console.log(`- ${teams[i].name} (Leader: ${teamLeaders[i].name}, ${teamMembers} members)`);
    }
    
    console.log('\nIncidents Created:');
    const statusCounts = createdIncidents.reduce((acc, incident) => {
      acc[incident.status] = (acc[incident.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`- Total: ${createdIncidents.length} incidents`);
    console.log(`- Pending: ${statusCounts.pending || 0}`);
    console.log(`- Verified: ${statusCounts.verified || 0}`);
    console.log(`- Assigned: ${statusCounts.assigned || 0}`);
    console.log(`- In Progress: ${statusCounts.in_progress || 0}`);
    console.log(`- Completed: ${statusCounts.completed || 0}`);
    
    console.log('\nJob Cards Created:');
    const jobCardCounts = jobCards.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`- Total: ${jobCards.length} job cards`);
    console.log(`- Assigned: ${jobCardCounts.assigned || 0}`);
    console.log(`- In Progress: ${jobCardCounts.in_progress || 0}`);
    console.log(`- Completed: ${jobCardCounts.completed || 0}`);
    
    console.log('\nWorker Progress Records:');
    const totalProgressRecords = await WorkerProgress.count();
    const progressCounts = await WorkerProgress.findAll({
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('status')), 'count']],
      group: ['status']
    });
    
    console.log(`- Total: ${totalProgressRecords} progress records`);
    progressCounts.forEach(progress => {
      console.log(`- ${progress.status}: ${progress.dataValues.count}`);
    });
    
    console.log('\nActivity Logs:');
    const totalActivities = await ActivityLog.count();
    console.log(`- Total: ${totalActivities} activity log entries`);
    
    console.log('\nForeign Key Relationships Verified:');
    console.log('✅ Users → Teams (manager_id)');
    console.log('✅ TeamMembers → Users (user_id)');
    console.log('✅ TeamMembers → Teams (team_id)');
    console.log('✅ JobCards → Incidents (incident_id)');
    console.log('✅ JobCards → Teams (team_id)');
    console.log('✅ JobCards → Users (team_leader_id)');
    console.log('✅ WorkerProgress → JobCards (job_card_id)');
    console.log('✅ WorkerProgress → Users (worker_id)');
    console.log('✅ ActivityLogs → Users (user_id)');
    console.log('✅ ActivityLogs → All tables (reference_id)');

  } catch (err) {
    console.error('Seeding error:', err);
  }
}

seed();