import { PrismaClient } from "@prisma/client";
import { processImportJob } from "../src/lib/import-jobs";

const prisma = new PrismaClient();

async function main() {
  const jobId = "cmpi3q4cd0000u9m00qt95fqp";
  console.log(`Starting processImportJob for ${jobId}...`);
  const result = await processImportJob(jobId, "test-script");
  console.log("Result:", result);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
