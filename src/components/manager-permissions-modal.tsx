"use client";

import { useMemo, useState, useTransition } from "react";
import { Settings2, X } from "lucide-react";
import { updateManagerPermissions } from "@/app/actions/manager";
import { Button } from "@/components/ui";
import type { ManagerPermissions, UserRole } from "@/lib/permissions";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  getLockedPermissionKeysForRole,
  getPermissionPresetsForRole,
  getPermissionPreset,
  normalizeManagerPermissionsForRole,
} from "@/lib/permission-catalog";

interface Props {
  managerId: string;
  managerName: string;
  permissions: ManagerPermissions;
  accountRole?: UserRole | "FACILITY";
}

export function ManagerPermissionsModal({
  managerId,
  managerName,
  permissions,
  accountRole,
}: Props) {
  const policyRole = accountRole ?? "MANAGER";
  const lockedKeys = useMemo(
    () => new Set(getLockedPermissionKeysForRole(policyRole)),
    [policyRole],
  );
  const presets = useMemo(
    () => getPermissionPresetsForRole(policyRole),
    [policyRole],
  );

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ManagerPermissions>(
    normalizeManagerPermissionsForRole(policyRole, permissions),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const roleLabel = ROLE_LABELS[policyRole] ?? null;

  const toggle = (key: keyof ManagerPermissions) => {
    if (lockedKeys.has(key)) return;
    setCurrent((prev) => ({ ...prev, [key]: !prev[key] }));
    setSuccess(false);
    setError(null);
  };

  const applyPreset = (presetId: (typeof presets)[number]["id"]) => {
    setCurrent(getPermissionPreset(presetId, policyRole));
    setSuccess(false);
    setError(null);
  };

  const handleSave = () => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await updateManagerPermissions(managerId, current);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => setOpen(false), 700);
      }
    });
  };

  return (
    <>
      <button
        onClick={() => {
          setCurrent(normalizeManagerPermissionsForRole(policyRole, permissions));
          setError(null);
          setSuccess(false);
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-primary"
        title="ضبط الصلاحيات"
      >
        <Settings2 className="h-3.5 w-3.5" />
        الصلاحيات
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] shadow-2xl overflow-hidden max-h-[90vh]">
            {/* رأس الـ modal */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-4 bg-slate-50/50 dark:bg-slate-800/30 sm:px-6 sm:py-5">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">إدارة الصلاحيات</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">{managerName}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-600 transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* قائمة الصلاحيات — مع تمرير في حال كثرت */}
            <div className="px-4 py-4 max-h-[58vh] overflow-y-auto space-y-1.5 custom-scrollbar sm:px-5">
              <div className="mb-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 p-3">
                <p className="mb-2 text-[11px] font-black text-slate-500 dark:text-slate-400">
                  قوالب جاهزة لتسريع منح الصلاحيات
                  {roleLabel ? ` (${roleLabel})` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.id)}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {lockedKeys.size > 0 && (
                  <p className="mt-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    الصلاحيات المقفلة تلقائياً لهذا الدور: {lockedKeys.size}
                  </p>
                )}
              </div>

              {PERMISSION_GROUPS.map((group) => (
                <div key={group.groupId} className="mb-3">
                  <h3 className="mb-2 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {group.groupLabel}
                  </h3>

                  <div className="space-y-1.5">
                    {group.keys.map((key) => (
                      (() => {
                        const isLocked = lockedKeys.has(key);
                        return (
                          <div
                            key={key}
                            className={`flex items-center justify-between gap-3 rounded-xl border border-transparent dark:border-slate-800/40 px-4 py-3 transition-all group ${isLocked
                              ? "bg-slate-100/70 dark:bg-slate-800/40 cursor-not-allowed opacity-75"
                              : "bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 cursor-pointer"
                              }`}
                            onClick={() => toggle(key)}
                          >
                            <span className={`text-[13px] font-bold select-none ${isLocked
                              ? "text-slate-400 dark:text-slate-500"
                              : "text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white"
                              }`}>
                              {PERMISSION_LABELS[key]}
                              {isLocked ? " (مقفل)" : ""}
                            </span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={current[key]}
                              disabled={isLocked}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all duration-300 focus:outline-none ${isLocked
                                ? "bg-slate-300/70 dark:bg-slate-700/80 cursor-not-allowed"
                                : current[key]
                                  ? "bg-blue-600 dark:bg-blue-500 cursor-pointer"
                                  : "bg-slate-300 dark:bg-slate-700 cursor-pointer"
                                }`}
                            >
                              <span
                                className={`absolute h-4.5 w-4.5 rounded-full bg-white shadow-md transition-transform duration-300 right-1 ${current[key] ? "-translate-x-5.5" : "translate-x-0"
                                  }`}
                              />
                            </button>
                          </div>
                        );
                      })()
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* رسائل */}
            {error && (
              <div className="mx-5 mb-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
            {success && (
              <div className="mx-5 mb-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                تم حفظ الصلاحيات ✓
              </div>
            )}

            {/* زرار الحفظ */}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 dark:border-slate-800 px-4 py-4 sm:flex-row sm:px-5">
              <Button onClick={handleSave} disabled={isPending} className="w-full sm:flex-1">
                {isPending ? "جارٍ الحفظ..." : "حفظ الصلاحيات"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="w-full sm:flex-1"
              >
                إلغاء
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
