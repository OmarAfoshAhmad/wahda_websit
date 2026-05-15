"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Button, Card, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { 
  Loader2, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Info, 
  XCircle, 
  CheckSquare, 
  Square,
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft
} from "lucide-react";
import { 
  importTruthRegistryAction, 
  validateTruthRegistryAction, 
  RegistryImportItem 
} from "@/app/actions/truth-registry";

type ParsedItem = {
  card_number: string;
  card_number_upper: string;
  name: string;
  birth_date: string | null;
  status: "READY" | "DUPLICATE_FILE" | "DUPLICATE_SYSTEM" | "ERROR";
  error_message: string;
  source_row: number;
};

export function TruthRegistryImport() {
  const { toast, success, error } = useToast();
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // خيارات الاستيراد
  const [city, setCity] = useState("طرابلس");
  const [batchNumber, setBatchNumber] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(true);

  // السجلات التي تم تحليلها ومعاينتها
  const [parsedItems, setParsedItems] = useState<ParsedItem[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importResult, setImportResult] = useState<{
    added: number;
    updated: number;
    skipped: number;
  } | null>(null);

  const [detectedCardKey, setDetectedCardKey] = useState("");
  const [detectedNameKey, setDetectedNameKey] = useState("");

  // كتل البحث والتصفية
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(15);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // تصفية السجلات بناءً على حالة البحث والفلتر النشط
  const filteredItems = (parsedItems || []).filter(item => {
    const matchesSearch = 
      item.card_number.toLowerCase().includes(searchInput.toLowerCase()) || 
      item.name.toLowerCase().includes(searchInput.toLowerCase());
    
    if (statusFilter !== "ALL") {
      return matchesSearch && item.status === statusFilter;
    }
    return matchesSearch;
  });

  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);

  // إحصائيات السجلات المقروءة
  const stats = {
    total: parsedItems?.length || 0,
    ready: parsedItems?.filter(i => i.status === "READY").length || 0,
    duplicateFile: parsedItems?.filter(i => i.status === "DUPLICATE_FILE").length || 0,
    duplicateSystem: parsedItems?.filter(i => i.status === "DUPLICATE_SYSTEM").length || 0,
    error: parsedItems?.filter(i => i.status === "ERROR").length || 0,
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // استخراج رقم الدفعة من اسم الملف تلقائياً
    const nameWithoutExt = file.name;
    const batchMatch = nameWithoutExt.match(/\d+/);
    if (batchMatch) {
      setBatchNumber(batchMatch[0]);
    } else {
      setBatchNumber("");
    }

    setFileName(file.name);
    setIsParsing(true);
    setParsedItems(null);
    setImportResult(null);
    setCurrentPage(1);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: "array", cellDates: false });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // إصلاح الخلايا المدمجة (Merged Cells Fill-Down)
        const merges = worksheet['!merges'] || [];
        merges.forEach(merge => {
          const startCell = worksheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })];
          if (!startCell) return;
          for (let r = merge.s.r; r <= merge.e.r; r++) {
            for (let c = merge.s.c; c <= merge.e.c; c++) {
              if (r === merge.s.r && c === merge.s.c) continue;
              const addr = XLSX.utils.encode_cell({ r, c });
              if (!worksheet[addr]) worksheet[addr] = { ...startCell };
            }
          }
        });

        const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (rawRows.length === 0) {
          error("الملف فارغ أو لا يحتوي على صفوف بيانات صالحة");
          setIsParsing(false);
          return;
        }

        // دالة تطبيع نصوص اللغة العربية للتخلص من فروق الهمزات والتاء المربوطة والياء
        const normalizeArabic = (str: string) => {
          return String(str || "")
            .replace(/[أإآ]/g, "ا")
            .replace(/ة/g, "ه")
            .replace(/ى/g, "ي")
            .toLowerCase()
            .trim();
        };

        // دالة للبحث عن المفتاح المناسب للمعمود بغض النظر عن تنسيقه
        const findKey = (keys: string[]) => {
          const firstRow = rawRows[0];
          return Object.keys(firstRow).find(k => 
            keys.some(searchKey => normalizeArabic(k).includes(normalizeArabic(searchKey)))
          );
        };

        // ذكاء تحديد عمود رقم البطاقة بناءً على محتوى البيانات (البحث عن الخلايا التي تبدأ بـ WAB)
        let cardKey = "";
        const allKeys = Object.keys(rawRows[0] || {});
        for (const key of allKeys) {
          const hasWABVal = rawRows.slice(0, 30).some(row => {
            const val = String(row[key] || "").trim().toUpperCase();
            return val.startsWith("WAB2025") || val.startsWith("WAB");
          });
          if (hasWABVal) {
            cardKey = key;
            break;
          }
        }

        // إذا لم نجد عموداً يبدأ بـ WAB عبر فحص المحتوى، نحاول البحث بالترويسة كخيار احتياطي
        if (!cardKey) {
          cardKey = findKey(["البطاقة", "Card", "Barcode", "الباركود", "رقم"]) || "";
        }

        // دالة ذكية جداً لتحديد عمود الاسم الحقيقي واستبعاد ترويسات صلة القرابة (موظف، زوجة، ابن...)
        const findNameKey = () => {
          const firstRow = rawRows[0];
          if (!firstRow) return "";
          
          const relationshipTerms = ["موظف", "موظفة", "زوجة", "ابن", "ابنة", "ابنه", "ام", "اب", "أب", "أخت", "أخ", "زوج", "أم", "بنت", "ولد", "طفل"];
          const candidateKeys = allKeys.filter(k => 
            ["الاسم", "الاسم الكامل", "المستفيد", "الموظف", "Name", "Full Name"].some(searchKey => 
              normalizeArabic(k).includes(normalizeArabic(searchKey))
            )
          );

          // إذا لم يجد ترويسة مطابقة، نجعل كل الأعمدة مرشحة عدا عمود البطاقة
          const finalCandidates = candidateKeys.length > 0 ? candidateKeys : allKeys;

          let bestKey = "";
          let bestScore = -1000;

          for (const key of finalCandidates) {
            if (key === cardKey) continue;
            
            let score = 0;
            const lowerKey = key.toLowerCase();
            const normalizedKey = normalizeArabic(key);
            
            // تمييز الترويسات التي تحتوي صراحة على "الاسم"
            if (normalizedKey.includes("الاسم") || lowerKey === "name" || lowerKey.includes("full")) {
              score += 500;
            }

            const sampleRows = rawRows.slice(0, 15);
            let relationshipMatches = 0;
            let singleWordCount = 0;
            let longNameMatches = 0;
            let totalValids = 0;

            for (const row of sampleRows) {
              const val = String(row[key] || "").trim();
              if (!val) continue;
              totalValids++;

              // تنظيف "الـ" التعريف والمسافات الزائدة للمطابقة الدقيقة لصلة القرابة
              let cleaned = val;
              if (cleaned.startsWith("ال")) {
                cleaned = cleaned.slice(2);
              }

              if (relationshipTerms.some(term => cleaned === term)) {
                relationshipMatches++;
              }
              
              // فحص إذا كان العمود يحتوي على كلمة واحدة فقط (لا مسافات)
              if (!val.includes(" ") && !val.includes(" ")) {
                singleWordCount++;
              }

              // فحص إذا كان الاسم ثنائي/ثلاثي أو أطول
              if (val.split(/\s+/).length >= 2 && val.length > 8) {
                longNameMatches++;
              }
            }

            if (totalValids > 0) {
              const relationRatio = relationshipMatches / totalValids;
              const singleWordRatio = singleWordCount / totalValids;

              // عقوبة ثقيلة جداً إذا كان العمود يحتوي على كلمات صلة قرابة أو كان عبارة عن كلمات مفردة (مثل صلة القرابة)
              if (relationRatio > 0.2 || singleWordRatio > 0.6) {
                score -= 3000; // استبعاد قطعي نهائي
              }

              score += (longNameMatches / totalValids) * 400;
            }

            if (score > bestScore) {
              bestScore = score;
              bestKey = key;
            }
          }

          return bestKey || candidateKeys[0] || "";
        };

        const nameKey = findNameKey();
        const birthDateKey = findKey(["تاريخ", "تاريخ الميلاد", "Birth", "ميلاد", "DOB"]);

        setDetectedCardKey(cardKey || "");
        setDetectedNameKey(nameKey || "");

        if (!cardKey) {
          error("تعذر العثور على عمود يحتوي على (رقم البطاقة / الباركود) في ملف الإكسيل!");

          setIsParsing(false);
          return;
        }

        // التحقق من أن الملف يحتوي فعلياً على بطاقات تبدأ بـ WAB2025 في أسطره لمنع رفع ملفات خاطئة
        const hasValidCardsInFile = rawRows.some(row => {
          const val = String(row[cardKey] || "").trim().toUpperCase();
          return val.startsWith("WAB2025") || val.startsWith("WAB20") || val.startsWith("WAB");
        });

        if (!hasValidCardsInFile) {
          error("تم رفض الملف! هذا الملف لا يحتوي على أرقام بطاقات مطبوعة صحيحة تبدأ بـ WAB2025 في أي من صفوفه.");
          setIsParsing(false);
          return;
        }

        const seenInFile = new Set<string>();

        // 1. المعالجة الأولية مع كشف المكررات داخل الملف
        const mappedItems: ParsedItem[] = rawRows.map((row, index) => {
          // استخراج رقم البطاقة
          const cardNumRaw = String(row[cardKey] || "").trim();
          const cardUpper = cardNumRaw.toUpperCase();

          // استخراج الاسم (اختياري)
          const nameVal = nameKey ? String(row[nameKey] || "").trim() : "";

          // استخراج تاريخ الميلاد (اختياري)
          let bDate = null;
          const rawDate = birthDateKey ? row[birthDateKey] : null;
          
          if (rawDate) {
            if (rawDate instanceof Date) {
              const y = rawDate.getFullYear();
              if (y >= 1850 && y <= 2100) {
                const m = String(rawDate.getMonth() + 1).padStart(2, '0');
                const d = String(rawDate.getDate()).padStart(2, '0');
                bDate = `${y}-${m}-${d}`;
              }
            } else if (typeof rawDate === "number") {
              // فقط نقبل الأرقام المنطقية لتواريخ إكسيل (لتجنب تفسير الرقم الوظيفي أو الباركود كأعوام مفرطة)
              if (rawDate > 1 && rawDate < 150000) {
                const date = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
                const y = date.getUTCFullYear();
                if (y >= 1850 && y <= 2100) {
                  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
                  const d = String(date.getUTCDate()).padStart(2, '0');
                  bDate = `${y}-${m}-${d}`;
                }
              }
            } else {
              // إزالة الأحرف غير المرئية
              let strDate = String(rawDate || "").replace(/[^\d\/\-]/g, "").trim();
              if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(strDate)) {
                 const parts = strDate.split(/[\/\-]/);
                 const y = parseInt(parts[2]);
                 if (y >= 1850 && y <= 2100) {
                   bDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                 }
              } else if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(strDate)) {
                 const parts = strDate.split(/[\/\-]/);
                 const y = parseInt(parts[0]);
                 if (y >= 1850 && y <= 2100) {
                   bDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                 }
              }
            }
          }

          let status: "READY" | "DUPLICATE_FILE" | "ERROR" = "READY";
          let errorMsg = "";

          if (!cardNumRaw || cardNumRaw.length < 5) {
            status = "ERROR";
            errorMsg = "رقم بطاقة تالف أو قصير جداً";
          } else if (!cardUpper.startsWith("WAB")) {
            status = "ERROR";
            errorMsg = "رقم بطاقة غير صالح (يجب أن يبدأ بـ WAB2025)";
          } else if (seenInFile.has(cardUpper)) {
            status = "DUPLICATE_FILE";
            errorMsg = "سجل مكرر داخل نفس ملف الإكسيل";
          } else {
            seenInFile.add(cardUpper);
          }

          return {
            card_number: cardNumRaw,
            card_number_upper: cardUpper,
            name: nameVal,
            birth_date: bDate,
            status,
            error_message: errorMsg,
            source_row: index + 2,
          };
        });

        // 2. التحقق من التكرار في النظام عبر السيرفر دفعة واحدة (Bulk Validation)
        const readyItems = mappedItems.filter(item => item.status === "READY");

        if (readyItems.length > 0) {
          const validateRes = await validateTruthRegistryAction(
            readyItems.map(item => ({ card_number: item.card_number }))
          );

          if (validateRes.success && validateRes.existing) {
            const existingMap = new Map(validateRes.existing);
            mappedItems.forEach(item => {
              if (item.status === "READY" && existingMap.has(item.card_number_upper)) {
                item.status = "DUPLICATE_SYSTEM";
                const dbInfo = existingMap.get(item.card_number_upper) as any;
                item.error_message = `مسجلة بالنظام مسبقاً (${dbInfo.city} — دفعة: ${dbInfo.batch || "غير محدد"})`;
              }
            });
          }
        }

        setParsedItems(mappedItems);
        success(`تم إجراء الفحص لـ ${mappedItems.length} سجل من الملف بنجاح!`);
      } catch (err) {
        console.error(err);
        error("خطأ أثناء تحليل ملف الإكسيل. تأكد من سلامة الملف.");
      } finally {
        setIsParsing(false);
        if (e.target) e.target.value = "";
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (!parsedItems || parsedItems.length === 0) return;
    if (!batchNumber) {
      error("يرجى إدخال رقم الدفعة أو اسم المجموعة للمتابعة");
      return;
    }

    setIsSaving(true);
    try {
      // إعداد البيانات النهائية وتعيين رقم الدفعة والمدينة المحددة من الواجهة
      const finalData: RegistryImportItem[] = parsedItems
        .filter(item => item.status !== "ERROR" && item.status !== "DUPLICATE_FILE")
        .map(item => ({
          card_number: item.card_number,
          name: item.name || null,
          birth_date: item.birth_date,
          city: city,
          batch_number: batchNumber,
          source_file: fileName,
          source_sheet: "Sheet1",
          source_row: item.source_row
        }));

      if (finalData.length === 0) {
        error("لا توجد سجلات صالحة للاستيراد");
        setIsSaving(false);
        return;
      }

      const res = await importTruthRegistryAction(finalData, { overwriteExisting });
      
      if (res.error) {
        error(res.error);
      } else {
        success("اكتملت عملية الاستيراد لجدول الحقيقة بنجاح!");
        setImportResult({
          added: res.added || 0,
          updated: res.updated || 0,
          skipped: res.skipped || 0
        });
        setParsedItems(null);
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء الحفظ في قاعدة البيانات");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-2xl overflow-hidden transition-all duration-300">
      <div className="space-y-6">
        
        {/* صف الإعدادات الجانبية للرفع */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mr-1 block">المدينة</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-950 transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
            >
              <option value="طرابلس">طرابلس</option>
              <option value="بنغازي">بنغازي</option>
              <option value="مصراتة">مصراتة</option>
              <option value="الزاوية">الزاوية</option>
              <option value="سبها">سبها</option>
              <option value="طبرق">طبرق</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mr-1 block">رقم الدفعة أو المجموعة</label>
            <Input
              placeholder="مثال: 26، بنغازي_15..."
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              className="h-11 rounded-xl font-bold bg-slate-50/50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mr-1 block">طريقة معالجة السجلات المكررة بالنظام</label>
            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl h-11 items-center gap-1">
              <button
                type="button"
                onClick={() => setOverwriteExisting(true)}
                className={`flex-1 h-9 rounded-lg text-xs font-black transition-all ${overwriteExisting ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                تحديث البيانات
              </button>
              <button
                type="button"
                onClick={() => setOverwriteExisting(false)}
                className={`flex-1 h-9 rounded-lg text-xs font-black transition-all ${!overwriteExisting ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                تخطي وتجاهل
              </button>
            </div>
          </div>
        </div>

        {/* لوحة رفع الملف أو عرض النتائج */}
        {!parsedItems ? (
          <div>
            {importResult ? (
              <div className="p-6 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-2xl mb-4 text-center animate-in fade-in zoom-in duration-300">
                <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-lg font-black text-emerald-900 dark:text-emerald-100 mb-1">اكتمل الاستيراد بنجاح!</h3>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-4">تم دمج وتحديث البيانات داخل السجل المرجعي (جدول الحقيقة).</p>
                <div className="flex justify-center gap-6 max-w-sm mx-auto bg-white dark:bg-slate-900 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30 shadow-sm text-sm font-bold">
                  <div>
                    <span className="block text-xl font-black text-emerald-600">{importResult.added}</span>
                    <span className="text-[10px] text-slate-400">سجل جديد</span>
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 self-center" />
                  <div>
                    <span className="block text-xl font-black text-blue-500">{importResult.updated}</span>
                    <span className="text-[10px] text-slate-400">سجل تم تحديثه</span>
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 self-center" />
                  <div>
                    <span className="block text-xl font-black text-amber-500">{importResult.skipped}</span>
                    <span className="text-[10px] text-slate-400">تم تخطيه</span>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setImportResult(null)}
                  className="mt-4 border-slate-200 dark:border-slate-800 rounded-xl"
                >
                  استيراد ملف جديد
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-950/20">
                <div className="h-16 w-16 rounded-2xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-4 border border-blue-100 dark:border-blue-900/20 shadow-inner">
                  <Upload className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-base font-black mb-1 text-slate-900 dark:text-white">اسحب وأفلت ملف الاستيراد هنا</h3>
                <p className="text-xs text-slate-500 mb-6 text-center max-w-sm">
                  قم برفع ملف إكسيل يحتوي على عمود أرقام البطاقات/الباركود. الأعمدة الأخرى كـ (الاسم، تاريخ الميلاد) سيتم جلبها تلقائياً إذا توفرت.
                </p>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={isParsing}
                    ref={fileInputRef}
                  />
                  <Button type="button" disabled={isParsing} className="pointer-events-none rounded-xl h-11 px-6 shadow-lg bg-blue-600 hover:bg-blue-700">
                    {isParsing ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        جاري فحص وتدقيق الملف...
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="ml-2 h-4 w-4" />
                        اختيار ملف الإكسيل
                      </>
                    )}
                  </Button>
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {/* مؤشر تشخيص الأعمدة المكتشفة */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 flex flex-col md:flex-row gap-4 md:items-center justify-between text-xs font-bold text-slate-500">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span className="text-slate-400">العمود المكتشف للبطاقات:</span>
                <span className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-black font-mono border border-blue-100/30">{detectedCardKey || "غير محدد"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="text-slate-400">العمود المكتشف للأسماء:</span>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-black font-mono border border-emerald-100/30">{detectedNameKey || "غير محدد"}</span>
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                * يتعرف النظام ذكياً على الأعمدة ويستبعد ترويسات صلات القرابة والرموز المفردة.
              </div>
            </div>

            {/* ملخص الإحصائيات الفورية */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <button 
                type="button"
                onClick={() => { setStatusFilter("ALL"); setCurrentPage(1); }}
                className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between h-20 ${statusFilter === "ALL" ? "border-slate-900 dark:border-slate-100 bg-slate-950 text-white" : "border-slate-100 dark:border-slate-800 bg-slate-50/50 hover:bg-slate-100/50"}`}
              >
                <span className="text-[10px] font-black uppercase opacity-70">إجمالي المقروء</span>
                <span className="text-2xl font-black">{stats.total}</span>
              </button>
              
              <button 
                type="button"
                onClick={() => { setStatusFilter("READY"); setCurrentPage(1); }}
                className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between h-20 ${statusFilter === "READY" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-100/40 dark:border-emerald-500/10 bg-emerald-50/20 dark:bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/40"}`}
              >
                <span className="text-[10px] font-black uppercase opacity-70">جاهز (جديد)</span>
                <span className="text-2xl font-black">{stats.ready}</span>
              </button>

              <button 
                type="button"
                onClick={() => { setStatusFilter("DUPLICATE_SYSTEM"); setCurrentPage(1); }}
                className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between h-20 ${statusFilter === "DUPLICATE_SYSTEM" ? "border-blue-600 bg-blue-600 text-white" : "border-blue-100/40 dark:border-blue-500/10 bg-blue-50/20 dark:bg-blue-500/5 text-blue-700 dark:text-blue-400 hover:bg-blue-50/40"}`}
              >
                <span className="text-[10px] font-black uppercase opacity-70">مكرر بالنظام</span>
                <span className="text-2xl font-black">{stats.duplicateSystem}</span>
              </button>

              <button 
                type="button"
                onClick={() => { setStatusFilter("DUPLICATE_FILE"); setCurrentPage(1); }}
                className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between h-20 ${statusFilter === "DUPLICATE_FILE" ? "border-amber-600 bg-amber-600 text-white" : "border-amber-100/40 dark:border-amber-500/10 bg-amber-50/20 dark:bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-50/40"}`}
              >
                <span className="text-[10px] font-black uppercase opacity-70">مكرر بالملف</span>
                <span className="text-2xl font-black">{stats.duplicateFile}</span>
              </button>

              <button 
                type="button"
                onClick={() => { setStatusFilter("ERROR"); setCurrentPage(1); }}
                className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between h-20 ${statusFilter === "ERROR" ? "border-rose-600 bg-rose-600 text-white" : "border-rose-100/40 dark:border-rose-500/10 bg-rose-50/20 dark:bg-rose-500/5 text-rose-700 dark:text-rose-400 hover:bg-rose-50/40"}`}
              >
                <span className="text-[10px] font-black uppercase opacity-70">أخطاء/تالف</span>
                <span className="text-2xl font-black">{stats.error}</span>
              </button>
            </div>

            {/* أدوات البحث والفرز الداخلي للمعاينة */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:w-80 group">
                <Search className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" />
                <Input
                  placeholder="بحث في السجلات المقروءة..."
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); setCurrentPage(1); }}
                  className="h-10 pr-10 rounded-xl"
                />
              </div>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setParsedItems(null)}
                  disabled={isSaving}
                  className="text-slate-500 hover:text-slate-800 rounded-xl"
                >
                  إلغاء المعاينة
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={isSaving || (stats.ready === 0 && !overwriteExisting)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 h-10 shadow-lg shadow-emerald-600/10 rounded-xl"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      جاري دمج السجلات...
                    </>
                  ) : (
                    <>
                      <Upload className="ml-2 h-4 w-4" />
                      اعتماد واستيراد {overwriteExisting ? stats.ready + stats.duplicateSystem : stats.ready} سجل
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* جدول عرض السجلات المعاينة */}
            <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right text-slate-850">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-3 text-center w-16">الصف</th>
                      <th className="px-4 py-3">رقم البطاقة</th>
                      <th className="px-4 py-3">الاسم (مستخرج)</th>
                      <th className="px-4 py-3">تاريخ الميلاد (مستخرج)</th>
                      <th className="px-4 py-3 text-center w-36">الحالة</th>
                      <th className="px-4 py-3">تفاصيل الملاحظة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {paginatedItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          لا توجد نتائج مطابقة لخيارات التصفية الحالية.
                        </td>
                      </tr>
                    ) : (
                      paginatedItems.map((item) => (
                        <tr key={item.source_row} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                          <td className="px-4 py-3 text-center text-slate-400 font-mono text-xs">{item.source_row}</td>
                          <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">{item.card_number}</td>
                          <td className="px-4 py-3 font-bold">{item.name || <span className="text-slate-400 text-xs font-normal">غير متوفر (سيتم حفظ الباركود فقط)</span>}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                            {item.birth_date || <span className="text-slate-400 text-xs font-normal">غير متوفر</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.status === "READY" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                                جاهز ومؤكد
                              </span>
                            )}
                            {item.status === "DUPLICATE_SYSTEM" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                                مكرر بالنظام
                              </span>
                            )}
                            {item.status === "DUPLICATE_FILE" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                                مكرر بالملف
                              </span>
                            )}
                            {item.status === "ERROR" && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
                                غير صالح
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                            {item.status === "DUPLICATE_SYSTEM" && !overwriteExisting ? (
                              <span className="text-amber-600 font-bold">⚠️ سيتم تخطي هذا السجل بناءً على خيارك الحالي</span>
                            ) : item.status === "DUPLICATE_SYSTEM" && overwriteExisting ? (
                              <span className="text-blue-500 font-bold">🔄 سيتم دمج وتحديث الاسم والميلاد لهذا السجل</span>
                            ) : item.status === "DUPLICATE_FILE" ? (
                              <span className="text-slate-400">سيتم استيراد النسخة الأولى فقط من البطاقة</span>
                            ) : item.error_message ? (
                              <span className="text-rose-500 font-medium">{item.error_message}</span>
                            ) : (
                              <span className="text-emerald-600 font-medium">سجل جديد تماماً سيتم إنشاؤه</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* أزرار التنقل بين الصفحات للمعاينة */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs text-slate-500">
                    صفحة {currentPage} من {totalPages} (يعرض {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredItems.length)} من {filteredItems.length})
                  </span>
                  <div className="flex gap-1.5" dir="ltr">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="h-8 w-8 p-0 rounded-lg border-slate-200"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="h-8 w-8 p-0 rounded-lg border-slate-200"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* لوحة الملاحظات والإرشادات */}
        <div className="flex items-start gap-3 p-4 bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100/40 dark:border-blue-900/30 rounded-2xl">
          <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-black text-sm mb-1">دليل استيراد جدول الحقيقة الذكي:</p>
            <ul className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
              <li>يقوم النظام بـ **البحث التلقائي الذكي** عن أعمدة رقم البطاقة والاسم والميلاد، ويدعم كافة التسميات الشائعة.</li>
              <li>**الاسم وتاريخ الميلاد اختيارية تماماً**: إذا لم تتواجد الأعمدة أو كانت بعض الحقول فارغة، سيتم استيراد ببساطة رقم البطاقة والاحتفاظ بالبيانات القديمة إذا كانت موجودة مسبقاً بالنظام.</li>
              <li>يقوم النظام بمطابقة وتدقيق أرقام البطاقات لمنع تكرارها في نفس الملف أو مع سجلات مضافة مسبقاً بقاعدة البيانات.</li>
              <li>**خيار دمج وتحديث البيانات:** عند تفعيله، سيتم تحديث الأسماء والمواليد للسجلات المكررة في النظام بأحدث البيانات الموجودة بملفك.</li>
            </ul>
          </div>
        </div>

      </div>
    </Card>
  );
}
