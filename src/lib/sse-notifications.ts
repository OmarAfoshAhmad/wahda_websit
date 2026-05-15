/**
 * SSE Notification Emitter (Local only)
 * تم حذف Redis Pub/Sub نهائياً لتبسيط النظام.
 * سيعمل هذا فقط إذا كان المستخدم متصلاً بنفس الـ instance.
 */
import { EventEmitter } from "events";

type SSEController = ReadableStreamDefaultController<Uint8Array>;

const MAX_CONNECTIONS_PER_BENEFICIARY = 3;
const MAX_TOTAL_CONNECTIONS = 500;

// استخدام EventEmitter محلي لمزامنة الإشعارات داخل نفس العملية
const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(1000);

declare global {
  var _sseConnections: Map<string, Set<SSEController>> | undefined;
}

const connections: Map<string, Set<SSEController>> =
  globalThis._sseConnections ?? (globalThis._sseConnections = new Map());

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

// استماع للإشعارات المحلية
localEmitter.on("notification", (beneficiaryId: string, payload: NotificationPayload) => {
  emitLocalNotification(beneficiaryId, payload);
});

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
  return set.size <= MAX_CONNECTIONS_PER_BENEFICIARY;
}

export function addSSEConnection(beneficiaryId: string, controller: SSEController): boolean {
  const totalConnections = getTotalConnectionsCount();
  if (totalConnections >= MAX_TOTAL_CONNECTIONS) return false;

  if (!connections.has(beneficiaryId)) connections.set(beneficiaryId, new Set());
  const set = connections.get(beneficiaryId)!;

  if (set.size >= MAX_CONNECTIONS_PER_BENEFICIARY) {
    const oldest = set.values().next().value;
    if (oldest) {
      try { oldest.close(); } catch { /* ignore */ }
      set.delete(oldest);
    }
  }

  set.add(controller);
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
  localEmitter.emit("notification", beneficiaryId, payload);
}
