const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/wahda_db?schema=public' });
client.connect().then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'Transaction'")).then(res => { console.log(res.rows.map(r => r.column_name)); client.end(); }).catch(console.error);
