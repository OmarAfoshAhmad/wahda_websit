const { Client } = require("pg");

async function check() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres"
  });

  try {
    await client.connect();
    const res = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false");
    console.log("Databases:", res.rows.map(r => r.datname));
    await client.end();
  } catch (err) {
    console.error("Error:", err.message);
  }
}

check();
