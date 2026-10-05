"use server";

import { copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MedicineCategory, PharmacyAttachmentKind, PharmacyFulfillment, PharmacyOrderStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getBeneficiarySession } from "@/lib/beneficiary-auth";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { ATTACHMENT_LABELS, storeAttachmentFile, type StoredFile } from "@/lib/pharmacy/attachments";
import { deliveryQuote, distanceKm, isOpenNow, isValidTime } from "@/lib/pharmacy/delivery";
import { getChronicDrugStatuses, getPharmacyUsage, loadPharmacyPolicy } from "@/lib/pharmacy/summary";
import { publishOrderEvent } from "@/lib/pharmacy/order-events";

const CATEGORY_LABELS: Record<MedicineCategory, string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية الأورام" };
const OPEN_STATUSES: PharmacyOrderStatus[] = ["PENDING", "AVAILABLE", "CONFIRMED", "OUT_FOR_DELIVERY"];
const MAX_OPEN_ORDERS = 3;
const MAX_MESSAGE_LENGTH = 1000;

type Location = { latitude: number; longitude: number } | null;
const parseLocation = (latitude: unknown, longitude: unknown): Location => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { latitude: lat, longitude: lon } : null;
};

const deliverySettingsOf = (profile: { delivery_enabled: boolean; delivery_base_fee: Prisma.Decimal; delivery_per_km: Prisma.Decimal; delivery_max_km: Prisma.Decimal | null }) => ({
  enabled: profile.delivery_enabled,
  baseFee: Number(profile.delivery_base_fee),
  perKm: Number(profile.delivery_per_km),
  maxKm: profile.delivery_max_km === null ? null : Number(profile.delivery_max_km),
});

const serializeMessage = (message: { id: string; sender: "BENEFICIARY" | "FACILITY"; body: string | null; attachment_kind: PharmacyAttachmentKind | null; file_name: string | null; read_at: Date | null; created_at: Date }) => ({
  id: message.id,
  sender: message.sender,
  body: message.body,
  attachment_kind: message.attachment_kind,
  file_name: message.file_name,
  read_at: message.read_at?.toISOString() ?? null,
  created_at: message.created_at.toISOString(),
});

// ───────────────────────── المستفيد ─────────────────────────

async function requireBeneficiary() {
  const session = await getBeneficiarySession();
  if (!session) return null;
  return prisma.beneficiary.findFirst({
    where: { id: session.id, deleted_at: null },
    select: { id: true, name: true, card_number: true, status: true, company_id: true },
  });
}

/** الصيدليات التي تستقبل الطلبات، مرتبة بالأقرب إن شارك المستفيد موقعه، مع قيمة التوصيل لكل صيدلية. */
export async function listPharmaciesForBeneficiary(input: { latitude?: number | null; longitude?: number | null }) {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary) return { error: "انتهت الجلسة، سجّل الدخول مجددًا", items: [] };
  const location = parseLocation(input.latitude, input.longitude);
  const profiles = await prisma.pharmacyProfile.findMany({
    where: { accepts_orders: true, facility: { deleted_at: null } },
    select: {
      facility_id: true, address: true, city: true, phone: true, latitude: true, longitude: true, opens_at: true, closes_at: true,
      delivery_enabled: true, delivery_base_fee: true, delivery_per_km: true, delivery_max_km: true,
      facility: { select: { name: true } },
    },
  });
  const items = profiles.map((profile) => {
    const distance = location && profile.latitude !== null && profile.longitude !== null ? distanceKm(location, { latitude: profile.latitude, longitude: profile.longitude }) : null;
    const quote = deliveryQuote(deliverySettingsOf(profile), distance);
    return {
      facilityId: profile.facility_id,
      name: profile.facility.name,
      address: profile.address,
      city: profile.city,
      phone: profile.phone,
      distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
      openNow: isOpenNow(profile.opens_at, profile.closes_at),
      hours: profile.opens_at && profile.closes_at ? `${profile.opens_at} - ${profile.closes_at}` : null,
      delivery: quote.available ? { available: true as const, fee: quote.fee } : { available: false as const, reason: quote.reason },
    };
  });
  items.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name, "ar"));
  return { items, located: location !== null };
}

