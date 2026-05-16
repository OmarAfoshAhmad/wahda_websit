const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const transactionId = "ENTER_TRANSACTION_ID_HERE";
  const tx = await prisma.transaction.findFirst({
    where: { is_cancelled: false, type: { not: "CANCELLATION" } },
    orderBy: { created_at: 'desc' }
  });
  
  if (!tx) {
    console.log("No transaction found");
    return;
  }
  
  console.log("Found transaction:", tx.id, tx.amount);
  
  try {
    // Duplicate the logic of cancelTransaction exactly
    await prisma.$transaction(async (prismaTx) => {
      const locked = await prismaTx.$queryRaw`
        SELECT id, remaining_balance, status FROM "Beneficiary"
        WHERE id = ${tx.beneficiary_id}
        FOR UPDATE
      `;
      if (locked.length === 0) throw new Error("المستفيد غير موجود");
      
      const amount = Number(tx.amount);
      let refundAmount = 0;
      if (tx.type !== "DENTAL") {
        refundAmount = tx.actual_company_share != null 
          ? Number(tx.actual_company_share) 
          : Number(tx.amount);
      }
      
      const currentBalance = Number(locked[0].remaining_balance);
      const newBalance = currentBalance + refundAmount;
      const lockedStatus = locked[0].status;
      const newStatus = lockedStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
      
      await prismaTx.transaction.update({
        where: { id: tx.id },
        data: { is_cancelled: true },
      });
      
      await prismaTx.beneficiary.update({
        where: { id: tx.beneficiary_id },
        data: { remaining_balance: newBalance, status: newStatus },
      });
      
      const cancellationData = {
        beneficiary_id: tx.beneficiary_id,
        facility_id: tx.facility_id,
        amount: -amount,
        type: "CANCELLATION",
        is_cancelled: false,
        original_transaction_id: tx.id,
      };
      
      if (tx.company_id) {
        cancellationData.company_id = tx.company_id;
        cancellationData.service_category = tx.service_category;
        cancellationData.ceiling_consumed = tx.ceiling_consumed ? -Number(tx.ceiling_consumed) : 0;
        cancellationData.remaining_ceiling_before = null;
        cancellationData.remaining_ceiling_after = null;
      }
      
      await prismaTx.transaction.create({ data: cancellationData });
      
      await prismaTx.auditLog.create({
        data: {
          facility_id: tx.facility_id,
          user: "test_script",
          action: "CANCEL_TRANSACTION",
          metadata: { test: true },
        },
      });
      
      // Rollback to prevent actual changes
      throw new Error("ROLLBACK_SUCCESS");
    });
  } catch (error) {
    if (error.message === "ROLLBACK_SUCCESS") {
      console.log("Success! No errors.");
    } else {
      console.error("ERROR CAUGHT:", error);
    }
  }
}

test().finally(() => prisma.$disconnect());
