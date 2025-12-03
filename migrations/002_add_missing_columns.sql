-- Migration: Add missing columns to incidents and teams tables
-- This migration adds columns that were added to the models but not migrated to the database

-- =====================================================
-- 1. CREATE PRIORITY ENUM TYPE
-- =====================================================

-- Create priority enum type
DO $$ BEGIN
    CREATE TYPE priority_level AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- 2. ADD COLUMNS TO INCIDENTS TABLE
-- =====================================================

-- Add priority column to incidents table
ALTER TABLE incidents
ADD COLUMN IF NOT EXISTS priority priority_level DEFAULT 'medium';

-- Add category_reasoning column to incidents table
ALTER TABLE incidents
ADD COLUMN IF NOT EXISTS category_reasoning TEXT;

-- =====================================================
-- 2. ADD COLUMNS TO TEAMS TABLE
-- =====================================================

-- Add is_available column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true;

-- Add current_capacity column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS current_capacity INTEGER DEFAULT 0;

-- Add max_capacity column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS max_capacity INTEGER DEFAULT 5;

-- Add priority_level column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS priority_level INTEGER DEFAULT 1;

-- Add last_activity column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP;

-- Add available_from column to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS available_from TIMESTAMP;

-- =====================================================
-- 3. ADD COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN incidents.priority IS 'Priority level assigned by automated system';
COMMENT ON COLUMN incidents.category_reasoning IS 'Reasoning for automatic categorization';
COMMENT ON COLUMN teams.is_available IS 'Real-time availability flag controlled by team leader';
COMMENT ON COLUMN teams.current_capacity IS 'Current number of active incidents assigned to this team';
COMMENT ON COLUMN teams.max_capacity IS 'Maximum number of incidents this team can handle simultaneously';
COMMENT ON COLUMN teams.priority_level IS 'Priority level for assignment (1=low, 5=high)';
COMMENT ON COLUMN teams.last_activity IS 'Timestamp of last team activity/update';
COMMENT ON COLUMN teams.available_from IS 'When team will be available again (for temporary unavailability)';

-- =====================================================
-- 4. UPDATE EXISTING DATA WITH DEFAULT VALUES
-- =====================================================

-- Set default priority for existing incidents
UPDATE incidents
SET priority = 'medium'
WHERE priority IS NULL;

-- Set default values for existing teams
UPDATE teams
SET
  is_available = true,
  current_capacity = 0,
  max_capacity = 5,
  priority_level = 1
WHERE is_available IS NULL;

-- Migration completed successfully
-- Added missing columns to incidents and teams tables