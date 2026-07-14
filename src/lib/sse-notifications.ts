/**
 * SSE Notification Emitter
 * يستخدم globalThis لضمان استمرار التسجيل عبر hot-reload في dev
 */
import { getRedisPublisherClient, getRedisSubscriberClient } from "@/lib/redis";

type SSEController = ReadableStreamDefaultController<Uint8Array>;

const CHANNEL_PREFIX = "beneficiary-notify:";
const MAX_CONNECTIONS_PER_BENEFICIARY = 3;
const MAX_TOTAL_CONNECTIONS = 500;

declare global {
  var _sseConnections: Map<string, Set<SSEController>> | undefined;
  var _sseRedisSubscribed: boolean | undefined;
  var _sseRedisSubscribePromise: Promise<void> | undefined;
  var _sseInstanceId: string | undefined;
}

const connections: Map<string, Set<SSEController>> =
  globalThis._sseConnections ?? (globalThis._sseConnections = new Map());
const INSTANCE_ID = globalThis._sseInstanceId ?? (globalThis._sseInstanceId = Math.random().toString(36).slice(2));

interface RedisEnvelope {
  origin: string;
  payload: NotificationPayload;
}

function emitLocalNotification(beneficiaryId: string, payload: NotificationPayload) {
  const set = connections.get(beneficiaryId);
  if (!set || set.size === 0) return;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const bytes = new TextEncoder().encode(data);

  for (const controller of [...set]) {
    try {
      controller.enqueue(bytes);
    } catch {
      set.delete(controller);
    }
  }
  if (set.size === 0) connections.delete(beneficiaryId);
}

async function ensureRedisSubscription() {
  if (globalThis._sseRedisSubscribed) {
    return;
  }

  if (!globalThis._sseRedisSubscribePromise) {
    globalThis._sseRedisSubscribePromise = (async () => {
      const subscriber = await getRedisSubscriberClient();
      if (!subscriber) return;

      await subscriber.pSubscribe(`${CHANNEL_PREFIX}*`, (message: string, channel: string) => {
        try {
          const beneficiaryId = channel.slice(CHANNEL_PREFIX.length);
          if (!beneficiaryId) return;

          const envelope = JSON.parse(message) as RedisEnvelope;
          if (envelope.origin === INSTANCE_ID) return;

          emitLocalNotification(beneficiaryId, envelope.payload);
        } catch {
          // ignore malformed messages
        }
      });

      globalThis._sseRedisSubscribed = true;
    })().catch(() => {
      globalThis._sseRedisSubscribed = false;
    });
  }

  await globalThis._sseRedisSubscribePromise;
}

async function publishNotification(beneficiaryId: string, payload: NotificationPayload) {
  const publisher = await getRedisPublisherClient();
  if (!publisher) {
    return;
  }

  try {
    const envelope: RedisEnvelope = {
      origin: INSTANCE_ID,
      payload,
    };
    await publisher.publish(`${CHANNEL_PREFIX}${beneficiaryId}`, JSON.stringify(envelope));
  } catch {
    // best effort
  }
}

function getTotalConnectionsCount(): number {
  let totalConnections = 0;
  for (const set of connections.values()) totalConnections += set.size;
  return totalConnections;
}

export function canAcceptSSEConnection(beneficiaryId: string): boolean {
  const totalConnections = getTotalConnectionsCount();
  if (totalConnections >= MAX_TOTAL_CONNECTIONS) return false;

  const set = connections.get(beneficiaryId);
  if (!set) return true;

  // نسمح باتصال جديد حتى لو وصل الحد لكل مستفيد، لأن addSSEConnection
  // يستبدل الأقدم بدلاً من رفض الاتصال.
  return set.size <= MAX_CONNECTIONS_PER_BENEFICIARY;
}

export function addSSEConnection(beneficiaryId: string, controller: SSEController): boolean {
  // حد إجمالي الاتصالات
  const totalConnections = getTotalConnectionsCount();
  if (totalConnections >= MAX_TOTAL_CONNECTIONS) return false;

  if (!connections.has(beneficiaryId)) connections.set(beneficiaryId, new Set());
  const set = connections.get(beneficiaryId)!;

  // حد الاتصالات لكل مستفيد
  if (set.size >= MAX_CONNECTIONS_PER_BENEFICIARY) {
    // إغلاق أقدم اتصال
    const oldest = set.values().next().value;
    if (oldest) {
      try { oldest.close(); } catch { /* ignore */ }
      set.delete(oldest);
    }
  }

  set.add(controller);
  void ensureRedisSubscription();
  return true;
}

export function removeSSEConnection(beneficiaryId: string, controller: SSEController) {
  const set = connections.get(beneficiaryId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) connections.delete(beneficiaryId);
}

export interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  amount?: number;
  remaining_balance?: number;
  created_at: string;
  transaction?: {
    id: string;
    amount: number;
    type: string;
    created_at: string;
    facility_name: string;
  };
}

export function emitNotification(beneficiaryId: string, payload: NotificationPayload) {
  emitLocalNotification(beneficiaryId, payload);
  void publishNotification(beneficiaryId, payload);
}
