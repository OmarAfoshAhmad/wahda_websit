"use client";

import React, { useState, useRef } from "react";
import { Upload, FileSpreadsheet, Send, Trash2, Download, CheckCircle2, AlertCircle, History, Trash, CheckSquare, Square, Info, XCircle, Search } from "lucide-react";
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

// مكون فرعي للأزرار (Chips) الخاصة بالفلاتر لضمان التراصف والجمالية
const StatusChip = ({ active, onClick, label, count, variant }: { 
  active: boolean, 
  onClick: () => void, 
  label: string, 
  count: number,
  variant: "all" | "success" | "warning" | "danger" | "info"
}) => {
  const variants = {
    all: active ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg" : "bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800",
    success: active ? "bg-emerald-600 dark:bg-emerald-500 text-white shadow-lg" : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    warning: active ? "bg-amber-600 dark:bg-amber-500 text-white shadow-lg" : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    danger: active ? "bg-rose-600 dark:bg-rose-500 text-white shadow-lg" : "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20",
    info: active ? "bg-blue-600 dark:bg-blue-500 text-white shadow-lg" : "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all duration-300 transform active:scale-95",
        variants[variant]
      )}
    >
      <span>{label}</span>
      <span className={cn(
        "px-1.5 py-0.5 rounded-md text-[10px]",
        active ? "bg-white/20" : "bg-black/5"
      )}>
        {count}
      </span>
    </button>
  );
};

