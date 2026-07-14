"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { Button, Card, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { importTruthRegistryAction, RegistryImportItem } from "@/app/actions/truth-registry";

export function TruthRegistryImport() {
  const { toast, success, error } = useToast();
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<{
    data: RegistryImportItem[];
    fileName: string;
  } | null>(null);

  const [city, setCity] = useState("طرابلس");
  const [batchNumber, setBatchNumber] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (rawRows.length === 0) {
          error("الملف فارغ");
          return;
        }

        // دالة للبحث عن المفتاح المناسب بغض النظر عن التنسيق
        const findKey = (keys: string[]) => {
          const firstRow = rawRows[0];
          return Object.keys(firstRow).find(k => 
            keys.some(searchKey => k.toLowerCase().includes(searchKey.toLowerCase()))
          );
        };

        const cardKey = findKey(["البطاقة", "Card", "Barcode", "الباركود", "رقم"]);
        const nameKey = findKey(["الاسم", "Name", "المستفيد", "الموظف"]);
        const birthDateKey = findKey(["تاريخ", "Birth", "ميلاد", "DOB"]);

        const mappedData: RegistryImportItem[] = rawRows.map((row, index) => {
          let bDate = null;
          const rawDate = birthDateKey ? row[birthDateKey] : null;
          
          if (rawDate) {
            if (rawDate instanceof Date) {
              bDate = rawDate.toISOString();
            } else if (typeof rawDate === "number") {
              // معالجة تواريخ إكسيل التسلسلية
              const d = new Date((rawDate - 25569) * 86400 * 1000);
              bDate = d.toISOString();
            } else {
              bDate = String(rawDate);
            }
          }

          return {
            card_number: String(cardKey ? row[cardKey] : "").trim(),
            name: String(nameKey ? row[nameKey] : "").trim(),
            birth_date: bDate,
            city: city,
            batch_number: batchNumber || "غير محدد",
            source_file: file.name,
            source_sheet: sheetName,
            source_row: index + 2,
          };
        }).filter(item => item.card_number && item.card_number.length > 5);

        setPreview({ data: mappedData, fileName: file.name });
        success(`تم تحليل ${mappedData.length} سجل من الملف`);
      } catch (err) {
        console.error(err);
        error("خطأ في قراءة ملف الإكسيل");
      } finally {
        setIsParsing(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (!preview || preview.data.length === 0) return;
    if (!batchNumber) {
      error("يرجى إدخال رقم الدفعة أولاً");
      return;
    }

    setIsSaving(true);
    try {
      // تحديث رقم الدفعة والمدينة في المعاينة قبل الإرسال
      const finalData = preview.data.map(item => ({
        ...item,
        city: city,
        batch_number: batchNumber
      }));

      const res = await importTruthRegistryAction(finalData);
      if (res.error) {
        error(res.error);
      } else {
        success(`تم استيراد ${res.added} سجل بنجاح إلى جدول الحقيقة`);
        setPreview(null);
        // إعادة تحميل الصفحة لرؤية البيانات الجديدة
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      error("حدث خطأ أثناء الحفظ");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-bold">المدينة</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
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
            <label className="text-sm font-bold">رقم الدفعة (أو اسم المجموعة)</label>
            <Input
              placeholder="مثال: 26، بنغازي_12..."
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
            />
          </div>
        </div>

        {!preview ? (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-bold mb-1">استيراد سجلات جدول الحقيقة</h3>
            <p className="text-sm text-slate-500 mb-6 text-center max-w-md">
              قم برفع ملف إكسيل يحتوي على أرقام البطاقات والأسماء ليتم اعتمادها كمرجع للدفعات في النظام.
            </p>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isParsing}
              />
              <Button type="button" disabled={isParsing} className="pointer-events-none">
                {isParsing ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جاري التحليل...
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
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                <div>
                  <p className="font-bold text-emerald-900 dark:text-emerald-100">تم تحليل الملف: {preview.fileName}</p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">عدد السجلات الجاهزة للاستيراد: {preview.data.length}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={isSaving}>
                إلغاء
              </Button>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="primary"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleImport}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جاري الحفظ في القاعدة...
                  </>
                ) : (
                  <>
                    <Upload className="ml-2 h-4 w-4" />
                    بدء الاستيراد إلى قاعدة البيانات
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 rounded-lg">
          <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-bold">ملاحظات الاستيراد:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>سيتم استخدام رقم الدفعة والمدينة المحددين أعلاه لجميع السجلات في الملف.</li>
              <li>إذا كان رقم البطاقة موجوداً مسبقاً في جدول الحقيقة، فسيتم تحديث بياناته.</li>
              <li>هذا الجدول هو المرجع الأساسي لتحديد الدفعة والمدينة عند ترقيم البطاقات الجديدة.</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
