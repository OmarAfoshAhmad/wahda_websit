const fs = require('fs');
let sql = fs.readFileSync('prisma/migrations/20260618062000_sync_tpa_production_fields/migration.sql', 'utf8');

// Handle DROP INDEX
sql = sql.replace(/DROP INDEX "([^"]+)";/g, 'DROP INDEX IF EXISTS "$1";');

// In case there are DROP INDEX without quotes:
sql = sql.replace(/DROP INDEX ([A-Za-z0-9_]+);/g, 'DROP INDEX IF EXISTS $1;');

fs.writeFileSync('prisma/migrations/20260618062000_sync_tpa_production_fields/migration.sql', sql);
