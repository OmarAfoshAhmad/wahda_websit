# تقرير المرحلة صفر: منظومة الشركات متعددة الخدمات

تاريخ الجرد: 2026-07-16. هذا التقرير ناتج عن فحص ساكن فقط؛ لم تُشغّل migrations، ولم يحدث اتصال بأي قاعدة بيانات، ولم تُعدّل بيانات تشغيلية.

## 1. Git وحماية تغييرات المستخدم

- الفرع الأصلي: `main` عند commit `8a99b4e`.
- فرع العمل المنشأ: `codex/multi-company-phase-0`.
- محفوظ دون تعديل: حذف `حركات الشركات للعلاج الطبيعي - مصححة ومهيكلة/JMR_Transactions_PT - Copy.xlsx`.
- محفوظ دون تعديل: الملف غير المتتبع `حركات الشركات للعلاج الطبيعي - مصححة ومهيكلة/ملحق وحدة.xlsx`.
- لم يُحذف أو يُنقل أي Excel أو backup أو ملف غير متتبع.

## 2. خريطة مخطط البيانات المرتبط بالشركة

| الكيان | علاقة الشركة الحالية | الملاحظة الأمنية |
|---|---|---|
| `InsuranceCompany` | الكيان الجذر | يملك المستفيدين والحركات والمطالبات والسياسات والمحافظ والخرائط |
| `Beneficiary` | `company_id` اختياري | يسمح بسجلات بلا نطاق؛ لا يوجد قيد اتساق مع الحركة/المطالبة |
| `Transaction` | `company_id` اختياري | حقل مالي حساس بلا إلزام؛ `idempotency_key` فريد عالميًا لا يضم نطاق الشركة بنيويًا |
| `Claim` | `company_id` اختياري | المطالبة قد تكون بلا شركة رغم إلزام الشركة في المحفظة والسياسة |
| `WalletConsumption` | `company_id` إلزامي | قيد مركب جيد: المستفيد + الشركة + نوع المحفظة + السنة |
| `ServicePolicy` | `company_id` إلزامي | فريد لكل شركة ونوع خدمة |
| `ServiceTypeMapping` | `company_id` إلزامي | فريد لكل شركة والقيمة القديمة للخدمة |
| `Facility` | لا علاقة شركة | الدور نص مع أعلام قديمة متداخلة؛ لا يمكن إثبات نطاق الشركات |
| `AuditLog` | لا يوجد `company_id` | لا يمكن عزل التتبع أو التصدير حسب الشركة |
| `ImportJob` / `RestoreJob` | لا يوجد عمود شركة | قد يوجد نطاق داخل JSON فقط، وهو غير كافٍ للفهرسة والتفويض |
| `ClaimAuditLog` | لا توجد relation ولا شركة | يعتمد على `claim_id` كنص دون مفتاح أجنبي في Prisma |

المصادر المتنافسة للخدمة موجودة فعلًا: `Transaction.type` و`service_category` و`service_type_id`، إضافة إلى JSON في الشركة و`ServiceType` و`ServicePolicy` و`ServiceTypeMapping`.

## 3. خريطة نقاط القراءة والكتابة ذات نطاق الشركة

### Server Actions

- الحسابات والشركات: `facility.ts`, `manager.ts`, `company.ts`, `service-policies.ts`.
- المستفيدون والبحث والدمج: `beneficiary/{search,crud,bulk,merge,utils}.ts`, `beneficiary.ts`, `legacy-cards.ts`, `truth-registry*.ts`.
- الحركات والمال والتراجع: `transaction.ts`, `deduction.ts`, `cancel-transaction.ts`, `restore-transaction.ts`, `cash-claim.ts`, `balance-health-actions.ts`.
- الخدمات: `dental.ts`, `optics.ts`, `physiotherapy.ts`، وملفات الاستيراد الثلاثة المقابلة.
- الصيانة/العمليات الجماعية: `data-hygiene/**`, `card-numbering.ts`, `maintenance-jobs.ts`, `import.ts`.

### API Routes

- صادرات حساسة: `export/{beneficiaries,transactions,import-beneficiaries,import-report,audit-log}.route`، و`dental-export`, `optics-export`, `physiotherapy-export`, `dental-beneficiaries-export`, `tpa-export`.
- استيراد وتراجع: `import-jobs/**`, `import-transactions/**`, و`beneficiaries/bulk-audit-rollback/**`.
- قراءة مستفيد/حركات: `beneficiaries/[id]/transactions`, ومسارات بوابة المستفيد.
- إدارة/تشخيص: `admin/duplicates/**`, `admin/truth-registry/export`, و`debug-dental`.

الخطر المشترك: عدد من المسارات يقبل `company_id` من form/query ويستخدم فحص admin/permission عام، لكن لا توجد طبقة مركزية تثبت أن الشركة ضمن نطاق الحساب؛ لذلك لا يكفي تعداد الملفات وحده لإثبات العزل.

## 4. المعرف الثابت

المعرف `cmp7ha2km0000u9v8jse4ib5x` موجود في كود التشغيل في 10 مواضع/ملفات:

- `src/lib/constants.ts`
- `src/app/dashboard/page.tsx`
- `src/app/beneficiaries/page.tsx`
- `src/app/transactions/page.tsx`
- `src/app/actions/beneficiary/search.ts`
- `src/app/api/export/beneficiaries/route.ts`
- `src/app/api/export/transactions/route.ts`
- `src/app/api/tpa-export/route.ts`
- `src/app/api/admin/truth-registry/export/route.ts` (عبر الثابت)
- `src/app/actions/truth-registry.ts` (عبر الثابت)

كما يوجد في سكربتات/ملفات تشخيصية غير تشغيلية: `check-canonical-duplicates.js`, `check-general-count.js`, `scratch/list-companies.js`, و`output.txt`.

## 5. مقارنة الميزات مع المشروع المرجعي

| الميزة | الحالة في المستهدف | الدليل/الفجوة |
|---|---|---|
| الأدوار وهرم الحسابات | جزئي | catalog وصلاحيات موجودة؛ المرجع يضيف enum وعلاقات المنشئ/المدير، ولا المشروعين يملكان many-to-many للشركات |
| تعديل/عرض حسابات الإدارة | جزئي | manager/facility موجودان؛ عزل الشركة غير موجود |
| صلاحيات المرافق والمنح الجماعي | جزئي | permission catalog وواجهة فردية موجودان؛ `facility-bulk-permissions` موجود في المرجع ومفقود هنا |
| الحركة اليدوية/القديمة/باسم مرفق | جزئي | مفاتيح صلاحيات ومنطق موجود؛ لا تحقق نطاق شركة مركزي |
| Audit على العملية والصف/XLSX/تراجع وإعادة | جزئي | سجل وتصدير وتراجعات متعددة موجودة؛ لا `company_id`، ومسار history المرجعي مفقود |
| Cash Claim استيراد وتراجع | جزئي | نموذج/Action موجودان؛ bulk import وrollback المخصص الموجودان في المرجع مفقودان |
| فلتر Cash Claim | جزئي | الصفحة موجودة؛ يلزم اختبار الفلتر والنطاق بعد طبقة الشركات |
| المحذوفات والاستعادة | موجود جزئيًا | soft delete وrestore/recycle موجودة؛ توجد deleteMany حساسة وتحتاج preview/audit موحدًا |
| البحث المطبع عربي/إنجليزي/بطاقات | جزئي | `search.ts` موجود، لكن اختبارات normalization المرجعية مفقودة وبعض SQL مثبت على شركة واحدة |
| الرقم الوظيفي ولاحقات الأسرة | جزئي | منطق family/base card منتشر؛ لا مصدر مركزي مثبت باختبارات قبول كاملة |
| أحدث حركة أولًا | موجود في مواضع | يحتاج تدقيق شامل لكل الخدمات والصادرات |
| البطاقات القديمة ودمج الحركات | موجود جزئيًا | أدوات legacy وmerge موجودة؛ التنفيذ يختلف عن المرجع ويحتاج مقارنة سلوكية |
| Maintenance jobs | جزئي | Actions ومؤشرات تقدم موجودة، لكن نموذج `MaintenanceJob` غير موجود في schema الحالي |
| الذرية وقفل المحافظ | جزئي قوي | wallet engine يستخدم SQL/transactions وتحديثًا ذريًا؛ يلزم فرض اتساق الشركة بكل callers |
| idempotency ضمن الشركة | مفقود | المفاتيح فريدة عالميًا دون قيد مركب أو منشئ مركزي يضمن إدخال الشركة |
| preflight | جزئي/وثائقي | وثائق وسكربتات نشر موجودة؛ لا بوابة موحدة مثبتة للنسخة المرشحة |
| Rate limiting في PostgreSQL | مفقود | المستهدف يستخدم memory store؛ المرجع لديه `RateLimitBucket` |
| عزل integration tests | كان مفقودًا | أضيفت بوابة `test:integration` التي ترفض اسم قاعدة غير اختباري |
| فريدة البطاقات النشطة والاستعادة | موجود جزئيًا | migrations لقيود البطاقات موجودة؛ يجب اختبار مسار restore ضدها |
| Tajawal والتجاوب | موجود جزئيًا | يلزم تدقيق بصري لاحق؛ ليس أساسًا لإثبات العزل |
| الخدمات الثلاث | موجودة في المستهدف فقط | ميزة يجب الحفاظ عليها؛ المرجع ليس مصدرًا مباشرًا لمنطق dental/optics/physiotherapy |

## 6. تصميم migration المرحلة الأولى (مقترح فقط)

Migration A توسعية:

1. إنشاء enum جديد `AccountRoleV2` بالقيم `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER`, `EMPLOYEE`, `FACILITY` من دون تحويل العمود القديم فورًا.
2. إضافة `role_v2 AccountRoleV2 NULL` إلى `Facility`.
3. إنشاء `AccountCompanyAccess(id, account_id, company_id, created_by_id NULL, permissions JSONB NULL, created_at, updated_at)` مع مفاتيح أجنبية وفريد `(account_id, company_id)` وفهارس على الشركة/الحساب.
4. إضافة `company_id NULL` إلى `AuditLog`, `ImportJob`, `RestoreJob`، وإلى أي MaintenanceJob سيُعتمد، مع FK وفهارس زمنية مركبة.
5. عدم تغيير nullable في `Beneficiary`, `Transaction`, `Claim` الآن.

