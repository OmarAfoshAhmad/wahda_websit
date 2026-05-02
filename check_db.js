const { Client } = require("pg");

async function check() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres"
  });

  try {
    await client.connect();
    // List some tables to see what we have
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') LIMIT 20");
    console.log("Visible tables:", res.rows.map(r => r.table_name));
    await client.end();
  } catch (err) {
    console.error("Error:", err.message);
  }
}

check();
