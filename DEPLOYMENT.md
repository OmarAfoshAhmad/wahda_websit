# دليل النشر - Wahda Healthcare System

## معلومات السيرفر

- **السيرفر**: dev-waadapp-ly
- **الدومين**: alwaha-care.ly
- **مسار المشروع**: `/opt/wahda_websit/alwaha-care`
- **الريبو**: `https://github.com/OmarAfoshAhmad/wahda_websit.git` (branch: `main`)

## Docker

### الحاويات

| الحاوية            | الدور                  | الشبكة                |
| ------------------ | ---------------------- | --------------------- |
| `wahda_app`        | Next.js (هذا التطبيق)  | `waadapp_tba_network` |
| `wahda_redis`      | Redis 7 (cache/pubsub) | `waadapp_tba_network` |
| `waadapp-db`       | PostgreSQL 16          | `waadapp_tba_network` |
| `waadapp-frontend` | تطبيق آخر (TBA)        | `waadapp_tba_network` |
| `waadapp-backend`  | تطبيق آخر (TBA)        | `waadapp_tba_network` |

### الشبكات

- `waadapp_tba_network` — الشبكة المشتركة (external) التي يجب أن يكون `wahda_app` عليها
- `alwaha-care_default` — شبكة افتراضية لـ compose (لا تُستخدم)

### ملف docker-compose.prod.yml

- يجب أن يحتوي على `networks: waadapp_tba_network` مع `external: true`
- البورت: `3101:3000`
- خدمة `app` يجب أن تستخدم: `image: ${APP_IMAGE:-wahda_web:latest}` لدعم rollback السريع

## قاعدة البيانات

- **الحاوية**: `waadapp-db`
- **اسم القاعدة**: `wahda_websit`
- **المستخدم**: `wahda_user`
- **كلمة المرور**: محفوظة في `.env.production` على السيرفر فقط
- **ملاحظة**: يوجد قاعدة أخرى `tba_waad_system` — ليست لنا!

## ملف .env.production (على السيرفر فقط)

```
APP_HOST_PORT=3101
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://wahda_user:<PASSWORD>@waadapp-db:5432/wahda_websit?schema=public
JWT_SECRET=<SECRET_1>
BACKUP_ENCRYPTION_KEY=<SECRET_2>
BENEFICIARY_TOKEN_SECRET=<SECRET_3>
REDIS_PASSWORD=<STRONG_RANDOM_PASSWORD>
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=<ADMIN_PASSWORD>
DEFAULT_ADMIN_NAME=System Admin
```

> **ملاحظة**: `REDIS_URL` يُبنى تلقائياً في `docker-compose.prod.yml` من `REDIS_PASSWORD`.
> **مهم**: `JWT_SECRET` و `BACKUP_ENCRYPTION_KEY` و `BENEFICIARY_TOKEN_SECRET` يجب أن تكون **مختلفة عن بعضها**.

## Redis — إعدادات مهمة

- **الحاوية**: `wahda_redis` (redis:7-alpine)
- **الشبكة**: `waadapp_tba_network`
- يستخدم كلمة مرور عبر `--requirepass` (من متغير `REDIS_PASSWORD`)
- حد الذاكرة: 128MB مع سياسة `allkeys-lru`
- بيانات محفوظة في volume `redis_data`
- Redis **اختياري** — التطبيق يعمل بدونه (fallback للذاكرة المحلية)
- عند توفره: يُمكّن مشاركة rate-limit وإشعارات SSE بين عدة instances

## Prisma — إعدادات مهمة

- **binaryTargets**: يجب أن يكون `["native", "debian-openssl-3.0.x"]` في `schema.prisma`
  - السيرفر يستخدم `debian-openssl-3.0.x` (bookworm)
  - بدون هذا الإعداد يظهر خطأ: `PrismaClientInitializationError: could not locate Query Engine`

## Dockerfile — إعدادات مهمة

- يجب تثبيت `openssl` في مرحلة runner: `apt-get install -y openssl`
- يجب `chown -R node:node /app` قبل `USER node` (Prisma يحتاج صلاحيات كتابة)
- migration لم تعد تعمل تلقائياً عند startup إلا إذا فعّلت `RUN_DB_MIGRATIONS_ON_BOOT=true`

## خطوات رفع تحديث

> **⚠️ تحذير حاسم**: لا تمسح البيانات الفعلية الموجودة في قاعدة البيانات مهما كان السبب.
> لا تستخدم `prisma migrate reset` أو `prisma db push --force-reset` على الإنتاج أبداً.
> المايقريشن فقط عبر `prisma migrate deploy` الذي يطبّق المايقريشنات الجديدة دون مسح البيانات.

### الطريقة الموصى بها (Candidate ثم Promote)

