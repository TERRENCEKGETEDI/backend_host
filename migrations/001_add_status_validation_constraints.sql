-- Database Migration: Add Comprehensive Status Validation Constraints
-- This migration enforces business rules at the database level to prevent data integrity violations

-- =====================================================
-- 1. ENHANCED STATUS ENUM WITH STRICT CONSTRAINTS
-- =====================================================

-- Drop existing enum if it exists and create new enhanced enum
DO $$ BEGIN
    DROP TYPE IF EXISTS incident_status CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TYPE incident_status AS ENUM (
    'Not Started',
    'verified',
    'assigned', 
    'In Progress',
    'Completed',
    'Cancelled'
);

-- =====================================================
-- 2. ENHANCED JOB CARD STATUS ENUM
-- =====================================================

DO $$ BEGIN
    DROP TYPE IF EXISTS job_card_status CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TYPE job_card_status AS ENUM (
    'not_started',
    'in_progress', 
    'completed',
    'cancelled'
);

-- =====================================================
-- 3. INCIDENT STATUS TRANSITION CONSTRAINTS
-- =====================================================

-- Create function to validate status transitions
CREATE OR REPLACE FUNCTION validate_incident_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Define valid transitions (STRICT MODE)
    CASE OLD.status
        WHEN 'Not Started' THEN
            IF NEW.status NOT IN ('verified') THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Valid transitions from Not Started: verified', OLD.status, NEW.status;
            END IF;
            
        WHEN 'verified' THEN
            IF NEW.status NOT IN ('assigned') THEN
                RAISE EXCEPTION 'Invalid status transition from % to %. Valid transitions from verified: assigned', OLD.status, NEW.status;
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
$$ LANGUAGE plpgsql;

-- Create trigger for incident status transition validation
DROP TRIGGER IF EXISTS incident_status_transition_trigger ON incidents;
CREATE TRIGGER incident_status_transition_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_incident_status_transition();

-- =====================================================
-- 4. TEAM ASSIGNMENT INTEGRITY CONSTRAINTS
-- =====================================================

