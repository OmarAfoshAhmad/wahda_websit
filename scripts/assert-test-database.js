"use strict";

/**
 * Fail closed before integration tests are allowed to touch PostgreSQL.
 * The URL itself is deliberately never logged.
 */
function assertTestDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error(
      "Integration tests require TEST_DATABASE_URL (or DATABASE_URL) pointing to a dedicated test database."
    );
  }

  let databaseName;
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("Integration test database URL is not a valid PostgreSQL URL.");
  }

  const clearlyTestOnly = /(^|[-_])(test|testing)([-_]|$)/i.test(databaseName);
  if (!databaseName || !clearlyTestOnly) {
    throw new Error(
      "Refusing to run integration tests: the database name must clearly contain a standalone 'test' or 'testing' marker."
    );
  }

  return databaseName;
}

if (require.main === module) {
  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assertTestDatabase(databaseUrl);
  process.stdout.write("Dedicated test database check passed.\n");
}

module.exports = { assertTestDatabase };
