import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { default: prisma } = await import("@/lib/prisma");
const { checkRateLimit, resetRateLimit } = await import("@/lib/rate-limit");

describe("PostgreSQL rate limiter integration", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "RateLimitBucket"');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("shares an atomic login limit and resets it", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => checkRateLimit("integration-login", "login")),
    );

    expect(attempts.filter((message) => message === null)).toHaveLength(7);
    expect(attempts.filter((message) => message !== null)).toHaveLength(1);

    await resetRateLimit("integration-login", "login");
    expect(await checkRateLimit("integration-login", "login")).toBeNull();
  });
});
