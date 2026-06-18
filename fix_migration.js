const fs = require('fs');
let sql = fs.readFileSync('prisma/migrations/20260618062000_sync_tpa_production_fields/migration.sql', 'utf8');

// Handle ENUMs (Postgres CREATE TYPE does not support IF NOT EXISTS in all versions, 
// but if we are on PG 16, it might. Let's just catch the error or use IF NOT EXISTS. PG 16 supports IF NOT EXISTS for CREATE TYPE)
// Oh wait, PG CREATE TYPE ... AS ENUM does NOT support IF NOT EXISTS. 
// It was proposed but rejected. You have to use a DO block.
// Let's replace CREATE TYPE with a DO block!
sql = sql.replace(/CREATE TYPE "([^"]+)" AS ENUM \(([^)]+)\);/g, `
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '$1') THEN
        CREATE TYPE "$1" AS ENUM ($2);
    END IF;
END
$$;`);

// Alter Enum
sql = sql.replace(/ALTER TYPE "([^"]+)" ADD VALUE '([^']+)';/g, `ALTER TYPE "$1" ADD VALUE IF NOT EXISTS '$2';`);

// Tables
sql = sql.replace(/CREATE TABLE/g, 'CREATE TABLE IF NOT EXISTS');

// Columns
sql = sql.replace(/ADD COLUMN/g, 'ADD COLUMN IF NOT EXISTS');

// Indexes
sql = sql.replace(/CREATE INDEX/g, 'CREATE INDEX IF NOT EXISTS');
sql = sql.replace(/CREATE UNIQUE INDEX/g, 'CREATE UNIQUE INDEX IF NOT EXISTS');

fs.writeFileSync('prisma/migrations/20260618062000_sync_tpa_production_fields/migration.sql', sql);
