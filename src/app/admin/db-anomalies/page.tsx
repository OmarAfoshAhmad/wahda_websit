import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";
import prisma from "@/lib/prisma";
import { formatDateTripoli } from "@/lib/datetime";

type UnlinkedCorrectionRow = {
  id: string;
  beneficiary_id: string;
  facility_id: string;
  amount: number;
  created_at: Date;
  is_cancelled: boolean;
  beneficiary_name: string;
  card_number: string;
  facility_name: string;
};

type DuplicateImportRow = {
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  duplicate_count: number;
  total_import_amount: number;
  first_created_at: Date;
  last_created_at: Date;
};

type DuplicateMovementRow = {
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  type: string;
  amount: number;
  movement_day: Date;
  duplicate_count: number;
  first_created_at: Date;
  last_created_at: Date;
};

type ExperimentalNoPasswordFacilityRow = {
  id: string;
  name: string;
  username: string;
  must_change_password: boolean;
  created_at: Date;
  password_len: number;
};

type DeletedFacilityRow = {
  id: string;
  name: string;
  username: string;
  deleted_at: Date;
};

type AuthStateFacility = {
  id: string;
  name: string;
  username: string;
  deleted_at: Date | null;
  must_change_password: boolean;
  created_at: Date;
  password_hash: string;
};

type AuthStateRow = {
  id: string;
  name: string;
  username: string;
  deleted: boolean;
  must_change_password: boolean;
  hash_valid_bcrypt: boolean;
  last_login_at: Date | null;
  last_reset_at: Date | null;
  reset_no_login: boolean;
};

export const dynamic = "force-dynamic";

function Num({ value }: { value: number }) {
  return <span>{value.toLocaleString("ar-LY")}</span>;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">
        {title} ({count.toLocaleString("ar-LY")})
      </h2>
      {children}
    </section>
  );
}

