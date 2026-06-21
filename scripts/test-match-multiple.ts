import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function testMatch() {
  const companyId = "cmp7ha2km0000u9v8jse4ib5x";
  
  const dbBeneficiaries = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      company_id: companyId
    },
    select: {
      id: true,
      card_number: true,
      name: true,
      company_id: true,
    },
  });

  const resolveBeneficiary = (excelCard: string, excelName: string) => {
    if (!excelCard) return null;
    
    const normExcelCard = excelCard.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    
    const normalizeName = (n: string) => 
      n.replace(/عبد /g, "عبد")
       .replace(/[أإآ]/g, "ا")
       .replace(/ى/g, "ي")
       .replace(/ة/g, "ه")
       .replace(/\s+/g, " ")
       .trim();
       
    const cleanExcelName = normalizeName(excelName);

    const nameMatch = (dbName: string, exName: string) => {
      const cleanDb = normalizeName(dbName);
      if (cleanDb === exName) return 1.0;
      
      const dbWords = cleanDb.split(" ").filter(Boolean);
      const exWords = exName.split(" ").filter(Boolean);
      
      if (cleanDb.includes(exName) || exName.includes(cleanDb)) {
        if (dbWords[0] === exWords[0]) return 0.8;
        if (dbWords[0] && exWords[0] && dbWords[0].replace(/^ال/, "") === exWords[0].replace(/^ال/, "")) return 0.8;
        return 0.3; 
      }
      
      const intersection = dbWords.filter(w => exWords.includes(w));
      if (intersection.length >= 2) {
        if (dbWords[0] === exWords[0]) return 0.6;
        if (dbWords[0] && exWords[0] && dbWords[0].replace(/^ال/, "") === exWords[0].replace(/^ال/, "")) return 0.6;
        return 0.3;
      }
      
      return 0.0;
    };

    const getSuffix = (c: string) => {
      const match = c.match(/[MFWSDH]\d*$/);
      return match ? match[0] : "";
    };
    
    const getBase = (c: string) => {
      const withoutSuffix = c.replace(/[MFWSDH]\d+$/, "").replace(/[MFWSDH]$/, "");
      return withoutSuffix.replace(/(20\d{2})0+/, "$1");
    };
    
    const excelBase = getBase(normExcelCard);
    const excelSuffix = getSuffix(normExcelCard);

    console.log("normExcelCard", normExcelCard, "excelBase", excelBase, "excelSuffix", excelSuffix);

    const baseCandidates = dbBeneficiaries.filter(b => {
      const dbNorm = b.card_number.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const dbSuffix = getSuffix(dbNorm);
      if (excelSuffix && dbSuffix && excelSuffix !== dbSuffix) {
        return false;
      }
      return getBase(dbNorm) === excelBase;
    });

    console.log("baseCandidates length:", baseCandidates.length);

    if (baseCandidates.length > 0) {
      const scored = baseCandidates.map(c => {
        const dbNorm = c.card_number.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const isExactCard = dbNorm === normExcelCard;
        const score = nameMatch(c.name, cleanExcelName);
        console.log("Candidate:", c.name, "isExactCard:", isExactCard, "score:", score);
        return { candidate: c, isExactCard, score };
      });

      if (excelSuffix) {
        const exact = scored.find(s => s.isExactCard);
        if (exact && exact.score >= 0.0) {
          return exact.candidate;
        }
      }

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      
      if (best.score >= 0.4) {
        return best.candidate;
      }

      return null;
    }

    return null;
  };

  console.log("--- 1 ---");
  const r1 = resolveBeneficiary("WAB2025009382", "نبيله عبد الله رافع الاثرم");
  console.log("Result:", r1 ? r1.name : "NULL");

  console.log("--- 2 ---");
  const r2 = resolveBeneficiary("WAB202509870", "بسمه عزالدين محمد زوبي");
  console.log("Result:", r2 ? r2.name : "NULL");

  console.log("--- 3 ---");
  const r3 = resolveBeneficiary("WAB2025004593", "ميرا علي عبد الجواد مصطفى");
  console.log("Result:", r3 ? r3.name : "NULL");
}

testMatch().catch(console.error).finally(() => prisma.$disconnect());
