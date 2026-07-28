"use strict";

async function main() {
  const { spawnSync } = await import("node:child_process");
  const path = await import("node:path");
  const { assertTestDatabase } = await import("./assert-test-database.js");
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  assertTestDatabase(testDatabaseUrl);

  const vitestCli = path.resolve("node_modules", "vitest", "vitest.mjs");
  const result = spawnSync(
    process.execPath,
    [vitestCli, "run", "tests/integration", "--no-file-parallelism"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: "test" },
    },
  );
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(`Integration test runner failed: ${error.message}`);
  process.exitCode = 1;
});
