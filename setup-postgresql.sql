-- PostgreSQL Database Setup Script
-- This script creates the database and user for the Sewage Management System

-- Create the database (run as postgres superuser)
CREATE DATABASE sewage;

-- Grant all privileges to postgres user on sewage database
GRANT ALL PRIVILEGES ON DATABASE sewage TO postgres;

-- Connect to the database
\c sewage;

-- Grant schema permissions to postgres user
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

-- Optional: Create extensions that might be needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Usage instructions:
-- 1. Install PostgreSQL
-- 2. Run this script as postgres user: psql -U postgres -f setup-postgresql.sql
-- 3. Start the backend server - it will automatically create tables and seed data
-- 4. Login as manager@example.com / manager123

-- Configuration in .env file:
-- DB_HOST=localhost
-- DB_PORT=5432
-- DB_NAME=sewage
-- DB_USER=postgres
-- DB_PASSWORD=123