```bash
# 1) على جهازك المحلي
git add -A
git commit -m "وصف التحديث"
git push origin main

# 2) على السيرفر
cd /opt/wahda_websit/alwaha-care
git pull origin main

# 3) بناء وتشغيل نسخة Candidate على منفذ منفصل (لا تؤثر على الإنتاج)
chmod +x infra/deploy-candidate.sh infra/promote-candidate.sh
./infra/deploy-candidate.sh

# 4) اختبر النسخة الجديدة عبر منفذ Candidate
# افتراضياً: http://<server-ip>:3102

# 5) بعد الموافقة فقط: Promote إلى الإنتاج مع rollback تلقائي عند الفشل
./infra/promote-candidate.sh

# اختياري: تسمية Release يدوياً
# ./infra/deploy-candidate.sh wahda_web:candidate-20260330-1
# ./infra/promote-candidate.sh wahda_web:candidate-20260330-1
```

### حواجز أمان migrations (مفعلة افتراضياً)

- يتم فحص migration SQL قبل التطبيق، وإذا وُجدت عبارات مدمّرة (`DROP/RENAME/ALTER TYPE/SET NOT NULL`) يتم إيقاف النشر افتراضياً
- قبل `prisma migrate deploy` يتم إنشاء backup للقاعدة تلقائياً داخل `./backups`
- يمكن التحكم بالسلوك عبر متغيرات البيئة التالية:

| المتغير                        | الافتراضي   | الوظيفة                           |
| ------------------------------ | ----------- | --------------------------------- |
| `CHECK_DESTRUCTIVE_MIGRATIONS` | `true`      | فحص migrations المدمّرة قبل النشر |
| `ALLOW_DESTRUCTIVE_MIGRATIONS` | `false`     | تجاوز الحظر بعد موافقة صريحة      |
| `RUN_DB_BACKUP`                | `true`      | إنشاء backup قبل تطبيق migrations |
| `BACKUP_DIR`                   | `./backups` | مسار حفظ النسخ الاحتياطية         |
| `BACKUP_PREFIX`                | `wahda_db`  | بادئة اسم ملف backup              |

مثال (فقط عند موافقة صريحة على migration غير متوافقة للخلف):

```bash
ALLOW_DESTRUCTIVE_MIGRATIONS=true ./infra/promote-candidate.sh
```

### ما الذي تفعله السكربتات الجديدة؟

- `deploy-candidate.sh` يبني الصورة الجديدة ويشغلها في حاوية مستقلة `wahda_app_candidate` على منفذ منفصل
- النسخة الحالية `wahda_app` تبقى تعمل بدون أي تغيير أثناء الاختبار
- `promote-candidate.sh` ينقل الصورة المختبرة للإنتاج فقط عند طلبك
- عند فشل الـ health check بعد النقل، rollback تلقائي للصورة السابقة

### ملاحظة مهمة عن قاعدة البيانات

- إذا كان الإصدار الجديد يحتوي migrations غير متوافقة للخلف، فقد تتأثر النسخة القديمة بعد تطبيق migration
- لذلك يوصى أن تكون migrations في الإنتاج backward-compatible قدر الإمكان (Expand/Contract)

### طريقة بديلة (نشر آمن تلقائي مباشر)

```bash
chmod +x infra/deploy-safe-rollout.sh
./infra/deploy-safe-rollout.sh
```

### الطريقة القديمة (Fallback فقط)

```bash
docker compose -f docker-compose.prod.yml down
docker build -t wahda_web:latest . --no-cache
docker compose -f docker-compose.prod.yml up -d
docker exec wahda_app npx prisma migrate deploy
```

### ⛔ أوامر محظورة على الإنتاج

| الأمر                          | السبب                                           |
| ------------------------------ | ----------------------------------------------- |
| `prisma migrate reset`         | يمسح جميع البيانات ويعيد إنشاء الجداول من الصفر |
| `prisma db push --force-reset` | يحذف الجداول ويعيد إنشاءها                      |
| `docker compose down -v`       | يحذف الـ volumes (بيانات القاعدة + Redis)       |
| `docker volume rm ...`         | حذف مباشر لبيانات محفوظة                        |

### ✅ أوامر آمنة على الإنتاج

| الأمر                             | الوظيفة                                |
| --------------------------------- | -------------------------------------- |
| `prisma migrate deploy`           | يطبّق المايقريشنات الجديدة فقط دون مسح |
| `docker compose down` (بدون `-v`) | يوقف الحاويات مع الحفاظ على البيانات   |
| `docker build --no-cache`         | يعيد بناء الصورة فقط                   |

## أخطاء شائعة وحلولها

