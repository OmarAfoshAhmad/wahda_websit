import { createClient } from "redis";
import net from "node:net";

type RedisClient = ReturnType<typeof createClient>;

declare global {
  var _redisPubClient: RedisClient | undefined;
  var _redisPubPromise: Promise<RedisClient | null> | undefined;
  var _redisSubClient: RedisClient | undefined;
  var _redisSubPromise: Promise<RedisClient | null> | undefined;
  var _redisDownUntil: number | undefined;
  var _redisProbeUntil: number | undefined;
  var _redisProbeResult: boolean | undefined;
}

const REDIS_DOWN_COOLDOWN_MS = 30_000;
const REDIS_PROBE_TIMEOUT_MS = 700;

function getDownUntil() { return globalThis._redisDownUntil ?? 0; }
function setDownUntil(v: number) { globalThis._redisDownUntil = v; }
function getProbeUntil() { return globalThis._redisProbeUntil ?? 0; }
function setProbeUntil(v: number) { globalThis._redisProbeUntil = v; }
function getProbeResult() { return globalThis._redisProbeResult ?? false; }
function setProbeResult(v: boolean) { globalThis._redisProbeResult = v; }

function canUseRedis(): boolean {
  return Boolean(process.env.REDIS_URL && process.env.REDIS_URL.trim());
}

async function probeRedisReachability(): Promise<boolean> {
  if (!canUseRedis()) {
    return false;
  }

  const now = Date.now();
  if (now < getProbeUntil()) {
    return getProbeResult();
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    setProbeResult(false);
    setProbeUntil(now + REDIS_DOWN_COOLDOWN_MS);
    return false;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "127.0.0.1";
    const port = parsed.port ? Number(parsed.port) : 6379;

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Redis probe timeout"));
      }, REDIS_PROBE_TIMEOUT_MS);

      socket.once("connect", () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });

      socket.once("error", (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      });
    });

    setProbeResult(true);
    setProbeUntil(now + 5_000);
    return true;
  } catch (err) {
    console.warn("[REDIS] Probe failed, marking down for cooldown", String(err));
    setProbeResult(false);
    setProbeUntil(now + REDIS_DOWN_COOLDOWN_MS);
    setDownUntil(now + REDIS_DOWN_COOLDOWN_MS);
    return false;
  }
}

async function createAndConnectClient(kind: "pub" | "sub"): Promise<RedisClient> {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }

  const client = createClient({
    url,
    socket: {
      connectTimeout: 1500,
      reconnectStrategy: () => false,
    },
  });
  client.on("error", (error) => {
    const shouldLog = Date.now() >= getDownUntil();
    setDownUntil(Date.now() + REDIS_DOWN_COOLDOWN_MS);
    if (shouldLog) {
      console.error(`[redis:${kind}]`, error);
    }
  });

  await client.connect();
  return client;
}

async function getRedisClient(kind: "pub" | "sub"): Promise<RedisClient | null> {
  if (!canUseRedis()) {
    return null;
  }

  const reachable = await probeRedisReachability();
  if (!reachable) {
    return null;
  }

  if (Date.now() < getDownUntil()) {
    return null;
  }

  if (kind === "pub") {
    if (globalThis._redisPubClient?.isOpen) {
      return globalThis._redisPubClient;
    }

    if (!globalThis._redisPubPromise) {
      globalThis._redisPubPromise = createAndConnectClient("pub")
        .then((client) => {
          globalThis._redisPubClient = client;
          return client;
        })
        .catch(() => {
          setDownUntil(Date.now() + REDIS_DOWN_COOLDOWN_MS);
          globalThis._redisPubPromise = undefined;
          return null;
        });
    }

    return globalThis._redisPubPromise;
  }

  if (globalThis._redisSubClient?.isOpen) {
    return globalThis._redisSubClient;
  }

  if (!globalThis._redisSubPromise) {
    globalThis._redisSubPromise = createAndConnectClient("sub")
      .then((client) => {
        globalThis._redisSubClient = client;
        return client;
      })
      .catch(() => {
        setDownUntil(Date.now() + REDIS_DOWN_COOLDOWN_MS);
        globalThis._redisSubPromise = undefined;
        return null;
      });
  }

  return globalThis._redisSubPromise;
}

export async function getRedisPublisherClient(): Promise<RedisClient | null> {
  return getRedisClient("pub");
}

export async function getRedisSubscriberClient(): Promise<RedisClient | null> {
  return getRedisClient("sub");
}