export default async function DbAnomaliesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const [
    unlinkedCorrections,
    duplicateImports,
    duplicateMovements,
    invalidPasswordFacilities,
    deletedFacilities,
    mustChangePasswordCount,
    allFacilitiesForAuth,
    loginLogs,
    resetLogs,
  ] = await Promise.all([
    prisma.$queryRaw<UnlinkedCorrectionRow[]>`
      SELECT
        t.id,
        t.beneficiary_id,
        t.facility_id,
        t.amount::float8 AS amount,
        t.created_at,
        t.is_cancelled,
        b.name AS beneficiary_name,
        b.card_number,
        f.name AS facility_name
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      JOIN "Facility" f ON f.id = t.facility_id
      WHERE t.type = 'CANCELLATION'
        AND t.original_transaction_id IS NULL
      ORDER BY t.created_at DESC
      LIMIT 300
    `,

    prisma.$queryRaw<DuplicateImportRow[]>`
      SELECT
        t.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        COUNT(*)::int AS duplicate_count,
        SUM(t.amount)::float8 AS total_import_amount,
        MIN(t.created_at) AS first_created_at,
        MAX(t.created_at) AS last_created_at
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT'
        AND t.is_cancelled = false
      GROUP BY t.beneficiary_id, b.name, b.card_number
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, last_created_at DESC
      LIMIT 300
    `,

    prisma.$queryRaw<DuplicateMovementRow[]>`
      SELECT
        t.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        t.type,
        t.amount::float8 AS amount,
        (t.created_at AT TIME ZONE 'Africa/Tripoli')::date AS movement_day,
        COUNT(*)::int AS duplicate_count,
        MIN(t.created_at) AS first_created_at,
        MAX(t.created_at) AS last_created_at
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.is_cancelled = false
        AND t.type <> 'CANCELLATION'
      GROUP BY
        t.beneficiary_id,
        b.name,
        b.card_number,
        t.type,
        t.amount,
        (t.created_at AT TIME ZONE 'Africa/Tripoli')::date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, last_created_at DESC
      LIMIT 300
    `,

    prisma.$queryRaw<ExperimentalNoPasswordFacilityRow[]>`
      SELECT
        f.id,
        f.name,
        f.username,
        f.must_change_password,
        f.created_at,
        COALESCE(LENGTH(BTRIM(f.password_hash)), 0)::int AS password_len
      FROM "Facility" f
      WHERE f.deleted_at IS NULL
        AND (
          f.password_hash IS NULL
          OR BTRIM(f.password_hash) = ''
          OR f.password_hash !~ '^\\$2[aby]\\$.{56}$'
        )
      ORDER BY f.created_at DESC
      LIMIT 200
    `,

    prisma.$queryRaw<DeletedFacilityRow[]>`
      SELECT id, name, username, deleted_at
      FROM "Facility"
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT 200
    `,

    prisma.facility.count({
      where: {
        deleted_at: null,
        must_change_password: true,
      },
    }),

    prisma.facility.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        deleted_at: true,
        must_change_password: true,
        created_at: true,
        password_hash: true,
      },
      orderBy: { created_at: "desc" },
    }),

    prisma.auditLog.findMany({
      where: { action: "LOGIN" },
      select: { facility_id: true, user: true, created_at: true },
      orderBy: { created_at: "desc" },
      take: 50_000,
    }),

    prisma.auditLog.findMany({
      where: { action: "UPDATE_FACILITY" },
      select: { metadata: true, created_at: true, user: true },
      orderBy: { created_at: "desc" },
      take: 50_000,
    }),
  ]);

  const lastLoginByFacilityId = new Map<string, Date>();
  const lastLoginByUsername = new Map<string, Date>();
  for (const log of loginLogs) {
    if (log.facility_id && !lastLoginByFacilityId.has(log.facility_id)) {
      lastLoginByFacilityId.set(log.facility_id, log.created_at);
    }
    if (log.user && !lastLoginByUsername.has(log.user)) {
      lastLoginByUsername.set(log.user, log.created_at);
    }
  }

  const lastResetByFacilityId = new Map<string, Date>();
  for (const log of resetLogs) {
    const meta = log.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    const facilityId = typeof meta.facility_id === "string" ? meta.facility_id : null;
    const resetPassword = meta.reset_password === true;
    if (facilityId && resetPassword && !lastResetByFacilityId.has(facilityId)) {
      lastResetByFacilityId.set(facilityId, log.created_at);
    }
  }

  const authStateRows: AuthStateRow[] = (allFacilitiesForAuth as AuthStateFacility[])
    .map((f) => {
      const hash = f.password_hash ?? "";
      const hashValidBcrypt = /^\$2[aby]\$.{56}$/.test(hash);
      const lastLogin = lastLoginByFacilityId.get(f.id) ?? lastLoginByUsername.get(f.username) ?? null;
      const lastReset = lastResetByFacilityId.get(f.id) ?? null;
      const resetNoLogin = Boolean(lastReset && (!lastLogin || lastLogin < lastReset));

      return {
        id: f.id,
        name: f.name,
        username: f.username,
        deleted: Boolean(f.deleted_at),
        must_change_password: f.must_change_password,
        hash_valid_bcrypt: hashValidBcrypt,
        last_login_at: lastLogin,
        last_reset_at: lastReset,
        reset_no_login: resetNoLogin,
      };
    })
    .filter((row) => row.deleted || !row.hash_valid_bcrypt || row.must_change_password || row.reset_no_login || !row.last_login_at);

  const authStateSummary = {
    active_no_hash_problem: authStateRows.filter((row) => !row.deleted && !row.hash_valid_bcrypt).length,
    deleted: authStateRows.filter((row) => row.deleted).length,
    must_change_password: authStateRows.filter((row) => !row.deleted && row.must_change_password).length,
    reset_no_login: authStateRows.filter((row) => !row.deleted && row.reset_no_login).length,
    never_logged_in: authStateRows.filter((row) => !row.deleted && !row.last_login_at).length,
  };

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4 pb-16">
        <header className="space-y-1">
          <h1 className="text-2xl font-black">تشوهات قاعدة البيانات (تجريبي)</h1>
          <p className="text-sm text-slate-600">
            صفحة تشخيصية تجريبية بدون تنسيق نهائي. تعرض عينات مباشرة من قاعدة البيانات.
          </p>
          <p className="text-sm text-amber-700">
            ملاحظة: عدد المرافق التي يجب عليها تغيير كلمة المرور بعد إعادة التعيين = {mustChangePasswordCount.toLocaleString("ar-LY")}.
          </p>
          <p className="text-sm text-slate-700">
            ملخص جذري للدخول: hash غير صالح (نشط) = {authStateSummary.active_no_hash_problem.toLocaleString("ar-LY")}
            {" | "}
            محذوف = {authStateSummary.deleted.toLocaleString("ar-LY")}
            {" | "}
            must_change_password = {authStateSummary.must_change_password.toLocaleString("ar-LY")}
            {" | "}
            إعادة تعيين بدون دخول بعدها = {authStateSummary.reset_no_login.toLocaleString("ar-LY")}
            {" | "}
            لم يسجل دخول إطلاقا = {authStateSummary.never_logged_in.toLocaleString("ar-LY")}
          </p>
        </header>

        <Section title="تشخيص الدخول للمرافق (كل الحالات المشبوهة)" count={authStateRows.length}>
          <p className="text-xs text-slate-500">
            هذه القائمة تشمل حتى المرافق غير الظاهرة في صفحات الإدارة العادية (مثل المحذوفة).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right">
                  <th className="p-2">الاسم</th>
                  <th className="p-2">username</th>
                  <th className="p-2">محذوف</th>
                  <th className="p-2">must_change_password</th>
                  <th className="p-2">hash bcrypt صالح</th>
                  <th className="p-2">آخر دخول</th>
                  <th className="p-2">آخر إعادة تعيين</th>
                  <th className="p-2">إعادة تعيين بدون دخول</th>
                  <th className="p-2">id</th>
                </tr>
              </thead>
              <tbody>
                {authStateRows.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.username}</td>
                    <td className="p-2">{row.deleted ? "نعم" : "لا"}</td>
                    <td className="p-2">{row.must_change_password ? "نعم" : "لا"}</td>
                    <td className="p-2">{row.hash_valid_bcrypt ? "نعم" : "لا"}</td>
                    <td className="p-2">{row.last_login_at ? formatDateTripoli(row.last_login_at, "en-GB") : "—"}</td>
                    <td className="p-2">{row.last_reset_at ? formatDateTripoli(row.last_reset_at, "en-GB") : "—"}</td>
                    <td className="p-2">{row.reset_no_login ? "نعم" : "لا"}</td>
                    <td className="p-2 font-mono text-xs">{row.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="حركات مصححة غير مرتبطة" count={unlinkedCorrections.length}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">المرفق</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2">id</th>
                </tr>
              </thead>
              <tbody>
                {unlinkedCorrections.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">{row.beneficiary_name}</td>
                    <td className="p-2">{row.card_number}</td>
                    <td className="p-2">{row.facility_name}</td>
                    <td className="p-2"><Num value={row.amount} /></td>
                    <td className="p-2">{formatDateTripoli(row.created_at, "en-GB")}</td>
                    <td className="p-2">{row.is_cancelled ? "ملغاة" : "فعالة"}</td>
                    <td className="p-2 font-mono text-xs">{row.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="تكرارات حركات الاستيراد" count={duplicateImports.length}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">عدد IMPORT</th>
                  <th className="p-2">إجمالي IMPORT</th>
                  <th className="p-2">أول تاريخ</th>
                  <th className="p-2">آخر تاريخ</th>
                </tr>
              </thead>
              <tbody>
                {duplicateImports.map((row) => (
                  <tr key={`${row.beneficiary_id}-${row.last_created_at.toISOString()}`} className="border-b">
                    <td className="p-2">{row.beneficiary_name}</td>
                    <td className="p-2">{row.card_number}</td>
                    <td className="p-2"><Num value={row.duplicate_count} /></td>
                    <td className="p-2"><Num value={row.total_import_amount} /></td>
                    <td className="p-2">{formatDateTripoli(row.first_created_at, "en-GB")}</td>
                    <td className="p-2">{formatDateTripoli(row.last_created_at, "en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="تكرارات الحركات للمستفيدين" count={duplicateMovements.length}>
          <p className="text-xs text-slate-500">
            معيار التكرار هنا: نفس المستفيد + نفس النوع + نفس القيمة + نفس يوم الحركة (بتوقيت طرابلس).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">النوع</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">اليوم</th>
                  <th className="p-2">عدد التكرار</th>
                  <th className="p-2">آخر تاريخ</th>
                </tr>
              </thead>
              <tbody>
                {duplicateMovements.map((row) => (
                  <tr
                    key={`${row.beneficiary_id}-${row.type}-${row.amount}-${row.movement_day.toISOString()}`}
                    className="border-b"
                  >
                    <td className="p-2">{row.beneficiary_name}</td>
                    <td className="p-2">{row.card_number}</td>
                    <td className="p-2">{row.type}</td>
                    <td className="p-2"><Num value={row.amount} /></td>
                    <td className="p-2">{formatDateTripoli(row.movement_day, "en-GB")}</td>
                    <td className="p-2"><Num value={row.duplicate_count} /></td>
                    <td className="p-2">{formatDateTripoli(row.last_created_at, "en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="مرافق فعالة بكلمة مرور غير صالحة" count={invalidPasswordFacilities.length}>
          <p className="text-xs text-slate-500">
            هذه حالات قد تفشل تسجيل الدخول بسبب hash غير صالح في قاعدة البيانات.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right">
                  <th className="p-2">الاسم</th>
                  <th className="p-2">username</th>
                  <th className="p-2">طول hash</th>
                  <th className="p-2">must_change_password</th>
                  <th className="p-2">تاريخ الإنشاء</th>
                  <th className="p-2">id</th>
                </tr>
              </thead>
              <tbody>
                {invalidPasswordFacilities.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.username}</td>
                    <td className="p-2"><Num value={row.password_len} /></td>
                    <td className="p-2">{row.must_change_password ? "نعم" : "لا"}</td>
                    <td className="p-2">{formatDateTripoli(row.created_at, "en-GB")}</td>
                    <td className="p-2 font-mono text-xs">{row.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="مرافق محذوفة (لا يمكنها تسجيل الدخول)" count={deletedFacilities.length}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right">
                  <th className="p-2">الاسم</th>
                  <th className="p-2">username</th>
                  <th className="p-2">تاريخ الحذف</th>
                  <th className="p-2">id</th>
                </tr>
              </thead>
              <tbody>
                {deletedFacilities.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.username}</td>
                    <td className="p-2">{formatDateTripoli(row.deleted_at, "en-GB")}</td>
                    <td className="p-2 font-mono text-xs">{row.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </Shell>
  );
}