export function CardNumberingClient({ 
  initialItems, 
  showDeleted,
  canManage = true,
  canMigrate = true
}: { 
  initialItems: any[], 
  showDeleted: boolean,
  canManage?: boolean,
  canMigrate?: boolean
}) {
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
  const [confirmModal, setConfirmModal] = useState<{ open: boolean, title: string, message: string, onConfirm: () => void, variant?: "danger" | "warning" | "info" }>({
    open: false, title: "", message: "", onConfirm: () => {}
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setImportReport(null);
    toast.info("جاري قراءة الملف، يرجى الانتظار...");
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        console.log("File loaded, starting parse...");
        const arrayBuffer = evt.target?.result as ArrayBuffer;
        const data = new Uint8Array(arrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawRows = XLSX.utils.sheet_to_json(ws) as any[];

        if (rawRows.length === 0) {
          toast.error("الملف فارغ");
          setIsParsing(false);
          return;
        }

        const mappedData = rawRows.map(row => {
          const keys = Object.keys(row);
          const values = Object.values(row).map(v => String(v || "").trim());
          
          const findKey = (keywords: string[]) => 
            keys.find(k => keywords.some(kw => String(k).includes(kw)));

          const getField = (row: any, ...keywords: string[]) => {
            const key = keys.find(k => keywords.some(kw => String(k).includes(kw)));
            return key ? row[key] : null;
          };

          const nameKey = findKey(["الاسم", "Name", "المستفيد", "اسم الموظف", "اسم العضو", "Full Name"]);
          let empNum = String(getField(row, "employee_number", "رقم الموظف", "الرقم الوظيفي", "رقم_الموظف", "الرقم_الوظيفي", "employee number", "employee_id", "رقم الموظف/المستفيد", "الرقم") || "").trim();
          const relKey = findKey(["صلة", "القرابة", "Relationship", "النوع", "الصلة", "Rel"]);
          const bDateKey = findKey(["ميلاد", "Birth", "تاريخ", "BDate", "DOB"]);

          // استخراج القيم
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
          
          const statusKey = findKey(["الحالة", "Status", "الوضع"]);
          
          let bDate = "";
          if (bDateRaw instanceof Date) {
            bDate = bDateRaw.toISOString().split('T')[0];
          } else {
            bDate = String(bDateRaw || "").trim();
          }

          const notesKey = findKey(["ملاحظات", "Notes", "البيان", "ملاحظة"]);
          
          return {
            name: String(name || "").trim(),
            employee_number: String(empNum || "").trim(),
            relationship: String(rel || "").trim(),
            birth_date: bDate,
            status: statusKey ? String(row[statusKey] || "").trim() : "",
            field3: notesKey ? String(row[notesKey] || "").trim() : "",
          };
        });

        const filteredData = mappedData.filter(item => item.name && item.name.length > 2 && item.employee_number);

        if (filteredData.length === 0) {
          const firstRow = rawRows[0] ? JSON.stringify(Object.keys(rawRows[0])) : "لا توجد أعمدة";
          toast.error(`لم يتم العثور على سجلات صالحة. الأعمدة المكتشفة: ${firstRow}`);
          setIsParsing(false);
          return;
        }

        setPendingData({ data: filteredData, fileName: file.name });
        setShowSettingsModal(true);
        setIsParsing(false);
        toast.success(`تم العثور على ${filteredData.length} سجل جاهز للمراجعة.`);
      } catch (err) {
        console.error("File parsing error:", err);
        toast.error("حدث خطأ أثناء تحليل بيانات الملف.");
      } finally {
        setIsParsing(false);
        if (e.target) e.target.value = ""; 
      }
    };
    reader.onerror = () => {
      toast.error("فشل في قراءة الملف من الجهاز.");
      setIsParsing(false);
    };
    reader.readAsArrayBuffer(file);
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
        if (res.report.total === 0) {
          toast.info("تمت المعالجة ولكن لم يتم العثور على بيانات صالحة. تأكد من مسميات الأعمدة.");
        } else {
          toast.success(`تم معالجة ${res.report.total} سجل بنجاح`);
        }
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

    setConfirmModal({
      open: true,
      title: "تأكيد عملية الترحيل",
      message: `سيتم ترحيل ${toMigrate.length} مستفيد جديد برصيد 600 دينار لكل منهم. هل تريد الاستمرار؟`,
      variant: "info",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
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
      }
    });
  };

  const executeMigrate = async (toMigrate: string[]) => {
    // This part is now handled inside onConfirm
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
    const rawData = selectedIds.length > 0 ? items.filter(i => selectedIds.includes(i.id)) : items;
    if (rawData.length === 0) return;

    const isExcluded = (item: any) => {
      const text = `${item.name} ${item.status || ""} ${item.relationship || ""} ${item.error_message || ""}`.toLowerCase();
      return text.includes("ملحق") || text.includes("متوفي") || text.includes("متوفى") || text.includes("وفاة");
    };

    const validItems = rawData.filter(i => !isExcluded(i));
    const excludedItems = rawData.filter(i => isExcluded(i));

    const wb = XLSX.utils.book_new();

    // الورقة الأولى: الأسماء بدون ملحق أو متوفي
    if (validItems.length > 0) {
      const exportData = validItems.map((item, index) => ({
        "متسلسل": index + 1,
        "الاسم": item.name,
        "الرقم الوظيفي": item.employee_number,
        "رقم البطاقة": item.card_number,
        "صلة القرابة": item.relationship || "موظف",
        "الميلاد": item.birth_date ? new Date(item.birth_date).toLocaleDateString('en-GB') : "",
        "الحالة": item.status === "MIGRATED" ? "تم الترحيل" : "نشط"
      }));
      const ws1 = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws1, "المستفيدين الفعليين");
    }

    // الورقة الثانية: أسماء الملحقين والمتوفين
    if (excludedItems.length > 0) {
      const excludedData = excludedItems.map((item, index) => ({
        "متسلسل": index + 1,
        "الاسم": item.name,
        "الرقم الوظيفي": item.employee_number,
        "رقم البطاقة": item.card_number,
        "صلة القرابة": item.relationship || "",
        "تاريخ الميلاد": item.birth_date ? new Date(item.birth_date).toLocaleDateString('en-GB') : "",
        "الحالة": "مستبعد (ملحق أو متوفي)"
      }));
      const ws2 = XLSX.utils.json_to_sheet(excludedData);
      XLSX.utils.book_append_sheet(wb, ws2, "الملحقين والمتوفين");
    }

    XLSX.writeFile(wb, `تقرير_ترقيم_البطاقات_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDownloadExcludedReport = () => {
    if (!importReport?.excludedItems || importReport.excludedItems.length === 0) return;
    
    const exportData = importReport.excludedItems.map((item: any, index: number) => ({
      "متسلسل": index + 1,
      "الرقم الوظيفي": item.employee_number,
      "اسم المستفيد": item.name,
      "صلة القرابة": item.relationship,
      "تاريخ الميلاد": item.birth_date,
      "الحالة": item.status,
      "سبب الاستبعاد": "ملحق أو متوفي"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المستبعدين");
    XLSX.writeFile(wb, `تقرير_المستبعدين_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handlePrintVerification = () => {
    const dataToPrint = selectedIds.length > 0 ? items.filter(i => selectedIds.includes(i.id)) : items;
    if (dataToPrint.length === 0) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const tableRows = dataToPrint.map((item, index) => {
      const bDate = item.birth_date ? new Date(item.birth_date).toLocaleDateString('en-GB') : "";
      return `
        <tr>
          <td>${index + 1}</td>
          <td style="font-family: monospace;">${item.card_number}</td>
          <td>${item.name}</td>
          <td>${item.card_number}</td>
          <td>${bDate}</td>
          <td style="width: 80px;"></td>
        </tr>
      `;
    }).join("");

    printWindow.document.write(`
      <html dir="rtl">
        <head>
          <title>تقرير التصدي - ${new Date().toLocaleDateString('ar-LY')}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
            body { font-family: 'Tajawal', sans-serif; padding: 20px; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #000; padding: 8px; text-align: center; word-break: break-all; }
            th { background-color: #f2f2f2; font-weight: 900; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .logo { height: 60px; }
            @media print {
              @page { margin: 1cm; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 style="margin: 0; font-size: 20px;">شركة الواحة للرعاية الصحية</h1>
              <p style="margin: 5px 0 0 0;">تقرير التصدي لترقيم البطاقات</p>
            </div>
            <div style="text-align: left;">
              <p style="margin: 0;">التاريخ: ${new Date().toLocaleDateString('ar-LY')}</p>
              <p style="margin: 0;">العدد: ${dataToPrint.length}</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">#</th>
                <th>باركود</th>
                <th style="width: 30%;">اسم المستفيد</th>
                <th>رقم البطاقة</th>
                <th>الميلاد</th>
                <th style="width: 100px;">صورة</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDeleteSelected = async () => {
    setConfirmModal({
      open: true,
      title: "نقل للسلة",
      message: `هل أنت متأكد من نقل ${selectedIds.length} سجل إلى سلة المحذوفات؟`,
      variant: "warning",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        const res = await deleteCardNumberingArchiveItemsAction(selectedIds);
        if (res.success) window.location.reload();
      }
    });
  };

  const handleRestoreSelected = async () => {
    if (selectedIds.length === 0) return;
    setConfirmModal({
      open: true,
      title: "استعادة السجلات",
      message: `هل تريد استعادة ${selectedIds.length} سجل من سلة المحذوفات؟`,
      variant: "info",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        const res = await restoreCardNumberingArchiveItemsAction(selectedIds);
        if (res.success) window.location.reload();
      }
    });
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    setConfirmModal({
      open: true,
      title: "حذف نهائي",
      message: `تحذير: سيتم حذف ${selectedIds.length} سجل نهائياً من النظام. لا يمكن التراجع عن هذه العملية. هل أنت متأكد؟`,
      variant: "danger",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        const res = await permanentlyDeleteCardNumberingArchiveItemsAction(selectedIds);
        if (res.success) window.location.reload();
      }
    });
  };

  const handleClear = async () => {
    setConfirmModal({
      open: true,
      title: "مسح الأرشيف",
      message: "هل أنت متأكد من مسح الأرشيف بالكامل؟ لا يمكن التراجع عن هذه العملية.",
      variant: "danger",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        setIsClearing(true);
        const res = await clearCardNumberingArchiveAction();
        if (res.success) window.location.reload();
        setIsClearing(false);
      }
    });
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
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-950 dark:text-white">ترقيم البطاقات</h1>
          <p className="mt-1 text-xs font-bold text-slate-500">إدارة واستيراد البطاقات تلقائياً.</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {canManage && (
            <>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls" className="hidden" />
              <Button onClick={() => fileInputRef.current?.click()} disabled={isParsing || isImporting} size="sm" className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-md h-9">
                <Upload className="h-4 w-4" />
                {isParsing ? "قراءة..." : (isImporting ? "استيراد..." : "استيراد وتدقيق")}
              </Button>

              <Button onClick={handleDownloadTemplate} variant="outline" size="sm" className="gap-2 border-blue-600 text-blue-600 h-9">
                <FileSpreadsheet className="h-4 w-4" />
                النموذج
              </Button>

              <Button 
                onClick={() => window.location.href = showDeleted ? "/admin/card-numbering" : "/admin/card-numbering?deleted=true"} 
                variant="outline" 
                size="sm"
                className={cn("gap-2 h-9", showDeleted ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20" : "text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 dark:bg-slate-800 hover:dark:bg-slate-700")}
              >
                {showDeleted ? <History className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                {showDeleted ? "الأرشيف" : "السلة"}
              </Button>
            </>
          )}

          {canMigrate && (
            <Button onClick={handleMigrate} disabled={isMigrating || items.length === 0} size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-md h-9">
              <Send className="h-4 w-4" />
              {isMigrating ? "ترحيل..." : "ترحيل (600 د.ل)"}
            </Button>
          )}

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden md:block" />

          {showDeleted ? (
            <>
              {canManage && (
                <>
                  <Button onClick={handleRestoreSelected} variant="outline" size="sm" disabled={selectedIds.length === 0} className="gap-2 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 hover:dark:bg-emerald-500/10 h-9">
                    <CheckCircle2 className="h-4 w-4" />
                    استعادة
                  </Button>
                  <Button onClick={handlePermanentDeleteSelected} variant="outline" size="sm" disabled={selectedIds.length === 0} className="gap-2 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20 hover:dark:bg-red-500/10 h-9">
                    <Trash className="h-4 w-4" />
                    حذف
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              {canManage && selectedIds.length > 0 && (
                <Button onClick={handleDeleteSelected} variant="outline" size="sm" className="gap-2 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-transparent hover:bg-rose-100 hover:dark:bg-rose-500/10 h-9">
                  <Trash2 className="h-4 w-4" />
                  نقل للسلة ({selectedIds.length})
                </Button>
              )}
              <Button onClick={handleExport} variant="outline" size="sm" disabled={items.length === 0} className="gap-2 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 dark:bg-slate-800 hover:dark:bg-slate-700 h-9">
                <FileSpreadsheet className="h-4 w-4" />
                تصدير
              </Button>
              <Button onClick={handlePrintVerification} variant="outline" size="sm" disabled={items.length === 0} className="gap-2 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 hover:dark:bg-slate-600 h-9">
                <Download className="h-4 w-4" />
                طباعة
              </Button>
            </>
          )}
        </div>
      </div>

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
                <p className="text-2xl font-black text-rose-400">{importReport.excluded || 0}</p>
                <p className="text-[10px] uppercase text-slate-500">مستبعد</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-red-400">{importReport.error}</p>
                <p className="text-[10px] uppercase text-slate-500">خطأ</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(importReport.excluded > 0) && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleDownloadExcludedReport}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20 gap-2"
                >
                  <Download className="h-4 w-4" />
                  تحميل تقرير المستبعدين
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setImportReport(null)} className="text-slate-400 hover:text-white">
                <XCircle className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </Card>
      )}
      
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* قسم البحث - يمين (RTL) */}
          <div className="flex-1 max-w-md flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="w-full pr-10 pl-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                placeholder="بحث بالاسم أو الرقم الوظيفي..."
              />
            </div>
            <Button onClick={handleSearch} className="rounded-xl px-6 bg-slate-900 hover:bg-slate-800 shadow-md">بحث</Button>
          </div>

          {/* معلومات العرض */}
          <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-dashed">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">المعروض حالياً</span>
            <span className="text-sm font-black text-slate-900 dark:text-white">{filteredItems.length}</span>
            <span className="text-xs text-slate-400">من أصل {items.length}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/50">
          <StatusChip 
            active={statusFilter === "ALL"} 
            onClick={() => setStatusFilter("ALL")}
            label="الكل"
            count={items.length}
            variant="all"
          />
          <StatusChip 
            active={statusFilter === "READY"} 
            onClick={() => setStatusFilter("READY")}
            label="جاهز للترحيل"
            count={items.filter(i => i.status === "READY").length}
            variant="success"
          />
          <StatusChip 
            active={statusFilter === "DUPLICATE_FILE"} 
            onClick={() => setStatusFilter("DUPLICATE_FILE")}
            label="مكرر في الملف"
            count={items.filter(i => i.status === "DUPLICATE_FILE").length}
            variant="warning"
          />
          <StatusChip 
            active={statusFilter === "DUPLICATE_SYSTEM"} 
            onClick={() => setStatusFilter("DUPLICATE_SYSTEM")}
            label="مكرر بالمنظومة"
            count={items.filter(i => i.status === "DUPLICATE" && i.error_message?.includes("[SYSTEM]")).length}
            variant="warning"
          />
          <StatusChip 
            active={statusFilter === "DUPLICATE_ARCHIVE"} 
            onClick={() => setStatusFilter("DUPLICATE_ARCHIVE")}
            label="مكرر بالأرشيف"
            count={items.filter(i => i.status === "DUPLICATE" && i.error_message?.includes("[ARCHIVE]")).length}
            variant="warning"
          />
          <StatusChip 
            active={statusFilter === "ERROR"} 
            onClick={() => setStatusFilter("ERROR")}
            label="أخطاء"
            count={items.filter(i => i.status === "ERROR").length}
            variant="danger"
          />
          <StatusChip 
            active={statusFilter === "MIGRATED"} 
            onClick={() => setStatusFilter("MIGRATED")}
            label="تم ترحيله"
            count={items.filter(i => i.status === "MIGRATED").length}
            variant="info"
          />
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
      {/* مودال إعدادات الاستيراد */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
          <Card className="w-full max-w-md shadow-2xl animate-in zoom-in duration-300 overflow-hidden">
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-3 border-b pb-4">
                <div className="p-2 bg-blue-100 rounded-lg"><Upload className="h-6 w-6 text-blue-600" /></div>
                <h3 className="font-black text-xl">إعدادات الاستيراد</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">بادئة رقم البطاقة (Prefix)</label>
                  <Input 
                    value={importPrefix} 
                    onChange={(e) => setImportPrefix(e.target.value)} 
                    placeholder="مثال: WAB2025"
                    className="text-left font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">سيتم إضافة هذا النص قبل الرقم الوظيفي</p>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <button 
                    onClick={() => setUsePadding(!usePadding)}
                    className={cn("p-1 rounded border", usePadding ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 text-transparent")}
                  >
                    <CheckSquare className="h-4 w-4" />
                  </button>
                  <label className="text-sm font-bold text-slate-700 cursor-pointer" onClick={() => setUsePadding(!usePadding)}>تكملة الأصفار (Padding)</label>
                </div>

                {usePadding && (
                  <div>
                    <Input 
                      type="number"
                      value={importPadding} 
                      onChange={(e) => setImportPadding(parseInt(e.target.value) || 0)} 
                      className="text-left font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">مثال: 6 تعني أن الرقم 123 سيصبح 000123</p>
                  </div>
                )}

                <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 flex gap-2">
                  <Info className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    تم العثور على <strong>{pendingData?.data.length}</strong> سجل صالح في الملف. 
                    سيتم تدقيق التكرار تلقائياً عند البدء.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button onClick={executeImport} className="flex-1 bg-blue-600 hover:bg-blue-700 h-11 font-bold">
                  بدء الاستيراد والتدقيق
                </Button>
                <Button variant="outline" onClick={() => setShowSettingsModal(false)} className="h-11 font-bold">
                  إلغاء
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* مودال التأكيد المخصص */}
      {confirmModal.open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
          <Card className="w-full max-w-md shadow-2xl animate-in zoom-in duration-300">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 border-b pb-4">
                <div className={cn(
                  "p-2 rounded-lg",
                  confirmModal.variant === "danger" ? "bg-rose-100 text-rose-600" :
                  confirmModal.variant === "warning" ? "bg-amber-100 text-amber-600" :
                  "bg-blue-100 text-blue-600"
                )}>
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h3 className="font-black text-xl">{confirmModal.title}</h3>
              </div>
              
              <p className="text-slate-600 leading-relaxed font-bold">
                {confirmModal.message}
              </p>

              <div className="flex gap-3 pt-4">
                <Button 
                  onClick={confirmModal.onConfirm}
                  className={cn(
                    "flex-1 h-11 font-bold",
                    confirmModal.variant === "danger" ? "bg-rose-600 hover:bg-rose-700" :
                    confirmModal.variant === "warning" ? "bg-amber-600 hover:bg-amber-700" :
                    "bg-blue-600 hover:bg-blue-700"
                  )}
                >
                  تأكيد
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
                  className="flex-1 h-11 font-bold"
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

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
