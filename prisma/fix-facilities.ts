import { PrismaClient } from "@prisma/client";
import { inferFacilityTypeFromText } from "../src/lib/facility-type";

const prisma = new PrismaClient();

async function main() {
  console.log("🚀 بدء تحديث أنواع المرافق...");

  const facilities = await prisma.facility.findMany();
  let updatedCount = 0;

  for (const fac of facilities) {
    const inferredType = inferFacilityTypeFromText(fac.name, fac.username);
    
    // إذا كان النوع الحالي مختلفاً عن النوع المستنتج، نقوم بتحديثه
    if (fac.facility_type !== inferredType) {
      await prisma.facility.update({
        where: { id: fac.id },
        data: { facility_type: inferredType }
      });
      console.log(`✅ تم التحديث: ${fac.name} -> ${inferredType}`);
      updatedCount++;
    }
  }

  console.log(`🏁 اكتمل التحديث! تم تعديل ${updatedCount} مرفق.`);
}

main()
  .catch(e => {
    console.error("❌ حدث خطأ:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
