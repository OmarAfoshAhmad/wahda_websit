const XLSX = require("xlsx");
const { Client } = require("pg");

async function check() {
  try {
    const workbook = XLSX.readFile("C:\\Users\\Omar\\Desktop\\التحقق من البطاقات الغير مصدرة\\Tripoli\\TRI 13\\TRI 13\\TRI 13.xlsx");
    const sheet = workbook.Sheets["1"];
    const data = XLSX.utils.sheet_to_json(sheet);
    
    if (data.length === 0) {
      console.log("Excel sheet is empty.");
      return;
    }

    const cards = data
      .map(row => row["Insurance Profile/card"] || row["Insurance Profile"] || row["card"])
      .filter(Boolean)
      .slice(0, 200);

    const client = new Client({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres"
    });

    await client.connect();
    // Check all schemas
    const tableCheck = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%CardIssuanceRegistry%'");
    console.log("Tables found:", tableCheck.rows);

    if (tableCheck.rows.length === 0) {
        console.log("No table matching 'CardIssuanceRegistry' found.");
        await client.end();
        return;
    }

    const { table_schema, table_name } = tableCheck.rows[0];
    const fullTableName = `"${table_schema}"."${table_name}"`;

    const query = {
      text: "SELECT batch_number, COUNT(*) as count, (array_agg(card_number))[1:3] as samples FROM " + fullTableName + " WHERE card_number = ANY($1) GROUP BY batch_number",
      values: [cards.map(String)]
    };
    const res = await client.query(query);
    console.log("Query Results:");
    if (res.rows.length === 0) {
      console.log("No matches found in " + fullTableName);
    } else {
      console.table(res.rows);
    }
    await client.end();
  } catch (err) {
    console.error("Error:", err.message);
  }
}

check();
