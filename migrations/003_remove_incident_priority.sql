-- Migration: Remove priority column from incidents table
-- This migration removes the priority column that was previously added

-- =====================================================
-- 1. DROP PRIORITY COLUMN FROM INCIDENTS TABLE
-- =====================================================

-- Drop the priority column from incidents table
ALTER TABLE incidents
DROP COLUMN IF EXISTS priority;

-- =====================================================
-- 2. DROP PRIORITY ENUM TYPE (if not used elsewhere)
-- =====================================================

-- Check if priority_level enum is used elsewhere before dropping
DO $$ BEGIN
    -- Only drop if no other tables use this enum
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND udt_name = 'priority_level'
        AND table_name != 'incidents'
    ) THEN
        DROP TYPE IF EXISTS priority_level;
    END IF;
END $$;

-- Migration completed successfully
-- Removed priority column from incidents table