Backfill منفصل dry-run أولًا:

- اشتقاق `role_v2` من الدور النصي والأعلام القديمة، وإصدار تقرير للتعارضات بدل الحسم الآلي.
- اقتراح وصول الشركات للحسابات من الحركات/المرافق والبيانات المعروفة، مع تصنيف `safe`, `ambiguous`, `unresolved`.
- اقتراح شركة Audit/Import/Restore من الكيانات الموجودة داخل metadata/payload فقط عند تطابق وحيد قابل للإثبات.
- تقارير null/mismatch للحركات والمستفيدين والمطالبات والمحافظ.

Migration B لاحقة بعد الاعتماد: backfill معتمد ثم checks/NOT NULL وقيود الاتساق على مراحل، وليس ضمن المرحلة التالية مباشرة.

## 7. الاختبارات ومخاطر قاعدة البيانات

- لا توجد قاعدة integration مستقلة معرفة في المشروع ولا script مخصص سابقًا.
- الاختبار ذو اللاحقة `-db.test.ts` mock بالكامل ولا يتصل بقاعدة.
- أضيف `scripts/assert-test-database.js` و`npm run test:integration`; التشغيل يرفض URL مفقودًا أو غير PostgreSQL أو اسم قاعدة لا يحتوي marker مستقل `test/testing`.
- baseline الحالي لـ `npm test`: نجح 60 من 69 اختبارًا، وفشلت 9 اختبارات في 4 ملفات. الفشل موزع على `permission-catalog` (3)، `cancel-transaction` (4)، `deduction` (1)، و`deduct-form` (1). هذه إخفاقات موجودة في كود/توقعات المشروع الحالية وليست ناتجة عن حاجز قاعدة الاختبار المستقل.
- فشل الصلاحيات مهم أمنيًا: الاختبارات تتوقع قفل `manage_users` للموظف/المرفق لكن التنفيذ يسمح به. فشل الإلغاء يوحي بعدم توافق mocks/جلسة التفويض أو العقد الراجع، ويجب حسمه قبل اعتماد اختبارات العزل المالي.
- لم تُشغّل baseline counts لأن `.env` لم تُثبت كنسخة اختبار/نسخة مستعادة آمنة، ولأن الاتصال بها قد يخالف منع الإنتاج. الأعداد المطلوبة: الشركات، المستفيدون الكلي/بلا شركة، الحركات الكلي/بلا شركة/عدم التطابق، المطالبات الكلي/بلا شركة/عدم التطابق، والمحافظ غير المتطابقة. تُشغل لاحقًا read-only بعد توفير URL لنسخة آمنة.
- توجد عمليات `deleteMany` كثيرة في Actions وسكربتات الصيانة؛ يلزم منعها خلف preview/export/audit قبل أي تشغيل جماعي.
- migrations الحالية تحتوي استعمالات `SET NOT NULL` قديمة؛ لا توجد نتيجة فحص تشير إلى `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, أو `DELETE FROM` في migrations الموجودة، لكن يجب مراجعة السطرين قبل أي إعادة تشغيل على نسخة مستعادة.

## 8. الملفات الكبيرة والأسرار

- ملفات `.env` الفعلية غير متتبعة، بينما الأمثلة و`.env.build` فقط ضمن Git. لم تُطبع أي قيمة سرية.
- يوجد ملف Git متتبع أكبر من 5 MiB: `exports/wcard_beneficiaries_organized_db_enriched.xlsx` بحجم يقارب 10.51 MiB.
- المستودع يحتوي عددًا كبيرًا من Excel/PDF/JPG/WBK/RAR وسكربتات تشغيلية. لم يُحذف شيء. يوصى بتقرير تصنيف مستقل، فحص أسرار بأداة مخصصة، ثم قواعد `.gitignore` دقيقة لا تخفي بيانات لازمة دون قرار.

## 9. خطة ملفات المرحلة الأولى

- `prisma/schema.prisma`: enum انتقالي، `AccountCompanyAccess`، وأعمدة الشركة الاختيارية.
- `prisma/migrations/<timestamp>_expand_account_company_scope/migration.sql`: SQL توسعي فقط.
- `scripts/audit-account-company-backfill.ts`: dry-run وتقارير التعارض، بلا كتابة افتراضيًا.
- `src/lib/company-scope.ts`: `getAllowedCompanyIds` و`requireCompanyAccess` و`buildCompanyScope` بعد اعتماد المخطط.
- `src/lib/session-guard.ts`, `src/lib/auth.ts`, `src/lib/permissions.ts`: توحيد جلسة الدور والنطاق مع التوافق القديم.
- اختبارات جديدة لـ role mapping وcompany scope ورفض cross-company، مع قاعدة integration مستقلة فقط.

لا يبدأ تنفيذ migration أو backfill قبل موافقة المستخدم على هذا التصميم.
