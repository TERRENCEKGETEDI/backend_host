-- Database Migration: Update notifications table to new schema
-- This migration recreates the notifications table with the updated schema

-- Drop existing table if it exists
DROP TABLE IF EXISTS notifications CASCADE;

-- Create the new notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  job_card_id UUID REFERENCES job_cards(id) ON DELETE SET NULL,
  priority VARCHAR(20) DEFAULT 'medium',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

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
    'Database migration completed: Notifications table updated',
    'system',
    NULL,
    jsonb_build_object(
        'migration', '004_update_notifications_table',
        'changes', 'Recreated notifications table with new schema including UUID id, role-based notifications, priority, and specific incident/job_card references',
        'timestamp', CURRENT_TIMESTAMP
    ),
    CURRENT_TIMESTAMP
);