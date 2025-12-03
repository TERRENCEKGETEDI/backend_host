-- Complete PostgreSQL Database Setup Script for Sewage Management System
-- Run this entire script as the postgres superuser

-- Step 1: Create the database
CREATE DATABASE sewage;

-- Step 2: Connect to the database and set up permissions
\c sewage;

-- Grant all privileges to postgres user
GRANT ALL PRIVILEGES ON DATABASE sewage TO postgres;

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

-- Optional: Create extensions that might be needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verification
\list  -- List all databases (should show 'sewage')
\connect sewage -- Connect to sewage database
\dt  -- List tables (should be empty initially)

-- Setup Complete!
-- Now you can start the backend server and it will:
-- 1. Create all tables automatically
-- 2. Seed the database with test data
-- 3. Be ready for the Manager Dashboard to use

-- Login credentials after seeding:
-- Manager: manager@example.com / manager123
-- Admin: admin@example.com / admin123
-- Team Leaders: teamleader1-4@example.com / tl123
-- Workers: worker1-16@example.com / worker123

-- Environment Configuration (.env file):
-- DB_HOST=localhost
-- DB_PORT=5432
-- DB_NAME=sewage
-- DB_USER=postgres
-- DB_PASSWORD=123