/** ما يحتاجه نموذج الطلب: الفئات المفعلة، والأدوية المزمنة المتاحة إن كان المستفيد مشمولًا بالمزمن. */
export async function getBeneficiaryOrderContext() {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary?.company_id) return { error: "لا توجد سياسة تأمين مرتبطة بحسابك" };
  const { usage, chronicIntervalDays } = await getPharmacyUsage(beneficiary.id, beneficiary.company_id);
  const chronic = await getChronicDrugStatuses(beneficiary.id, chronicIntervalDays);
  return {
    categories: (usage?.categories ?? []).filter((category) => category.enabled && (category.category !== "CHRONIC" || chronic.length > 0)).map((category) => category.category),
    chronicDrugs: chronic,
  };
}

/**
 * ينشئ طلبًا من صيدلية. البطاقة التأمينية إلزامية دائمًا، والوصفة إلزامية عدا المزمن
 * (الأدوية المزمنة مرتبطة بالمستفيد ويُشترط أن تكون مستحقة الآن).
 * FormData: facilityId, category, fulfillment, latitude, longitude, address, note, chronicDrugIds (JSON), insuranceCard, prescription.
 */
export async function createPharmacyOrder(formData: FormData) {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary) return { error: "انتهت الجلسة، سجّل الدخول مجددًا" };
  if (beneficiary.status !== "ACTIVE" || !beneficiary.company_id) return { error: "حسابك غير نشط لخدمات الصيدلية" };
  const limited = await checkRateLimit(`pharmacy-order:${beneficiary.id}`, "api");
  if (limited) return { error: limited };

  const facilityId = String(formData.get("facilityId") ?? "");
  const category = String(formData.get("category") ?? "") as MedicineCategory;
  const fulfillment = String(formData.get("fulfillment") ?? "") as PharmacyFulfillment;
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_MESSAGE_LENGTH) || null;
  const address = String(formData.get("address") ?? "").trim().slice(0, 300) || null;
  const location = parseLocation(formData.get("latitude"), formData.get("longitude"));
  if (!["ROUTINE", "CHRONIC", "CHEMICAL"].includes(category)) return { error: "اختر نوع الأدوية" };
  if (!["PICKUP", "DELIVERY"].includes(fulfillment)) return { error: "اختر الاستلام أو التوصيل" };

  const openCount = await prisma.pharmacyOrder.count({ where: { beneficiary_id: beneficiary.id, status: { in: OPEN_STATUSES } } });
  if (openCount >= MAX_OPEN_ORDERS) return { error: `لديك ${openCount} طلبات مفتوحة. أكملها أو ألغِ أحدها أولًا` };

  const profile = await prisma.pharmacyProfile.findFirst({
    where: { facility_id: facilityId, accepts_orders: true, facility: { deleted_at: null } },
    select: { latitude: true, longitude: true, delivery_enabled: true, delivery_base_fee: true, delivery_per_km: true, delivery_max_km: true, facility: { select: { name: true } } },
  });
  if (!profile) return { error: "هذه الصيدلية لا تستقبل الطلبات حاليًا" };

  const policy = await loadPharmacyPolicy(prisma, beneficiary.company_id);
  const config = policy?.pharmacy_config;
  const enabled = config && (category === "ROUTINE" ? config.routine_enabled : category === "CHRONIC" ? config.chronic_enabled : config.chemical_enabled);
  if (!enabled) return { error: "هذا النوع غير مشمول في تأمينك" };

  let chronicDrugIds: string[] = [];
  if (category === "CHRONIC") {
    try {
      const parsed = JSON.parse(String(formData.get("chronicDrugIds") ?? "[]"));
      chronicDrugIds = Array.isArray(parsed) ? [...new Set(parsed.map(String))] : [];
    } catch {
      return { error: "بيانات الأدوية غير صالحة" };
    }
    const statuses = await getChronicDrugStatuses(beneficiary.id, config.chronic_interval_days);
    if (statuses.length === 0) return { error: "لست مشمولًا بخدمة الأدوية المزمنة" };
    if (chronicDrugIds.length === 0) return { error: "اختر دواءً مزمنًا واحدًا على الأقل" };
    const byId = new Map(statuses.map((drug) => [drug.id, drug]));
    const blocked = chronicDrugIds.find((id) => !byId.get(id)?.eligible);
    if (blocked) return { error: byId.has(blocked) ? `${byId.get(blocked)!.drug_name} غير مستحق قبل ${new Date(byId.get(blocked)!.next_eligible_at!).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli" })}` : "أحد الأدوية غير مرتبط بحسابك" };
  }

  let deliveryFee: number | null = null;
  let distance: number | null = null;
  if (fulfillment === "DELIVERY") {
    if (!location) return { error: "شارك موقعك لتحديد عنوان التوصيل" };
    distance = profile.latitude !== null && profile.longitude !== null ? distanceKm(location, { latitude: profile.latitude, longitude: profile.longitude }) : null;
    const quote = deliveryQuote(deliverySettingsOf(profile), distance);
    if (!quote.available) return { error: quote.reason };
    deliveryFee = quote.fee;
  }

  const required: PharmacyAttachmentKind[] = category === "CHRONIC" ? ["INSURANCE_CARD"] : ["INSURANCE_CARD", "PRESCRIPTION"];
  const stored: StoredFile[] = [];
  const cleanup = () => Promise.all(stored.map((file) => unlink(file.absolutePath).catch(() => undefined)));
  for (const kind of required) {
    const file = formData.get(kind === "INSURANCE_CARD" ? "insuranceCard" : "prescription");
    if (!(file instanceof File)) {
      await cleanup();
      return { error: `أرفق ${ATTACHMENT_LABELS[kind]}` };
    }
    const result = await storeAttachmentFile(file, kind);
    if ("error" in result) {
      await cleanup();
      return { error: result.error };
    }
    stored.push(result);
  }

  try {
    const summary = [
      `طلب ${CATEGORY_LABELS[category]} — ${fulfillment === "DELIVERY" ? `توصيل (${deliveryFee} د.ل خارج التأمين)` : "استلام من الصيدلية"}`,
      `رقم البطاقة: ${beneficiary.card_number}`,
      address ? `العنوان: ${address}` : null,
      note,
    ].filter(Boolean).join("\n");
    const order = await prisma.pharmacyOrder.create({
      data: {
        beneficiary_id: beneficiary.id,
        facility_id: facilityId,
        company_id: beneficiary.company_id,
        medicine_category: category,
        fulfillment,
        delivery_fee: deliveryFee,
        delivery_distance_km: distance === null ? null : Math.round(distance * 100) / 100,
        delivery_latitude: fulfillment === "DELIVERY" ? location?.latitude : null,
        delivery_longitude: fulfillment === "DELIVERY" ? location?.longitude : null,
        delivery_address: fulfillment === "DELIVERY" ? address : null,
        chronic_drug_ids: category === "CHRONIC" ? chronicDrugIds : undefined,
        note,
        messages: {
          create: [
            { sender: "BENEFICIARY", body: summary },
            ...stored.map((file) => ({ sender: "BENEFICIARY" as const, attachment_kind: file.kind, file_name: file.fileName, mime_type: file.mime, storage_path: file.storagePath })),
          ],
        },
      },
      select: { id: true },
    });
    publishOrderEvent({ beneficiaryId: beneficiary.id, facilityId }, { type: "order", orderId: order.id, status: "PENDING" });
    return { success: true, orderId: order.id };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function listMyPharmacyOrders() {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary) return { error: "انتهت الجلسة", items: [] };
  const orders = await prisma.pharmacyOrder.findMany({
    where: { beneficiary_id: beneficiary.id },
    orderBy: { updated_at: "desc" },
    take: 30,
    select: {
      id: true, medicine_category: true, fulfillment: true, status: true, delivery_fee: true, created_at: true, updated_at: true,
      facility: { select: { name: true } },
      _count: { select: { messages: { where: { sender: "FACILITY", read_at: null } } } },
    },
  });
  return {
    items: orders.map((order) => ({
      id: order.id,
      category: order.medicine_category,
      fulfillment: order.fulfillment,
      status: order.status,
      deliveryFee: order.delivery_fee === null ? null : Number(order.delivery_fee),
      facilityName: order.facility.name,
      unread: order._count.messages,
      createdAt: order.created_at.toISOString(),
      updatedAt: order.updated_at.toISOString(),
    })),
  };
}

async function loadOrderThread(where: Prisma.PharmacyOrderWhereInput, reader: "BENEFICIARY" | "FACILITY") {
  const order = await prisma.pharmacyOrder.findFirst({
    where,
    select: {
      id: true, beneficiary_id: true, facility_id: true, company_id: true, medicine_category: true, fulfillment: true, status: true,
      delivery_fee: true, delivery_distance_km: true, delivery_address: true, delivery_latitude: true, delivery_longitude: true,
      chronic_drug_ids: true, prescription_id: true, created_at: true,
      facility: { select: { name: true, pharmacy_profile: { select: { phone: true, address: true } } } },
      beneficiary: { select: { name: true, card_number: true, phone_number: true } },
      messages: { orderBy: { created_at: "asc" }, select: { id: true, sender: true, body: true, attachment_kind: true, file_name: true, read_at: true, created_at: true } },
    },
  });
  if (!order) return null;
  const other = reader === "BENEFICIARY" ? "FACILITY" : "BENEFICIARY";
  const unread = await prisma.pharmacyOrderMessage.updateMany({ where: { order_id: order.id, sender: other, read_at: null }, data: { read_at: new Date() } });
  if (unread.count > 0) publishOrderEvent({ beneficiaryId: order.beneficiary_id, facilityId: order.facility_id }, { type: "read", orderId: order.id, reader });

  const chronicIds = Array.isArray(order.chronic_drug_ids) ? (order.chronic_drug_ids as string[]) : [];
  const chronicDrugs = chronicIds.length === 0 ? [] : await prisma.beneficiaryChronicDrug.findMany({ where: { id: { in: chronicIds } }, select: { id: true, notes: true, drug: { select: { name: true } } } });
  return {
    id: order.id,
    beneficiaryId: order.beneficiary_id,
    companyId: order.company_id,
    category: order.medicine_category,
    fulfillment: order.fulfillment,
    status: order.status,
    deliveryFee: order.delivery_fee === null ? null : Number(order.delivery_fee),
    deliveryDistanceKm: order.delivery_distance_km,
    deliveryAddress: order.delivery_address,
    deliveryLocation: order.delivery_latitude !== null && order.delivery_longitude !== null ? { latitude: order.delivery_latitude, longitude: order.delivery_longitude } : null,
    prescriptionId: order.prescription_id,
    createdAt: order.created_at.toISOString(),
    facility: { name: order.facility.name, phone: order.facility.pharmacy_profile?.phone ?? null, address: order.facility.pharmacy_profile?.address ?? null },
    beneficiary: reader === "FACILITY" ? order.beneficiary : null,
    chronicDrugs: chronicDrugs.map((link) => ({ id: link.id, name: link.drug.name, notes: link.notes })),
    messages: order.messages.map(serializeMessage),
  };
}

export async function getMyPharmacyOrder(orderId: string) {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary) return { error: "انتهت الجلسة" };
  const order = await loadOrderThread({ id: orderId, beneficiary_id: beneficiary.id }, "BENEFICIARY");
  return order ? { order } : { error: "الطلب غير موجود" };
}

async function appendMessage(order: { id: string; beneficiary_id: string; facility_id: string }, sender: "BENEFICIARY" | "FACILITY", formData: FormData) {
  const body = String(formData.get("body") ?? "").trim().slice(0, MAX_MESSAGE_LENGTH) || null;
  const file = formData.get("file");
  const kindValue = String(formData.get("kind") ?? "PRESCRIPTION");
  const kind: PharmacyAttachmentKind = kindValue === "INSURANCE_CARD" ? "INSURANCE_CARD" : "PRESCRIPTION";
  if (!body && !(file instanceof File && file.size > 0)) return { error: "اكتب رسالة أو أرفق صورة" };

  let stored: StoredFile | null = null;
  if (file instanceof File && file.size > 0) {
    const result = await storeAttachmentFile(file, kind);
    if ("error" in result) return { error: result.error };
    stored = result;
  }
  const message = await prisma.pharmacyOrderMessage.create({
    data: { order_id: order.id, sender, body, attachment_kind: stored?.kind ?? null, file_name: stored?.fileName ?? null, mime_type: stored?.mime ?? null, storage_path: stored?.storagePath ?? null },
    select: { id: true, sender: true, body: true, attachment_kind: true, file_name: true, read_at: true, created_at: true },
  });
  await prisma.pharmacyOrder.update({ where: { id: order.id }, data: { updated_at: new Date() } });
  publishOrderEvent({ beneficiaryId: order.beneficiary_id, facilityId: order.facility_id }, { type: "message", orderId: order.id, message: serializeMessage(message) });
  return { success: true, message: serializeMessage(message) };
}

/** رسالة من المستفيد (نص أو صورة وصفة/بطاقة). FormData: orderId, body, file, kind. */
export async function sendBeneficiaryOrderMessage(formData: FormData) {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary) return { error: "انتهت الجلسة" };
  const limited = await checkRateLimit(`pharmacy-chat:ben:${beneficiary.id}`, "api");
  if (limited) return { error: limited };
  const order = await prisma.pharmacyOrder.findFirst({ where: { id: String(formData.get("orderId") ?? ""), beneficiary_id: beneficiary.id }, select: { id: true, beneficiary_id: true, facility_id: true, status: true } });
  if (!order) return { error: "الطلب غير موجود" };
  if (!OPEN_STATUSES.includes(order.status)) return { error: "الطلب مغلق" };
  return appendMessage(order, "BENEFICIARY", formData);
}

async function changeStatus(order: { id: string; beneficiary_id: string; facility_id: string }, status: PharmacyOrderStatus, note: string, sender: "BENEFICIARY" | "FACILITY") {
  await prisma.pharmacyOrder.update({ where: { id: order.id }, data: { status, status_changed_at: new Date() } });
  const message = await prisma.pharmacyOrderMessage.create({ data: { order_id: order.id, sender, body: note }, select: { id: true, sender: true, body: true, attachment_kind: true, file_name: true, read_at: true, created_at: true } });
  const target = { beneficiaryId: order.beneficiary_id, facilityId: order.facility_id };
  publishOrderEvent(target, { type: "order", orderId: order.id, status });
  publishOrderEvent(target, { type: "message", orderId: order.id, message: serializeMessage(message) });
  return { success: true };
}

/** المستفيد يؤكد الطلب بعد أن أكدت الصيدلية التوفر، أو يلغيه قبل خروجه للتوصيل. */
export async function updateMyPharmacyOrder(orderId: string, action: "CONFIRM" | "CANCEL") {
  const beneficiary = await requireBeneficiary();
  if (!beneficiary) return { error: "انتهت الجلسة" };
  const order = await prisma.pharmacyOrder.findFirst({ where: { id: orderId, beneficiary_id: beneficiary.id }, select: { id: true, beneficiary_id: true, facility_id: true, status: true, fulfillment: true, delivery_fee: true } });
  if (!order) return { error: "الطلب غير موجود" };
  if (action === "CONFIRM") {
    if (order.status !== "AVAILABLE") return { error: "لا يمكن التأكيد قبل أن تؤكد الصيدلية التوفر" };
    return changeStatus(order, "CONFIRMED", order.fulfillment === "DELIVERY" ? `أكد المستفيد الطلب مع التوصيل (${Number(order.delivery_fee)} د.ل خارج التأمين)` : "أكد المستفيد الطلب وسيستلمه من الصيدلية", "BENEFICIARY");
  }
  if (!["PENDING", "AVAILABLE", "CONFIRMED"].includes(order.status)) return { error: "لا يمكن إلغاء الطلب في هذه المرحلة" };
  return changeStatus(order, "CANCELLED", "ألغى المستفيد الطلب", "BENEFICIARY");
}

// ───────────────────────── المرفق ─────────────────────────

async function requirePharmacyFacility() {
  const session = await getSessionWithFreshPermissions();
  if (!session || !hasPermission(session, "pharmacy_services")) return null;
  return session;
}

export async function getMyPharmacyProfile() {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح" };
  const profile = await prisma.pharmacyProfile.findUnique({ where: { facility_id: session.id } });
  return {
    facilityName: session.name,
    profile: profile ? {
      acceptsOrders: profile.accepts_orders,
      address: profile.address ?? "",
      city: profile.city ?? "",
      phone: profile.phone ?? "",
      latitude: profile.latitude,
      longitude: profile.longitude,
      opensAt: profile.opens_at ?? "",
      closesAt: profile.closes_at ?? "",
      deliveryEnabled: profile.delivery_enabled,
      deliveryBaseFee: Number(profile.delivery_base_fee),
      deliveryPerKm: Number(profile.delivery_per_km),
      deliveryMaxKm: profile.delivery_max_km === null ? null : Number(profile.delivery_max_km),
    } : null,
  };
}

export async function saveMyPharmacyProfile(input: {
  acceptsOrders: boolean; address: string; city: string; phone: string; latitude: number | null; longitude: number | null;
  opensAt: string; closesAt: string; deliveryEnabled: boolean; deliveryBaseFee: number; deliveryPerKm: number; deliveryMaxKm: number | null;
}) {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح" };
  const location = parseLocation(input.latitude, input.longitude);
  if ((input.latitude !== null || input.longitude !== null) && !location) return { error: "الموقع غير صالح" };
  if (input.acceptsOrders && !location) return { error: "حدد موقع الصيدلية قبل تفعيل استقبال الطلبات" };
  if ((input.opensAt || input.closesAt) && !(isValidTime(input.opensAt) && isValidTime(input.closesAt))) return { error: "اكتب ساعات العمل بصيغة 09:00" };
  const money = [input.deliveryBaseFee, input.deliveryPerKm, input.deliveryMaxKm ?? 0];
  if (money.some((value) => !Number.isFinite(value) || value < 0 || value > 1000)) return { error: "قيم التوصيل يجب أن تكون بين 0 و1000" };
  const data = {
    accepts_orders: input.acceptsOrders,
    address: input.address.trim().slice(0, 300) || null,
    city: input.city.trim().slice(0, 100) || null,
    phone: input.phone.trim().slice(0, 30) || null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    opens_at: input.opensAt || null,
    closes_at: input.closesAt || null,
    delivery_enabled: input.deliveryEnabled,
    delivery_base_fee: input.deliveryBaseFee,
    delivery_per_km: input.deliveryPerKm,
    delivery_max_km: input.deliveryMaxKm,
  };
  await prisma.pharmacyProfile.upsert({ where: { facility_id: session.id }, create: { facility_id: session.id, ...data }, update: data });
  return { success: true };
}

export async function listFacilityPharmacyOrders(filter: "OPEN" | "CLOSED") {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح", items: [] };
  const orders = await prisma.pharmacyOrder.findMany({
    where: { facility_id: session.id, status: filter === "OPEN" ? { in: OPEN_STATUSES } : { notIn: OPEN_STATUSES } },
    orderBy: { updated_at: "desc" },
    take: 100,
    select: {
      id: true, medicine_category: true, fulfillment: true, status: true, delivery_fee: true, created_at: true, updated_at: true,
      beneficiary: { select: { name: true, card_number: true } },
      _count: { select: { messages: { where: { sender: "BENEFICIARY", read_at: null } } } },
    },
  });
  return {
    items: orders.map((order) => ({
      id: order.id,
      category: order.medicine_category,
      fulfillment: order.fulfillment,
      status: order.status,
      deliveryFee: order.delivery_fee === null ? null : Number(order.delivery_fee),
      beneficiaryName: order.beneficiary.name,
      cardNumber: order.beneficiary.card_number,
      unread: order._count.messages,
      createdAt: order.created_at.toISOString(),
      updatedAt: order.updated_at.toISOString(),
    })),
  };
}

export async function getFacilityPharmacyOrder(orderId: string) {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح" };
  const order = await loadOrderThread({ id: orderId, facility_id: session.id }, "FACILITY");
  return order ? { order } : { error: "الطلب غير موجود" };
}

/** رسالة من حساب المرفق. FormData: orderId, body, file. */
export async function sendFacilityOrderMessage(formData: FormData) {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح" };
  const order = await prisma.pharmacyOrder.findFirst({ where: { id: String(formData.get("orderId") ?? ""), facility_id: session.id }, select: { id: true, beneficiary_id: true, facility_id: true, status: true } });
  if (!order) return { error: "الطلب غير موجود" };
  if (!OPEN_STATUSES.includes(order.status)) return { error: "الطلب مغلق" };
  return appendMessage(order, "FACILITY", formData);
}

const FACILITY_TRANSITIONS: Record<string, { from: PharmacyOrderStatus[]; to: PharmacyOrderStatus; note: string }> = {
  AVAILABLE: { from: ["PENDING"], to: "AVAILABLE", note: "الأدوية متوفرة. أكد الطلب لنبدأ التجهيز." },
  REJECTED: { from: ["PENDING", "AVAILABLE", "CONFIRMED"], to: "REJECTED", note: "اعتذرت الصيدلية عن الطلب" },
  OUT_FOR_DELIVERY: { from: ["CONFIRMED"], to: "OUT_FOR_DELIVERY", note: "خرج الطلب للتوصيل" },
  COMPLETED: { from: ["CONFIRMED", "OUT_FOR_DELIVERY"], to: "COMPLETED", note: "تم تسليم الطلب" },
};

export async function updateFacilityPharmacyOrder(orderId: string, action: keyof typeof FACILITY_TRANSITIONS, reason?: string) {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح" };
  const transition = FACILITY_TRANSITIONS[action];
  if (!transition) return { error: "إجراء غير صالح" };
  const order = await prisma.pharmacyOrder.findFirst({ where: { id: orderId, facility_id: session.id }, select: { id: true, beneficiary_id: true, facility_id: true, status: true, fulfillment: true } });
  if (!order) return { error: "الطلب غير موجود" };
  if (!transition.from.includes(order.status)) return { error: "لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية" };
  if (action === "OUT_FOR_DELIVERY" && order.fulfillment !== "DELIVERY") return { error: "هذا الطلب للاستلام من الصيدلية" };
  const note = action === "REJECTED" && reason?.trim() ? `${transition.note}: ${reason.trim().slice(0, 300)}` : transition.note;
  return changeStatus(order, transition.to, note, "FACILITY");
}

/**
 * يحوّل طلب الروتيني أو الأورام إلى وصفة في نافذة الصرف، وينسخ إليها البطاقة والوصفة المرسلتين في المحادثة
 * حتى لا يعيد الصيدلي رفعهما. يحترم الحد اليومي للوصفات.
 */
export async function startDispenseFromOrder(orderId: string) {
  const session = await requirePharmacyFacility();
  if (!session) return { error: "غير مصرح" };
  const order = await prisma.pharmacyOrder.findFirst({
    where: { id: orderId, facility_id: session.id },
    select: { id: true, beneficiary_id: true, company_id: true, medicine_category: true, status: true, prescription_id: true, messages: { where: { attachment_kind: { not: null }, sender: "BENEFICIARY" }, orderBy: { created_at: "desc" }, select: { attachment_kind: true, file_name: true, mime_type: true, storage_path: true } } },
  });
  if (!order) return { error: "الطلب غير موجود" };
  if (!["AVAILABLE", "CONFIRMED", "OUT_FOR_DELIVERY"].includes(order.status)) return { error: "أكد التوفر قبل بدء الصرف" };
  const target = { companyId: order.company_id, beneficiaryId: order.beneficiary_id, category: order.medicine_category };
  if (order.medicine_category === "CHRONIC" || order.prescription_id) return { success: true, ...target };

  const { createPharmacyPrescription } = await import("@/app/actions/pharmacy");
  const created = await createPharmacyPrescription({ companyId: order.company_id, beneficiaryId: order.beneficiary_id, category: order.medicine_category });
  if (!("prescriptionId" in created) || !created.prescriptionId) return { error: created.error ?? "تعذر إنشاء الوصفة" };

  // نسخة مستقلة من كل ملف: استبدال المرفق لاحقًا في الوصفة لا يحذف صورة المحادثة.
  for (const kind of ["INSURANCE_CARD", "PRESCRIPTION"] as const) {
    const source = order.messages.find((message) => message.attachment_kind === kind);
    if (!source?.storage_path) continue;
    const extension = path.extname(source.storage_path);
    const storagePath = path.join("storage", "pharmacy-prescriptions", `${randomUUID()}${extension}`);
    await copyFile(path.join(/* turbopackIgnore: true */ process.cwd(), source.storage_path), path.join(/* turbopackIgnore: true */ process.cwd(), storagePath));
    await prisma.pharmacyDispenseAttachment.create({
      data: { prescription_id: created.prescriptionId, kind, uploaded_by_id: session.id, file_name: source.file_name ?? "file", mime_type: source.mime_type ?? "image/webp", file_size: 0, storage_path: storagePath },
    });
  }
  await prisma.pharmacyOrder.update({ where: { id: order.id }, data: { prescription_id: created.prescriptionId } });
  return { success: true, ...target };
}

/** عدد الطلبات المفتوحة التي فيها رسائل غير مقروءة: لعداد صندوق الوارد. */
export async function getFacilityOrdersBadge() {
  const session = await requirePharmacyFacility();
  if (!session) return { count: 0 };
  const count = await prisma.pharmacyOrder.count({ where: { facility_id: session.id, status: { in: OPEN_STATUSES }, OR: [{ status: "PENDING" }, { messages: { some: { sender: "BENEFICIARY", read_at: null } } }] } });
  return { count };
}
