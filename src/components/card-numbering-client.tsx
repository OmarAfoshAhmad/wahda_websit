"use client";

import React, { useState, useRef } from "react";
import { Upload, FileSpreadsheet, Send, Trash2, Download, CheckCircle2, AlertCircle, History, Trash, CheckSquare, Square, Info, XCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { Button, Card, Badge } from "./ui";
import { 
  importCardNumberingAction, 
  migrateCardNumberingAction, 
  deleteCardNumberingArchiveItemsAction, 
  clearCardNumberingArchiveAction 
} from "@/app/actions/card-numbering";
import { useToast } from "./toast";
import { cn } from "./ui";

export function CardNumberingClient({ initialItems }: { initialItems: any[] }) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [importReport, setImportReport] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
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
          const empNum = row["الرقم الوظيفي"] || row["Employee Number"] || Object.values(row)[0];
          const name = row["الاسم"] || row["Name"] || Object.values(row)[1];
          const rel = row["صلة القرابة"] || row["Relationship"] || Object.values(row)[2];
          const bDateRaw = row["تاريخ الميلاد"] || row["Birth Date"] || Object.values(row)[3];
          let bDate = "";
          if (bDateRaw instanceof Date) {
            bDate = bDateRaw.toISOString().split('T')[0];
          } else {
            bDate = String(bDateRaw || "").trim();
          }
          const field3 = row["بيانات إضافية"] || row["Notes"] || Object.values(row)[4];

          return {
            name: String(name || "").trim(),
            employee_number: String(empNum || "").trim(),
            relationship: String(rel || "").trim(),
            birth_date: bDate,
            field3: field3 ? String(field3 || "").trim() : "",
          };
        }).filter(item => item.name || item.employee_number);

        const res = await importCardNumberingAction(mappedData);
        if (res.success) {
          setImportReport(res.report);
          toast.success("تم الانتهاء من معالجة الملف");
          // Refresh after a small delay to show report
          setTimeout(() => window.location.reload(), 3000);
        } else {
          toast.error(res.error || "فشل الاستيراد");
        }
      } catch (err) {
        console.error(err);
        toast.error("فشل قراءة الملف.");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleMigrate = async () => {
    // Migrate only selected or all READY items
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
    try {
      const res = await migrateCardNumberingAction(toMigrate);
      if (res.success) {
        toast.success(`تم ترحيل ${res.successCount} مستفيد بنجاح`);
        window.location.reload();
      } else {
        toast.error(res.error || "فشل الترحيل");
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

  const handleClear = async () => {
    if (!confirm("مسح الأرشيف بالكامل؟")) return;
    setIsClearing(true);
    const res = await clearCardNumberingArchiveAction();
    if (res.success) window.location.reload();
    setIsClearing(false);
  };

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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls" className="hidden" />
          <Button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Upload className="h-4 w-4" />
            {isImporting ? "جاري المعالجة..." : "استيراد وتدقيق"}
          </Button>

          <Button onClick={handleDownloadTemplate} variant="outline" className="gap-2 border-blue-600 text-blue-600">
            <FileSpreadsheet className="h-4 w-4" />
            نموذج الاستيراد
          </Button>

          <Button onClick={handleMigrate} disabled={isMigrating || items.length === 0} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Send className="h-4 w-4" />
            {isMigrating ? "جاري الترحيل..." : "ترحيل الجاهز (600 د.ل)"}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline" disabled={items.length === 0} className="gap-2 text-slate-600">
            <Download className="h-4 w-4" />
            تصدير التقرير
          </Button>
          <Button onClick={handleClear} variant="outline" disabled={isClearing || items.length === 0} className="gap-2 text-red-600 border-red-200">
            <Trash className="h-4 w-4" />
            مسح الأرشيف
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-4 w-10">
                  <button onClick={() => setSelectedIds(selectedIds.length === items.length ? [] : items.map(i => i.id))}>
                    {selectedIds.length === items.length && items.length > 0 ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-slate-300" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-black text-slate-500">المستفيد / الرقم الوظيفي</th>
                <th className="px-4 py-3 font-black text-slate-500">رقم البطاقة المولد</th>
                <th className="px-4 py-3 font-black text-slate-500">الحالة</th>
                <th className="px-4 py-3 font-black text-slate-500">التفاصيل / الأخطاء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">لا توجد بيانات بانتظار المعالجة.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className={cn("hover:bg-slate-50 transition-colors", selectedIds.includes(item.id) && "bg-primary/5")}>
                    <td className="p-4">
                      <button onClick={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])}>
                        {selectedIds.includes(item.id) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-slate-300" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs font-mono text-slate-400">{item.employee_number} ({item.relationship || "موظف"})</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{item.card_number}</td>
                    <td className="px-4 py-3">
                      {item.status === "READY" && <Badge variant="success">جاهز للترحيل</Badge>}
                      {item.status === "MIGRATED" && <Badge variant="info">تم الترحيل</Badge>}
                      {item.status === "DUPLICATE" && <Badge variant="warning">مكرر بالنظام</Badge>}
                      {item.status === "ERROR" && <Badge variant="danger">خطأ بيانات</Badge>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {item.error_message ? <span className="text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {item.error_message}</span> : <span className="text-slate-400">سجل سليم</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
