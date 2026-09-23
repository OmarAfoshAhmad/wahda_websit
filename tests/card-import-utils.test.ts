import { describe, it, expect } from "vitest";
import {
  cleanImportText,
  normalizeArabicName,
  lookupRelTerm,
  parseDateParts,
  parseCellDate,
  escapeRegex,
  findCardNumberingHeaderRowIndex,
} from "@/lib/card-import-utils";

// اختبارات مبنية على حالات فعلية واجهناها أثناء استيراد ملفات ترقيم البطاقات:
// محارف اتجاهية غير مرئية، صلة قرابة بصيغ متعددة، وتواريخ بصيغ متضاربة.

describe("cleanImportText", () => {
  it("يزيل المحارف الاتجاهية غير المرئية (RLE/PDF/RLM) التي يضيفها الإكسيل", () => {
    // "الموظف" مغلّفة بـ U+202B ... U+202C U+200F كما وردت فعلياً في ملف "جليانة دفعة سابعة"
    const polluted = "‫الموظف‬‏";
    expect(cleanImportText(polluted)).toBe("الموظف");
  });

  it("يزيل التطويل والتشكيل", () => {
    expect(cleanImportText("مُحَمَّـــد")).toBe("محمد");
  });

  it("يحوّل الأرقام العربية-الهندية إلى أرقام إنجليزية", () => {
    expect(cleanImportText("٦٧")).toBe("67");
  });

  it("يُرجع نصاً فارغاً لقيم null/undefined بأمان", () => {
    expect(cleanImportText(null)).toBe("");
    expect(cleanImportText(undefined)).toBe("");
  });
});

describe("normalizeArabicName", () => {
  it("يوحّد الهمزة في بداية الاسم", () => {
    expect(normalizeArabicName("إسماعيل")).toBe(normalizeArabicName("اسماعيل"));
  });

  it("يوحّد التاء المربوطة والهاء", () => {
    expect(normalizeArabicName("فاطمة")).toBe(normalizeArabicName("فاطمه"));
  });

  it("يعتبر اسمين متطابقين رغم المحارف الاتجاهية غير المرئية", () => {
    const a = normalizeArabicName("أحمد على");
    const b = normalizeArabicName("‫احمد علي‬");
    expect(a).toBe(b);
  });
});

describe("lookupRelTerm", () => {
  it("يعرف صلة الأب رغم اختلاف صيغة 'ال' التعريف", () => {
    expect(lookupRelTerm("الاب")).toBe("اب");
    expect(lookupRelTerm("والد")).toBe("اب");
    expect(lookupRelTerm("أب")).toBe("اب");
  });

  it("يعرف صلة الأم بكل الصيغ الشائعة", () => {
    expect(lookupRelTerm("الام")).toBe("ام");
    expect(lookupRelTerm("والدة")).toBe("ام");
  });

  it("يعرف 'موظف' حتى بمحارف اتجاهية ملوّثة (حالة فعلية من الأرشيف)", () => {
    expect(lookupRelTerm("‫الموظف‬‏")).toBe("موظف");
  });

  it("يُرجع نصاً فارغاً لصلة غير معروفة بدل قيمة عشوائية", () => {
    expect(lookupRelTerm("شيء غير معروف تماماً")).toBe("");
  });
});

describe("parseDateParts", () => {
  it("يحلل صيغة يوم-شهر-سنة", () => {
    expect(parseDateParts("27-11-1969")).toEqual({ y: 1969, m: 11, d: 27 });
  });

  it("يحلل صيغة سنة-شهر-يوم", () => {
    expect(parseDateParts("1969-11-27")).toEqual({ y: 1969, m: 11, d: 27 });
  });

  it("يحلل شهراً بخانة واحدة بدون صفر بادئ", () => {
    expect(parseDateParts("13-1-2007")).toEqual({ y: 2007, m: 1, d: 13 });
  });

  it("يُرجع null لنص غير قابل للتحليل", () => {
    expect(parseDateParts("نص غير صالح")).toBeNull();
    expect(parseDateParts("")).toBeNull();
  });
});

describe("parseCellDate", () => {
  it("لا يفسّر سنة ميلاد مجردة (كـ 1964) كتسلسل تاريخ إكسيل", () => {
    // كانت القيمة الرقمية 1964 (مثلاً من عمود EMPNO مُلتقط خطأً) تتحول سابقاً إلى تاريخ في 1905
    const result = parseCellDate(1964);
    expect(result.bDate).toBe("1964-01-01");
  });

  it("يحول تسلسل تاريخ إكسيل الحقيقي بشكل صحيح", () => {
    // 30843 يقابل 1984-06-10 في نظام تسلسل إكسيل
    const result = parseCellDate(30843);
    expect(result.bDate).toBe("1984-06-10");
  });

  it("يعالج تاريخ Date كائن مباشرة", () => {
    const d = new Date(2007, 0, 13); // محلي، بدون تحويل UTC
    const result = parseCellDate(d);
    expect(result.bDate).toBe("2007-01-13");
  });

  it("ينظّف المحارف غير المرئية من نص التاريخ قبل التحليل", () => {
    const result = parseCellDate("‫27-11-1969‬");
    expect(result.bDate).toBe("1969-11-27");
  });

  it("يعيد سلسلة فارغة لقيمة عددية خارج أي نطاق معقول", () => {
    const result = parseCellDate(500);
    expect(result.bDate).toBe("");
  });
});

describe("escapeRegex", () => {
  it("يهرّب المحارف الخاصة بتعبيرات RegExp", () => {
    const dangerous = "ATCL(2026)+[test]";
    const pattern = new RegExp(`^${escapeRegex(dangerous)}$`);
    expect(pattern.test(dangerous)).toBe(true);
    expect(pattern.test("ATCLX2026Xtest")).toBe(false);
  });

  it("لا يرمي استثناء عند بناء نمط من مدخل يحتوي أقواساً غير متوازنة", () => {
    expect(() => new RegExp(`^${escapeRegex("ATCL(")}`)).not.toThrow();
  });
});

describe("findCardNumberingHeaderRowIndex", () => {
  it("يتجاوز الصف التمهيدي ويختار صف الرقم الوظيفي والاسم", () => {
    const rows = [
      ["كشف منتسبي الشركة"],
      ["الرقم الوظيفي", "الاسم", "صلة القرابة", "تاريخ الميلاد"],
      [1, "محمد مفتاح سالم", "الموظف", 25370],
    ];

    expect(findCardNumberingHeaderRowIndex(rows)).toBe(1);
  });

  it("ينظف محارف الاتجاه المخفية في رؤوس الأعمدة", () => {
    const rows = [["‫الرقم الوظيفي‬‏", "‫الاسم‬‏", "صلة القرابة"]];
    expect(findCardNumberingHeaderRowIndex(rows)).toBe(0);
  });
});
