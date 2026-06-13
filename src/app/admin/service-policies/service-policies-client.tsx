"use client";

import React, { useState } from "react";
import { Plus, Edit2, Trash2, CheckCircle2, ShieldAlert } from "lucide-react";
import { Card, Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { deleteServicePolicy } from "@/app/actions/service-policies";
import { ServicePolicyModal } from "./service-policy-modal";

interface ServicePoliciesClientProps {
  initialPolicies: any[];
  serviceTypes: any[];
  companies: any[];
}

export function ServicePoliciesClient({
  initialPolicies,
  serviceTypes,
  companies,
}: ServicePoliciesClientProps) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filterServiceId, setFilterServiceId] = useState("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<any | null>(null);

  const filteredPolicies = initialPolicies.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch = 
      p.company.name.toLowerCase().includes(q) ||
      p.company.code.toLowerCase().includes(q) ||
      p.service_type.name.toLowerCase().includes(q);
      
    const matchesService = filterServiceId === "ALL" || p.service_type.id === filterServiceId;
    
    return matchesSearch && matchesService;
  });

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه السياسة؟ قد يؤثر ذلك على الحركات المستقبلية.")) return;
    
    const res = await deleteServicePolicy(id);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("تم حذف السياسة بنجاح");
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">إدارة سياسات الخدمات</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            تحديد سقوف ونسب التغطية للشركات عبر خدمات مختلفة (أسنان، بصريات، إلخ).
          </p>
        </div>
        <Button
          onClick={() => {
            setSelectedPolicy(null);
            setModalOpen(true);
          }}
          className="bg-teal-600 hover:bg-teal-700 text-white font-bold"
        >
          <Plus className="ml-2 h-4 w-4" />
          إضافة سياسة جديدة
        </Button>
      </div>

      <div className="flex w-full max-w-xl gap-3">
        <div className="flex-1">
          <Input
            placeholder="ابحث باسم الشركة أو الخدمة..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11"
          />
        </div>
        <select
          className="h-11 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 min-w-[150px]"
          value={filterServiceId}
          onChange={(e) => setFilterServiceId(e.target.value)}
        >
          <option value="ALL">جميع الخدمات</option>
          {serviceTypes.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">الشركة</th>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">الخدمة</th>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">السقف (د.ل)</th>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">التغطية (%)</th>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">الاستحقاق</th>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">الحالة</th>
                <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900">
              {filteredPolicies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500 font-bold">
                    لا توجد سياسات مضافة.
                  </td>
                </tr>
              ) : (
                filteredPolicies.map((policy) => (
                  <tr key={policy.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="px-5 py-3.5">
                      <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {policy.company.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{policy.company.code}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-black text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {policy.service_type.name}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-center font-black text-sm">
                      {policy.ceiling_amount === null ? (
                        <span className="text-teal-600 dark:text-teal-400">مفتوح</span>
                      ) : (
                        Number(policy.ceiling_amount).toLocaleString("ar-LY")
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center font-black text-sm">
                      {Number(policy.coverage_percent)}%
                    </td>
                    <td className="px-5 py-3.5 text-center text-xs font-bold text-slate-600 dark:text-slate-400">
                      {policy.frequency_months === null ? "غير محدد" : `كل ${policy.frequency_months} شهر`}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {policy.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> فعال
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          <ShieldAlert className="w-3 h-3" /> معطل
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedPolicy(policy);
                            setModalOpen(true);
                          }}
                          className="p-1.5 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                          title="تعديل"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(policy.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ServicePolicyModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        companies={companies}
        serviceTypes={serviceTypes}
        initialData={selectedPolicy}
      />
    </div>
  );
}
