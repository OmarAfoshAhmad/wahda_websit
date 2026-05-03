"use client";

import React, { useState, useRef } from "react";
import { Upload, FileSpreadsheet, Send, Trash2, Download, CheckCircle2, AlertCircle, History, Trash, CheckSquare, Square, Info, XCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { Button, Card, Badge, Input } from "./ui";
import { 
  importCardNumberingAction, 
  migrateCardNumberingAction, 
  deleteCardNumberingArchiveItemsAction, 
  restoreCardNumberingArchiveItemsAction,
  permanentlyDeleteCardNumberingArchiveItemsAction,
  rollbackMigrationAction,
  getMigrationLogs,
  clearCardNumberingArchiveAction 
} from "@/app/actions/card-numbering";
import { useToast } from "./toast";
import { cn } from "./ui";

export function CardNumberingClient({ initialItems, showDeleted }: { initialItems: any[], showDeleted: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [importReport, setImportReport] = useState<any>(null);
  const [migrationReport, setMigrationReport] = useState<any>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearchTerm, setActiveSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [importPrefix, setImportPrefix] = useState("WAB2025");
  const [importPadding, setImportPadding] = useState(6);
  const [usePadding, setUsePadding] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pendingData, setPendingData] = useState<{data: any[], fileName: string} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setImportReport(null);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary", cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          toast.error("الملف فارغ");
          return;
        }

        const mappedData = data.map(row => {
          const keys = Object.keys(row);
          const values = Object.values(row).map(v => String(v || "").trim());
          
          const findKey = (keywords: string[]) => 
            keys.find(k => keywords.some(kw => String(k).includes(kw)));

          // كلمات مفتاحية أكثر دقة
          const nameKey = findKey(["الاسم", "Name", "المستفيد", "اسم الموظف", "اسم العضو"]);
          const empNumKey = findKey(["الوظيفي", "Employee", "رقم الموظف", "رقم العضو"]);
          const relKey = findKey(["صلة", "القرابة", "Relationship", "النوع", "الصلة"]);
          const bDateKey = findKey(["ميلاد", "Birth", "تاريخ"]);

          // استخراج القيم
          let empNum = empNumKey ? row[empNumKey] : "";
          let name = nameKey ? row[nameKey] : "";
          let rel = relKey ? row[relKey] : "";
          let bDateRaw = bDateKey ? row[bDateKey] : "";

          // كلمات يجب استبعادها من أن تكون "اسماً"
          const forbiddenWords = ["زوجة", "زوج", "ابن", "ابنة", "ام", "اب", "موظف", "موظفة", "متقاعد", "متقاعدة", "رب الأسرة", "وفاة", "موقوف"];

          // إذا فشل البحث بالأسماء، نحاول التخمين بناءً على المحتوى
          if (!name || forbiddenWords.includes(String(name).trim())) {
            // نبحث عن كافة النصوص التي قد تكون أسماء
            const candidates = values.filter(v => 
              v.length > 2 && 
              !/^\d+$/.test(v) && 
              !forbiddenWords.includes(v) &&
              !v.toLowerCase().includes("gmt") &&
              !v.toLowerCase().includes("utc") &&
              !v.toLowerCase().includes("time")
            );

            // نختار "أطول" نص يحتوي على حروف عربية (لضمان أنه الاسم الثلاثي/الرباعي وليس مجرد كلمة صلة)
            const arabicCandidates = candidates.filter(v => /[\u0600-\u06FF]/.test(v));
            if (arabicCandidates.length > 0) {
              name = arabicCandidates.reduce((a, b) => b.length > a.length ? b : a, "");
            } else if (candidates.length > 0) {
              name = candidates.reduce((a, b) => b.length > a.length ? b : a, "");
            }
          }

          // تخمين الرقم الوظيفي إذا لم يوجد (أول عمود يحتوي على أرقام فقط)
          if (!empNum) {
            const numCol = values.find(v => /^\d+$/.test(v) && v.length > 1);
            if (numCol) empNum = numCol;
          }

          // تخمين الصلة
          if (!rel) {
            const relCol = values.find(v => ["زوجة", "زوج", "ابن", "ابنة", "ام", "اب", "موظف", "رب الأسرة"].includes(v));
            if (relCol) rel = relCol;
          }
          
          let bDate = "";
          if (bDateRaw instanceof Date) {
            bDate = bDateRaw.toISOString().split('T')[0];
          } else {
            bDate = String(bDateRaw || "").trim();
          }

          return {
            name: String(name || "").trim(),
            employee_number: String(empNum || "").trim(),
            relationship: String(rel || "").trim(),
            birth_date: bDate,
            field3: "",
          };
        }).filter(item => item.name && item.name.length > 2 && item.employee_number);

        setPendingData({ data: mappedData, fileName: file.name });
        setShowSettingsModal(true);
      } catch (err) {
        toast.error("فشل قراءة الملف.");
      } finally {
        setIsParsing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const executeImport = async () => {
    if (!pendingData) return;
    setIsImporting(true);
    setShowSettingsModal(false);
    try {
      const res = await importCardNumberingAction(pendingData.data, { 
        prefix: importPrefix, 
        padding: usePadding ? importPadding : 0, 
        sourceFile: pendingData.fileName 
      });

      if (res.success) {
        setImportReport(res.report);
        toast.success("تم الانتهاء من معالجة الملف");
        setTimeout(() => window.location.reload(), 3000);
      } else {
        toast.error(res.error || "فشل الاستيراد");
      }
    } catch (err) {
      toast.error("حدث خطأ أثناء الاستيراد");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleMigrate = async () => {
    const readyItems = items.filter(i => i.status === "READY");
    const toMigrate = selectedIds.length > 0 
      ? selectedIds.filter(id => items.find(i => i.id === id)?.status === "READY")
      : readyItems.map(i => i.id);
    
    if (toMigrate.length === 0) {
      toast.error("لا توجد سجلات بحالة (جاهز) للترحيل");
      return;
    }

    if (!confirm(`سيتم ترحيل ${toMigrate.length} مستفيد جديد برصيد 600 دينار لكل منهم. هل تريد الاستمرار؟`)) {
      return;
    }

    setIsMigrating(true);
    setMigrationReport(null);
    setShowMigrationModal(true);
    try {
      const res = await migrateCardNumberingAction(toMigrate);
      if (res.success) {
        setMigrationReport(res.report);
        toast.success(`اكتملت العملية: تم إضافة ${res.report.added} وتحديث ${res.report.updated}`);
      } else {
        toast.error(res.error || "فشل الترحيل");
        setShowMigrationModal(false);
      }
    } finally {
      setIsMigrating(false);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { "الرقم الوظيفي": "12345", "الاسم": "محمد أحمد", "صلة القرابة": "موظف", "تاريخ الميلاد": "1985-01-01", "بيانات إضافية": "" },
      { "الرقم الوظيفي": "12345", "الاسم": "أمل محمد", "صلة القرابة": "ابنة", "تاريخ الميلاد": "2010-05-15", "بيانات إضافية": "" },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "card_numbering_template.xlsx");
  };

  const handleExport = () => {
    const dataToExport = selectedIds.length > 0 ? items.filter(i => selectedIds.includes(i.id)) : items;
    if (dataToExport.length === 0) return;
    const exportData = dataToExport.map(item => ({
      "الرقم الوظيفي": item.employee_number, "الاسم": item.name, "رقم البطاقة": item.card_number, "الحالة": item.status, "الخطأ": item.error_message || ""
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, "card_numbering_report.xlsx");
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`حذف ${selectedIds.length} سجل؟`)) return;
    const res = await deleteCardNumberingArchiveItemsAction(selectedIds);
    if (res.success) window.location.reload();
  };

  const handleRestoreSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`استعادة ${selectedIds.length} سجل؟`)) return;
    const res = await restoreCardNumberingArchiveItemsAction(selectedIds);
    if (res.success) window.location.reload();
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`تحذير: سيتم حذف ${selectedIds.length} سجل نهائياً من النظام. لا يمكن التراجع عن هذه العملية. هل أنت متأكد؟`)) return;
    const res = await permanentlyDeleteCardNumberingArchiveItemsAction(selectedIds);
    if (res.success) window.location.reload();
  };

  const handleClear = async () => {
    if (!confirm("مسح الأرشيف بالكامل؟")) return;
    setIsClearing(true);
    const res = await clearCardNumberingArchiveAction();
    if (res.success) window.location.reload();
    setIsClearing(false);
  };
  
  const handleSearch = () => {
    setActiveSearchTerm(searchInput);
    setCurrentPage(1);
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = 
      item.name.toLowerCase().includes(activeSearchTerm.toLowerCase()) || 
      item.employee_number.includes(activeSearchTerm) ||
      item.card_number.toLowerCase().includes(activeSearchTerm.toLowerCase());
    
    if (statusFilter !== "ALL") {
      if (statusFilter === "DUPLICATE_FILE") {
        return matchesSearch && item.status === "DUPLICATE" && item.error_message?.includes("[FILE]");
      }
      if (statusFilter === "DUPLICATE_SYSTEM") {
        return matchesSearch && item.status === "DUPLICATE" && item.error_message?.includes("[SYSTEM]");
      }
      if (statusFilter === "DUPLICATE_ARCHIVE") {
        return matchesSearch && item.status === "DUPLICATE" && item.error_message?.includes("[ARCHIVE]");
      }
      return matchesSearch && item.status === statusFilter;
    }
    return matchesSearch;
  });

  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {importReport && (
        <Card className="p-4 bg-slate-900 text-white border-none shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-blue-500/20 rounded-lg"><Info className="h-6 w-6 text-blue-400" /></div>
              <div>
                <h3 className="font-black text-lg">تقرير الاستيراد الأخير</h3>
                <p className="text-slate-400 text-sm">تمت معالجة {importReport.total} سجل</p>
              </div>
            </div>
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-2xl font-black text-emerald-400">{importReport.ready}</p>
                <p className="text-[10px] uppercase text-slate-500">جاهز</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-amber-400">{importReport.duplicate}</p>
                <p className="text-[10px] uppercase text-slate-500">مكرر</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-red-400">{importReport.error}</p>
                <p className="text-[10px] uppercase text-slate-500">خطأ</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setImportReport(null)} className="text-slate-400 hover:text-white">
              <XCircle className="h-5 w-5" />
            </Button>
          </div>
        </Card>
      )}
      
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="block w-full p-2.5 pr-10 text-sm text-slate-900 border border-slate-300 rounded-lg bg-slate-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-700 dark:placeholder-slate-400 dark:text-white"
                placeholder="بحث بالاسم أو الرقم الوظيفي أو البطاقة..."
              />
              <Button onClick={handleSearch} className="h-10">بحث</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "ALL" ? "bg-slate-900 text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              الكل ({items.length})
            </button>
            <button
              onClick={() => setStatusFilter("READY")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "READY" ? "bg-emerald-600 text-white shadow-md" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
            >
              جاهز ({items.filter(i => i.status === "READY").length})
            </button>
            <button
              onClick={() => setStatusFilter("DUPLICATE_FILE")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "DUPLICATE_FILE" ? "bg-orange-600 text-white shadow-md" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}
            >
              مكرر في الملف ({items.filter(i => i.status === "DUPLICATE_FILE").length})
            </button>
            <button
              onClick={() => setStatusFilter("DUPLICATE_SYSTEM")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "DUPLICATE_SYSTEM" ? "bg-amber-600 text-white shadow-md" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
            >
              مكرر في المنظومة ({items.filter(i => i.status === "DUPLICATE" && i.error_message?.includes("[SYSTEM]")).length})
            </button>
            <button
              onClick={() => setStatusFilter("DUPLICATE_ARCHIVE")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "DUPLICATE_ARCHIVE" ? "bg-orange-600 text-white shadow-md" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}
            >
              مكرر في الأرشيف ({items.filter(i => i.status === "DUPLICATE" && i.error_message?.includes("[ARCHIVE]")).length})
            </button>
            <button
              onClick={() => setStatusFilter("ERROR")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "ERROR" ? "bg-rose-600 text-white shadow-md" : "bg-rose-100 text-rose-700 hover:bg-rose-200"}`}
            >
              أخطاء ({items.filter(i => i.status === "ERROR").length})
            </button>
            <button
              onClick={() => setStatusFilter("MIGRATED")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === "MIGRATED" ? "bg-blue-600 text-white shadow-md" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
            >
              مرحل ({items.filter(i => i.status === "MIGRATED").length})
            </button>
            <div className="text-xs font-bold text-slate-400 mr-2">
              المعروض: {filteredItems.length}
            </div>
          </div>
        </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={() => fileInputRef.current?.click()} disabled={isParsing || isImporting} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Upload className="h-4 w-4" />
            {isParsing ? "جاري قراءة الملف..." : (isImporting ? "جاري الاستيراد..." : "استيراد وتدقيق")}
          </Button>

          <Button onClick={handleDownloadTemplate} variant="outline" className="gap-2 border-blue-600 text-blue-600">
            <FileSpreadsheet className="h-4 w-4" />
            نموذج الاستيراد
          </Button>

          <Button 
            onClick={() => window.location.href = showDeleted ? "/admin/card-numbering" : "/admin/card-numbering?deleted=true"} 
            variant="outline" 
            className={cn("gap-2", showDeleted ? "bg-amber-50 text-amber-600 border-amber-200" : "text-slate-600")}
          >
            {showDeleted ? <History className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
            {showDeleted ? "العودة للأرشيف النشط" : "سلة المحذوفات"}
          </Button>

          <Button onClick={handleMigrate} disabled={isMigrating || items.length === 0} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Send className="h-4 w-4" />
            {isMigrating ? "جاري الترحيل..." : "ترحيل الجاهز (600 د.ل)"}
          </Button>
        </div>

        <div className="flex gap-2">
          {showDeleted ? (
            <>
              <Button onClick={handleRestoreSelected} variant="outline" disabled={selectedIds.length === 0} className="gap-2 text-emerald-600 border-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                استعادة المحدد
              </Button>
              <Button onClick={handlePermanentDeleteSelected} variant="outline" disabled={selectedIds.length === 0} className="gap-2 text-red-600 border-red-200">
                <Trash className="h-4 w-4" />
                حذف نهائي
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleExport} variant="outline" disabled={items.length === 0} className="gap-2 text-slate-600">
                <Download className="h-4 w-4" />
                تصدير التقرير
              </Button>
              <Button onClick={handleDeleteSelected} variant="outline" disabled={selectedIds.length === 0} className="gap-2 text-red-600 border-red-200">
                <Trash className="h-4 w-4" />
                نقل للسلة
              </Button>
              <Button onClick={handleClear} variant="outline" disabled={isClearing || items.length === 0} className="gap-2 text-red-600 border-red-200">
                <Trash className="h-4 w-4" />
                مسح الأرشيف
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-4 w-10">
                  <button onClick={() => setSelectedIds(selectedIds.length === filteredItems.length ? [] : filteredItems.map(i => i.id))}>
                    {selectedIds.length === filteredItems.length && filteredItems.length > 0 ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-slate-300" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-black text-slate-500">المستفيد / الرقم الوظيفي</th>
                <th className="px-4 py-3 font-black text-slate-500">رقم البطاقة</th>
                <th className="px-4 py-3 font-black text-slate-500">الدفعة</th>
                <th className="px-4 py-3 font-black text-slate-500">الحالة</th>
                <th className="px-4 py-3 font-black text-slate-500">التفاصيل / الأخطاء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    {activeSearchTerm ? "لا توجد نتائج تطابق بحثك." : "لا توجد بيانات بانتظار المعالجة."}
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => (
                  <tr key={item.id} className={cn("hover:bg-slate-50 transition-colors border-b dark:border-slate-800", selectedIds.includes(item.id) && "bg-primary/5")}>
                    <td className="p-4">
                      <button onClick={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])}>
                        {selectedIds.includes(item.id) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-slate-300" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900 dark:text-white leading-tight">{item.name}</p>
                      <p className="text-xs font-mono text-slate-400">{item.employee_number} ({item.relationship || "موظف"})</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{item.card_number}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[120px] truncate" title={item.source_file || "يدوي"}>
                      {item.source_file || "يدوي"}
                    </td>
                    <td className="px-4 py-3">
                      {item.status === "READY" && <Badge variant="success">جاهز</Badge>}
                      {item.status === "MIGRATED" && <Badge variant="info">مُرحل</Badge>}
                      {item.status === "DUPLICATE" && item.error_message?.includes("[FILE]") && <Badge className="bg-orange-100 text-orange-700 border-orange-200">مكرر بالملف</Badge>}
                      {item.status === "DUPLICATE" && item.error_message?.includes("[SYSTEM]") && <Badge className="bg-amber-100 text-amber-700 border-amber-200">مكرر بالمنظومة</Badge>}
                      {item.status === "DUPLICATE" && item.error_message?.includes("[ARCHIVE]") && <Badge className="bg-orange-100 text-orange-700 border-orange-200">مكرر بالأرشيف</Badge>}
                      {item.status === "DUPLICATE" && !item.error_message?.includes("[") && <Badge variant="warning">مكرر بالنظام</Badge>}
                      {item.status === "ERROR" && <Badge variant="danger">خطأ</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {item.error_message ? <span className="text-red-500 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> {item.error_message}</span> : <span className="text-slate-400 italic">سليم</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="bg-slate-50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              عرض {paginatedItems.length} من أصل {filteredItems.length} سجل
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="h-8 px-4"
              >
                السابق
              </Button>
              <div className="flex items-center gap-1 px-4 text-xs font-bold text-slate-600">
                صفحة {currentPage} من {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="h-8 px-4"
              >
                التالي
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-4 flex gap-3 items-start">
        <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 dark:text-blue-200">
          <p className="font-bold mb-1 underline">قواعد الترحيل الذكي:</p>
          <ul className="list-disc list-inside space-y-1 opacity-90">
            <li>يتم ترحيل السجلات ذات الحالة <span className="font-bold text-emerald-600">جاهز للترحيل</span> فقط.</li>
            <li>المستفيدون الجدد يحصلون تلقائياً على رصيد إجمالي <strong>600 د.ل</strong>.</li>
            <li>يمنع النظام الترحيل إذا اكتشف تكراراً لرقم البطاقة في قاعدة البيانات الرئيسية.</li>
          </ul>
        </div>
      </div>
      {/* مودال نتائج الترحيل */}
      {showMigrationModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
          <Card className="w-full max-w-2xl shadow-2xl border-emerald-100 animate-in zoom-in duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 rounded-lg"><Send className="h-6 w-6 text-emerald-600" /></div>
                  <h3 className="font-black text-xl">تقرير عملية الترحيل</h3>
                </div>
                {!isMigrating && (
                  <Button variant="ghost" onClick={() => { setShowMigrationModal(false); window.location.reload(); }}>
                    <XCircle className="h-6 w-6" />
                  </Button>
                )}
              </div>

              {isMigrating ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                  <div className="relative h-20 w-20">
                    <div className="absolute inset-0 border-4 border-emerald-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-emerald-600 rounded-full border-t-transparent animate-spin"></div>
                  </div>
                  <p className="font-bold text-slate-600 animate-pulse">جاري ترحيل البيانات وتحديث السجلات...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl text-center">
                      <p className="text-2xl font-black text-slate-900">{migrationReport?.total}</p>
                      <p className="text-[10px] text-slate-500 uppercase">الإجمالي</p>
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-xl text-center">
                      <p className="text-2xl font-black text-emerald-600">{migrationReport?.added}</p>
                      <p className="text-[10px] text-emerald-600 uppercase">إضافة جديدة</p>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-xl text-center">
                      <p className="text-2xl font-black text-blue-600">{migrationReport?.updated}</p>
                      <p className="text-[10px] text-blue-600 uppercase">تحديث بيانات</p>
                    </div>
                    <div className="p-4 bg-rose-50 rounded-xl text-center">
                      <p className="text-2xl font-black text-rose-600">{migrationReport?.failed}</p>
                      <p className="text-[10px] text-rose-600 uppercase">فشل</p>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="max-height-[300px] overflow-y-auto scrollbar-thin">
                      <table className="w-full text-sm text-right">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-2">المستفيد</th>
                            <th className="px-4 py-2">الحالة</th>
                            <th className="px-4 py-2">السبب</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {migrationReport?.details.map((d: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="px-4 py-2 font-bold">{d.name}</td>
                              <td className="px-4 py-2">
                                {d.status === "ADDED" && <Badge variant="success">إضافة</Badge>}
                                {d.status === "UPDATED" && <Badge variant="info">تحديث</Badge>}
                                {d.status === "FAIL" && <Badge variant="danger">فشل</Badge>}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-500">{d.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
