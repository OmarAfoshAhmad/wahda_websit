import { importOpticsTransactionsAction } from "@/app/actions/import-optics-transactions";
import fs from "fs";

async function main() {
  const filePath = "c:\\Users\\Omar\\waad_temp_website\\حركات_الشركات_منظمة\\البصريات\\حركات_FUTU.xlsx";
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString("base64");
  
  // Need to bypass auth for test
  // I will just mock requireActiveFacilitySession inside the action if possible, 
  // but wait, I can't mock from outside easily in NextJS.
  // Let me just create an API route or run it somehow, 
  // or I can modify the action directly temporarily to bypass auth.
}

main();