| الخطأ                                                            | السبب                        | الحل                                            |
| ---------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `P1001: Can't reach database`                                    | الحاوية ليست على نفس شبكة DB | أضف `waadapp_tba_network` (external) في compose |
| `PrismaClientInitializationError: could not locate Query Engine` | binaryTargets خاطئ           | أضف `debian-openssl-3.0.x` في schema.prisma     |
| `EACCES: permission denied`                                      | صلاحيات الملفات              | أضف `chown -R node:node /app` قبل `USER node`   |
| `Cannot find module openssl`                                     | openssl غير مثبت             | أضف `apt-get install -y openssl` في Dockerfile  |
| `DATABASE_URL not set`                                           | متغيرات بيئة ناقصة           | تحقق من `.env.production` على السيرفر           |
| `Failed to find Server Action`                                   | كاش متصفح قديم               | امسح كاش المتصفح أو Ctrl+F5                     |
| `[redis:pub] Error: connect ECONNREFUSED`                        | Redis غير متاح               | التطبيق يعمل بدونه — تأكد من `wahda_redis` يعمل |

## النسخ الاحتياطي المجدول

### إعداد سريع (Cron على Linux)

```bash
cd /opt/wahda_websit/alwaha-care
chmod +x scripts/backup.sh scripts/install-backup-cron.sh
./scripts/install-backup-cron.sh
```

- الجدولة الافتراضية: يومياً الساعة `02:00` صباحاً.
- لتخصيص الجدولة:

```bash
BACKUP_CRON_EXPR="0 */6 * * *" ./scripts/install-backup-cron.sh
```

- لمراجعة المهمة:

```bash
crontab -l | grep backup.sh
```

### ما الذي تحسّن في سكربت النسخ

- قفل تشغيل (`lock file`) لمنع تشغيل نسختين احتياطيتين بنفس الوقت.
- فحص سلامة gzip بعد الإنشاء.
- فحص سريع لمحتوى dump قبل اعتماد الملف.
- إنشاء ملف بصمة `SHA256` بجانب كل نسخة.
- تنظيف ملفات البصمة القديمة مع النسخ القديمة.

## النسخ الاحتياطي إلى Google Drive (كل ساعة/ساعتين + احتفاظ شهر)

تمت إضافة سكربتات جاهزة:

- `scripts/backup-drive.sh`
- `scripts/install-backup-drive-cron.sh`

تعتمد على `rclone` لرفع أحدث نسخة إلى Google Drive ثم حذف الملفات الأقدم من 30 يوم.

### 1) تثبيت وإعداد rclone

على السيرفر:

```bash
sudo apt-get update && sudo apt-get install -y rclone
rclone config
```

أنشئ remote باسم `gdrive` (أو أي اسم) واربطه بحساب Google Drive.

### 2) تشغيل يدوي للتجربة

```bash
cd /opt/wahda_websit/alwaha-care
chmod +x scripts/backup-drive.sh scripts/install-backup-drive-cron.sh
DRIVE_REMOTE="gdrive:wahda_db_backups" ./scripts/backup-drive.sh
```

### 3) الجدولة كل ساعتين (افتراضي)

```bash
cd /opt/wahda_websit/alwaha-care
DRIVE_REMOTE="gdrive:wahda_db_backups" ./scripts/install-backup-drive-cron.sh
```

### 4) الجدولة كل ساعة (اختياري)

```bash
cd /opt/wahda_websit/alwaha-care
BACKUP_DRIVE_CRON_EXPR="0 * * * *" DRIVE_REMOTE="gdrive:wahda_db_backups" ./scripts/install-backup-drive-cron.sh
```

### 5) سياسة الاحتفاظ

- محليًا: تعتمد على `KEEP_DAYS` (افتراضي 30) داخل `backup.sh`
- على Google Drive: `backup-drive.sh` يحذف الملفات الأقدم من `KEEP_DAYS` (افتراضي 30)

مثال تغيير الاحتفاظ إلى 45 يوم:

```bash
KEEP_DAYS=45 DRIVE_REMOTE="gdrive:wahda_db_backups" ./scripts/install-backup-drive-cron.sh
```

## اقتراحات إضافية لتحسين النسخ الاحتياطي

1. نسخ خارج السيرفر يومياً (S3/Azure Blob/rsync) للحماية من فقدان القرص بالكامل.
2. اختبار استعادة شهري في بيئة staging والتأكد من نجاح تسجيل الدخول والخصم.
3. تشفير مجلد النسخ على مستوى القرص أو تخزينه على volume مشفّر.
4. مراقبة امتلاء مساحة القرص مع تنبيه عند تجاوز 80%.
5. الاحتفاظ بنسخ أسبوعية/شهرية طويلة الأمد بجانب النسخ اليومية.