-- Function to validate team assignment integrity
CREATE OR REPLACE FUNCTION validate_team_assignment_integrity()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- Create trigger for team assignment integrity
DROP TRIGGER IF EXISTS incident_team_assignment_trigger ON incidents;
CREATE TRIGGER incident_team_assignment_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    WHEN (OLD.assigned_team_id IS DISTINCT FROM NEW.assigned_team_id OR OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_team_assignment_integrity();

-- =====================================================
-- 5. JOB CARD INTEGRITY CONSTRAINTS
-- =====================================================

-- Function to validate job card creation and updates
CREATE OR REPLACE FUNCTION validate_job_card_integrity()
RETURNS TRIGGER AS $$
DECLARE
    incident_record RECORD;
    team_record RECORD;
BEGIN
    -- Validate incident exists
    SELECT * INTO incident_record FROM incidents WHERE id = NEW.incident_id;
    IF incident_record IS NULL THEN
        RAISE EXCEPTION 'Job card references non-existent incident %', NEW.incident_id;
    END IF;
    
    -- Validate team exists
    SELECT * INTO team_record FROM teams WHERE id = NEW.team_id;
    IF team_record IS NULL THEN
        RAISE EXCEPTION 'Job card references non-existent team %', NEW.team_id;
    END IF;
    
    -- Validate team assignment consistency
    IF NEW.incident_id IS NOT NULL THEN
        IF incident_record.assigned_team_id IS NOT NULL AND incident_record.assigned_team_id != NEW.team_id THEN
            RAISE EXCEPTION 'Job card team % does not match incident assigned team %', NEW.team_id, incident_record.assigned_team_id;
        END IF;
    END IF;
    
    -- Set timestamps
    IF NEW.assigned_at IS NULL THEN
        NEW.assigned_at = CURRENT_TIMESTAMP;
    END IF;
    
    -- Validate job card status transitions
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        CASE OLD.status
            WHEN 'not_started' THEN
                IF NEW.status NOT IN ('in_progress', 'completed', 'cancelled') THEN
                    RAISE EXCEPTION 'Invalid job card status transition from % to %', OLD.status, NEW.status;
                END IF;
            WHEN 'in_progress' THEN
                IF NEW.status NOT IN ('completed', 'cancelled') THEN
                    RAISE EXCEPTION 'Invalid job card status transition from % to %', OLD.status, NEW.status;
                END IF;
            WHEN 'completed' THEN
                RAISE EXCEPTION 'Job card status % is terminal and cannot be changed', OLD.status;
            WHEN 'cancelled' THEN
                RAISE EXCEPTION 'Job card status % is terminal and cannot be changed', OLD.status;
        END CASE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for job card integrity
DROP TRIGGER IF EXISTS job_card_integrity_trigger ON job_cards;
CREATE TRIGGER job_card_integrity_trigger
    BEFORE INSERT OR UPDATE ON job_cards
    FOR EACH ROW
    EXECUTE FUNCTION validate_job_card_integrity();

-- =====================================================
-- 6. CAPACITY CONSTRAINTS
-- =====================================================

-- Function to enforce team capacity limits
CREATE OR REPLACE FUNCTION enforce_team_capacity_limit()
RETURNS TRIGGER AS $$
DECLARE
    team_capacity INTEGER;
    current_assignments INTEGER;
BEGIN
    -- Get team capacity info
    SELECT current_capacity, max_capacity INTO team_capacity, current_assignments
    FROM teams
    WHERE id = NEW.team_id;
    
    -- For new job cards, check if team has capacity
    IF TG_OP = 'INSERT' THEN
        IF current_assignments >= team_capacity THEN
            RAISE EXCEPTION 'Team % is at maximum capacity (% assignments)', NEW.team_id, team_capacity;
        END IF;
        
        -- Update team current_capacity
        UPDATE teams 
        SET current_capacity = current_capacity + 1,
            last_activity = CURRENT_TIMESTAMP
        WHERE id = NEW.team_id;
    END IF;
    
    -- For job card completion, decrement capacity
    IF TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed' THEN
        UPDATE teams 
        SET current_capacity = GREATEST(0, current_capacity - 1),
            last_activity = CURRENT_TIMESTAMP
        WHERE id = NEW.team_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for team capacity enforcement
DROP TRIGGER IF EXISTS team_capacity_enforcement_trigger ON job_cards;
CREATE TRIGGER team_capacity_enforcement_trigger
    AFTER INSERT OR UPDATE ON job_cards
    FOR EACH ROW
    WHEN (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed'))
    EXECUTE FUNCTION enforce_team_capacity_limit();

-- =====================================================
-- 7. DATA INTEGRITY CHECKS
-- =====================================================

-- Function to perform comprehensive data integrity checks
CREATE OR REPLACE FUNCTION perform_data_integrity_checks()
RETURNS TRIGGER AS $$
DECLARE
    integrity_violations TEXT[];
BEGIN
    integrity_violations = ARRAY[]::TEXT[];
    
    -- Check 1: Completed incidents cannot be modified
    IF TG_OP = 'UPDATE' AND OLD.status = 'Completed' AND NEW.status != 'Completed' THEN
        integrity_violations = array_append(integrity_violations, 'Completed incidents cannot have their status changed');
    END IF;
    
    -- Check 2: Team assignment consistency
    IF NEW.assigned_team_id IS NOT NULL AND NEW.status = 'verified' THEN
        integrity_violations = array_append(integrity_violations, 'verified incidents cannot have team assignments');
    END IF;
    
    -- Check 3: Required timestamps
    IF NEW.assigned_team_id IS NOT NULL AND NEW.assigned_at IS NULL THEN
        integrity_violations = array_append(integrity_violations, 'Assigned incidents must have assigned_at timestamp');
    END IF;
    
    -- Check 4: Manager ownership validation
    IF NEW.assigned_team_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM teams t 
            WHERE t.id = NEW.assigned_team_id 
            AND t.manager_id IS NOT NULL
        ) THEN
            integrity_violations = array_append(integrity_violations, 'Assigned team must have a valid manager');
        END IF;
    END IF;
    
    -- Raise exception if violations found
    IF array_length(integrity_violations, 1) > 0 THEN
        RAISE EXCEPTION 'Data integrity violations: %', array_to_string(integrity_violations, '; ');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for data integrity checks
DROP TRIGGER IF EXISTS incident_data_integrity_trigger ON incidents;
CREATE TRIGGER incident_data_integrity_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION perform_data_integrity_checks();

-- =====================================================
-- 8. COMPLETION TIME VALIDATION
-- =====================================================

-- Function to validate minimum time before completion
CREATE OR REPLACE FUNCTION validate_completion_timing()
RETURNS TRIGGER AS $$
BEGIN
    -- Check minimum time requirement for completion (1 hour)
    IF NEW.status = 'Completed' AND OLD.status != 'Completed' THEN
        IF OLD.assigned_at IS NOT NULL AND 
           NEW.updated_at < (OLD.assigned_at + INTERVAL '1 hour') THEN
            RAISE EXCEPTION 'Incident must be assigned for at least 1 hour before completion. Time assigned: %, Current time: %', 
                           OLD.assigned_at, NEW.updated_at;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for completion timing validation
DROP TRIGGER IF EXISTS incident_completion_timing_trigger ON incidents;
CREATE TRIGGER incident_completion_timing_trigger
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_completion_timing();

-- =====================================================
-- 9. AUDIT TRAIL ENHANCEMENT
-- =====================================================

-- Function to enhance audit logging for status changes
CREATE OR REPLACE FUNCTION log_status_change_audit()
RETURNS TRIGGER AS $$
BEGIN
    -- Log significant status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO activity_logs (
            user_id,
            action,
            table_name,
            reference_id,
            details,
            created_at
        ) VALUES (
            COALESCE(NEW.updated_by, 'system'),
            format('Status changed from %s to %s', OLD.status, NEW.status),
            'incidents',
            NEW.id,
            jsonb_build_object(
                'type', 'status_change_audit',
                'old_status', OLD.status,
                'new_status', NEW.status,
                'assigned_team_id', NEW.assigned_team_id,
                'assignment_timestamp', NEW.assigned_at,
                'validation_timestamp', CURRENT_TIMESTAMP
            ),
            CURRENT_TIMESTAMP
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for audit logging
DROP TRIGGER IF EXISTS incident_status_audit_trigger ON incidents;
CREATE TRIGGER incident_status_audit_trigger
    AFTER UPDATE ON incidents
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION log_status_change_audit();

-- =====================================================
-- 10. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Indexes for efficient constraint checking
CREATE INDEX IF NOT EXISTS idx_incidents_status_assignment ON incidents(status, assigned_team_id);
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_at ON incidents(assigned_at) WHERE assigned_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_cards_team_status ON job_cards(team_id, status);
CREATE INDEX IF NOT EXISTS idx_teams_manager_available ON teams(manager_id, is_available);
CREATE INDEX IF NOT EXISTS idx_teams_current_capacity ON teams(current_capacity, max_capacity);

-- =====================================================
-- 11. VALIDATION VIEW FOR MONITORING
-- =====================================================

-- Create view to monitor constraint violations
CREATE OR REPLACE VIEW incident_validation_monitor AS
SELECT 
    i.id,
    i.title,
    i.status,
    i.assigned_team_id,
    i.assigned_at,
    t.name as team_name,
    t.is_available as team_available,
    t.current_capacity as team_current_capacity,
    t.max_capacity as team_max_capacity,
    t.manager_id as team_manager_id,
    jc.status as job_card_status,
    jc.assigned_at as job_card_assigned_at,
    -- Validation flags
    CASE 
        WHEN i.status IN ('assigned', 'In Progress', 'Completed') AND i.assigned_team_id IS NULL THEN 'MISSING_TEAM_ASSIGNMENT'
        WHEN i.status = 'verified' AND i.assigned_team_id IS NOT NULL THEN 'TEAM_ASSIGNED_TO_UNVERIFIED'
        WHEN i.status = 'Completed' AND i.assigned_at < (CURRENT_TIMESTAMP - INTERVAL '1 hour') THEN 'COMPLETION_TIME_VALID'
        WHEN i.assigned_team_id IS NOT NULL AND jc.team_id != i.assigned_team_id THEN 'TEAM_ASSIGNMENT_MISMATCH'
        WHEN i.assigned_team_id IS NOT NULL AND t.is_available = false THEN 'ASSIGNED_TO_UNAVAILABLE_TEAM'
        WHEN t.current_capacity >= t.max_capacity THEN 'TEAM_AT_CAPACITY'
        ELSE 'VALID'
    END as validation_status,
    CURRENT_TIMESTAMP as validation_timestamp
FROM incidents i
LEFT JOIN teams t ON i.assigned_team_id = t.id
LEFT JOIN job_cards jc ON i.id = jc.incident_id;

-- Grant permissions
GRANT SELECT ON incident_validation_monitor TO authenticated;

-- =====================================================
-- 12. COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON FUNCTION validate_incident_status_transition() IS 'Enforces strict status transition rules for incidents';
COMMENT ON FUNCTION validate_team_assignment_integrity() IS 'Ensures team assignments are valid and consistent';
COMMENT ON FUNCTION validate_job_card_integrity() IS 'Validates job card creation and updates';
COMMENT ON FUNCTION enforce_team_capacity_limit() IS 'Prevents teams from exceeding their capacity limits';
COMMENT ON FUNCTION perform_data_integrity_checks() IS 'Performs comprehensive data integrity validation';
COMMENT ON FUNCTION validate_completion_timing() IS 'Ensures minimum time requirements before completion';
COMMENT ON VIEW incident_validation_monitor IS 'Provides real-time monitoring of constraint violations';

-- Migration completion log
INSERT INTO activity_logs (
    user_id,
    action,
    table_name,
    reference_id,
    details,
    created_at
) VALUES (
    'system',
    'Database migration completed: Status validation constraints added',
    'system',
    NULL,
    jsonb_build_object(
        'migration', '001_add_status_validation_constraints',
        'constraints_added', ARRAY[
            'Status transition validation',
            'Team assignment integrity',
            'Job card integrity',
            'Capacity enforcement',
            'Data integrity checks',
            'Completion timing validation',
            'Audit trail enhancement'
        ],
        'timestamp', CURRENT_TIMESTAMP
    ),
    CURRENT_TIMESTAMP
);