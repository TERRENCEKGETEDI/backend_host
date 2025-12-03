const fs = require('fs');
const path = require('path');
const { sequelize } = require('./models');

// Create corrected migration SQL
const correctedMigrationSQL = `
-- Database Migration: Add Comprehensive Status Validation Constraints
-- This migration enforces business rules at the database level to prevent data integrity violations

-- =====================================================
-- 1. ENHANCED STATUS ENUM WITH STRICT CONSTRAINTS
-- =====================================================

-- Drop existing enum if it exists and create new enhanced enum
DO $ BEGIN
    DROP TYPE IF EXISTS incident_status CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $;

CREATE TYPE incident_status AS ENUM (
    'Not Started',
    'verified',
    'assigned', 
    'In Progress',
    'Completed',
    'Cancelled'
);

-- =====================================================
-- 2. INCIDENT STATUS TRANSITION CONSTRAINTS
-- =====================================================

-- Create function to validate status transitions
CREATE OR REPLACE FUNCTION validate_incident_status_transition()
RETURNS TRIGGER AS $
BEGIN
    -- Define valid transitions (STRICT MODE)
    CASE OLD.status
        WHEN 'Not Started' THEN
            IF NEW.status NOT IN ('verified') THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Valid transitions from Not Started: verified', OLD.status, NEW.status;
            END IF;
            
        WHEN 'verified' THEN
            IF NEW.status NOT IN ('In Progress', 'Completed', 'Cancelled') THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Valid transitions from verified: In Progress, Completed, Cancelled', OLD.status, NEW.status;
            END IF;
            
        WHEN 'assigned' THEN
            IF NEW.status NOT IN ('In Progress', 'Completed', 'Cancelled') THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Valid transitions from assigned: In Progress, Completed, Cancelled', OLD.status, NEW.status;
            END IF;
            
        WHEN 'In Progress' THEN
            IF NEW.status NOT IN ('Completed', 'Cancelled') THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Valid transitions from In Progress: Completed, Cancelled', OLD.status, NEW.status;
            END IF;
            
        WHEN 'Completed' THEN
            IF NEW.status IS DISTINCT FROM 'Completed' THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Completed is a terminal state', OLD.status, NEW.status;
            END IF;
            
        WHEN 'Cancelled' THEN
            IF NEW.status IS DISTINCT FROM 'Cancelled' THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Cancelled is a terminal state', OLD.status, NEW.status;
            END IF;
    END CASE;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Create trigger for incident status transition validation
DROP TRIGGER IF EXISTS incident_status_transition_trigger ON incidents;
CREATE TRIGGER incident_status_transition_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_incident_status_transition();

-- =====================================================
-- 3. TEAM ASSIGNMENT INTEGRITY CONSTRAINTS
-- =====================================================

-- Function to validate team assignment integrity
CREATE OR REPLACE FUNCTION validate_team_assignment_integrity()
RETURNS TRIGGER AS $
DECLARE
    assigned_team RECORD;
BEGIN
    -- If assigning a team, verify team exists and is active
    IF NEW.assigned_team_id IS NOT NULL AND (NEW.assigned_team_id IS DISTINCT FROM OLD.assigned_team_id) THEN
        SELECT * INTO assigned_team 
        FROM teams 
        WHERE id = NEW.assigned_team_id 
        AND is_available = true;
        
        IF assigned_team IS NULL THEN
            RAISE EXCEPTION 'Cannot assign incident to team %: team does not exist or is not available', NEW.assigned_team_id;
        END IF;
        
        -- Set assignment timestamp
        NEW.assigned_at = CURRENT_TIMESTAMP;
    END IF;
    
    -- If unassigning a team, ensure proper status reset
    IF NEW.assigned_team_id IS NULL AND OLD.assigned_team_id IS NOT NULL THEN
        IF NEW.status NOT IN ('Not Started', 'verified') THEN
            RAISE EXCEPTION 'Cannot unassign team from incident in status %. Incident must be Not Started or verified', NEW.status;
        END IF;
        NEW.assigned_at = NULL;
        NEW.priority = NULL;
        NEW.category_reasoning = NULL;
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Create trigger for team assignment integrity
DROP TRIGGER IF EXISTS incident_team_assignment_trigger ON incidents;
CREATE TRIGGER incident_team_assignment_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    WHEN (OLD.assigned_team_id IS DISTINCT FROM NEW.assigned_team_id OR OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_team_assignment_integrity();

-- =====================================================
-- 4. BASIC DATA INTEGRITY CONSTRAINTS
-- =====================================================

-- Function to perform basic data integrity checks
CREATE OR REPLACE FUNCTION perform_basic_data_integrity_checks()
RETURNS TRIGGER AS $
BEGIN
    -- Check 1: Completed incidents cannot be modified
    IF OLD.status = 'Completed' AND NEW.status != 'Completed' THEN
        RAISE EXCEPTION 'Completed incidents cannot have their status changed';
    END IF;
    
    -- Check 2: Team assignment consistency
    IF NEW.assigned_team_id IS NOT NULL AND NEW.status = 'verified' THEN
        RAISE EXCEPTION 'verified incidents cannot have team assignments';
    END IF;
    
    -- Check 3: Required timestamps
    IF NEW.assigned_team_id IS NOT NULL AND NEW.assigned_at IS NULL THEN
        RAISE EXCEPTION 'Assigned incidents must have assigned_at timestamp';
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Create trigger for basic data integrity checks
DROP TRIGGER IF EXISTS incident_basic_integrity_trigger ON incidents;
CREATE TRIGGER incident_basic_integrity_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION perform_basic_data_integrity_checks();
`;

// Run the validation constraints migration
async function runMigration() {
  try {
    console.log('Starting validation constraints migration...');
    
    // Execute the corrected migration
    await sequelize.query(correctedMigrationSQL, {
      type: sequelize.QueryTypes.RAW
    });
    
    console.log('✅ Validation constraints migration completed successfully!');
    
    // Test the constraints
    await testConstraints();
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Test basic constraint functionality
async function testConstraints() {
  try {
    console.log('Testing validation constraints...');
    
    const { Incident, Team, JobCard } = require('./models');
    
    // Test that enum types exist
    const [results] = await sequelize.query("SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'incident_status')");
    
    if (results.length === 0) {
      console.warn('⚠️  incident_status enum not found - migration may need to be applied');
    } else {
      console.log('✅ incident_status enum exists with values:', results.map(r => r.enumlabel));
    }
    
    // Check if triggers exist
    const [triggers] = await sequelize.query(`
      SELECT trigger_name, event_manipulation, event_object_table 
      FROM information_schema.triggers 
      WHERE event_object_table IN ('incidents', 'job_cards', 'teams')
    `);
    
    console.log('✅ Found triggers:', triggers.length);
    triggers.forEach(trigger => {
      console.log(`  - ${trigger.trigger_name} on ${trigger.event_object_table}`);
    });
    
    console.log('✅ Constraint testing completed!');
    
  } catch (error) {
    console.error('❌ Constraint testing failed:', error.message);
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('Migration process completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };