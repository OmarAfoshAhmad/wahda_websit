import prisma from "@/lib/prisma";
import { formatCurrency } from "@/lib/money";
import { logger } from "@/lib/logger";
import { publishOrderEvent } from "@/lib/pharmacy/order-events";
import { sendPushToBeneficiary } from "@/lib/push";

const OPEN_STATUSES = ["PENDING", "AVAILABLE", "CONFIRMED", "OUT_FOR_DELIVERY"] as const;

/**
 * بعد صرف ناجح: إشعار للمستفيد «تم صرف أدويتك» بعدد الأصناف وما على الشركة وما عليه،
 * ورسالة «تم الصرف» في محادثة طلبه المفتوح لدى نفس الصيدلية إن وُجد. لا يرمي أخطاء ولا يؤخر الصرف.
 */
export async function notifyBeneficiaryOfDispense(dispenseId: string) {
  try {
    const dispense = await prisma.pharmacyDispense.findUnique({
      where: { id: dispenseId },
      select: { beneficiary_id: true, facility_id: true, medicine_category: true, prescription_id: true, item_count: true, company_total: true, patient_total: true, facility: { select: { name: true } } },
    });
    if (!dispense) return;

    const items = dispense.item_count === 1 ? "صنف واحد" : dispense.item_count === 2 ? "صنفان" : `${dispense.item_count} أصناف`;
    const patient = Number(dispense.patient_total);
    const text = `تم صرف أدويتك (${items}). على الشركة ${formatCurrency(Number(dispense.company_total))} د.ل${patient > 0 ? `، وعليك ${formatCurrency(patient)} د.ل` : "، ولا شيء عليك"}.`;

    const order = await prisma.pharmacyOrder.findFirst({
      where: {
        beneficiary_id: dispense.beneficiary_id,
        facility_id: dispense.facility_id,
        status: { in: [...OPEN_STATUSES] },
        OR: [...(dispense.prescription_id ? [{ prescription_id: dispense.prescription_id }] : []), { medicine_category: dispense.medicine_category }],
      },
      orderBy: { created_at: "desc" },
      select: { id: true, beneficiary_id: true, facility_id: true },
    });

    if (order) {
      const message = await prisma.pharmacyOrderMessage.create({
        data: { order_id: order.id, sender: "FACILITY", body: text },
        select: { id: true, sender: true, body: true, attachment_kind: true, file_name: true, created_at: true },
      });
      await prisma.pharmacyOrder.update({ where: { id: order.id }, data: { updated_at: new Date() } });
      publishOrderEvent({ beneficiaryId: order.beneficiary_id, facilityId: order.facility_id }, {
        type: "message",
        orderId: order.id,
        message: { ...message, location: null, created_at: message.created_at.toISOString() },
      });
    }

    await sendPushToBeneficiary(dispense.beneficiary_id, {
      title: `تم الصرف — ${dispense.facility.name}`,
      body: text,
      url: order ? `/beneficiary/orders/${order.id}` : "/beneficiary/dashboard",
      tag: order ? `ben-order-${order.id}` : `ben-dispense-${dispenseId}`,
    });
  } catch (error) {
    logger.warn("dispense notification failed", { error: String(error) });
  }
}
