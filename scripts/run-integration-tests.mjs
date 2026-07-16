import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const line = env.split(/\r?\n/).find((entry) => entry.trim().startsWith("DATABASE_URL="));
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

const baseUrl = readDatabaseUrl();
if (!baseUrl) throw new Error("DATABASE_URL is required");
const parsed = new URL(baseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Integration tests are blocked: DATABASE_URL must point to localhost");
}

const schema = `integration_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", schema);
const adminUrl = new URL(baseUrl);
adminUrl.searchParams.delete("schema");
const client = new pg.Client({ connectionString: adminUrl.toString() });
let connected = false;

function run(modulePath, args) {
  const result = spawnSync(process.execPath, [modulePath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString(), NODE_ENV: "test" },
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw result.error ?? new Error(`${modulePath} failed with exit code ${result.status}`);
  }
}

try {
  await client.connect();
  connected = true;
  await client.query(`CREATE SCHEMA "${schema}"`);
  run("node_modules/prisma/build/index.js", ["db", "push", "--skip-generate", "--accept-data-loss"]);
  run("node_modules/vitest/vitest.mjs", ["run", "--config", "vitest.integration.config.ts"]);
} finally {
  if (connected) {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
