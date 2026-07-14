#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  سكربت استيراد بيئة الإنتاج — Waha Health Care
#  migrate-import.sh
# ═══════════════════════════════════════════════════════════════════
#
#  يُنفَّذ على السيرفر الجديد بعد نقل ملف التصدير:
#    1. فك الضغط
#    2. إعداد المشروع
#    3. استعادة قاعدة البيانات
#    4. تشغيل الحاويات
#    5. فحص صحة النظام
#
#  الاستخدام:
#    chmod +x infra/migrate-import.sh
#    ./infra/migrate-import.sh /tmp/wahda_migration_YYYYMMDD_HHMMSS.tar.gz
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

ARCHIVE_PATH="${1:-}"
PROJECT_DIR="${PROJECT_DIR:-/opt/wahda_websit/alwaha-care}"
DB_CONTAINER="${DB_CONTAINER:-waadapp-db}"
DB_USER="${DB_USER:-wahda_user}"
DB_NAME="${DB_NAME:-wahda_websit}"
IMPORT_DIR="${PROJECT_DIR}/migration-import"

if [ -z "$ARCHIVE_PATH" ]; then
  echo "❌ الاستخدام: $0 /tmp/wahda_migration_xxx.tar.gz"
  exit 1
fi

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "❌ الملف غير موجود: $ARCHIVE_PATH"
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════"
echo " 🚚 استيراد بيئة الإنتاج - Waha Health Care"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. فحص المتطلبات ─────────────────────────────────────────────
echo "🔍 [1/7] فحص المتطلبات..."
command -v docker >/dev/null 2>&1 || { echo "❌ Docker غير مثبت"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ Git غير مثبت"; exit 1; }

echo "   ✅ Docker/Git متاحين"

# ── 2. إنشاء مسار المشروع ────────────────────────────────────────
echo "📁 [2/7] تجهيز مسار المشروع..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

if [ ! -d ".git" ]; then
  echo "   ℹ️  لا يوجد repo — سيتم عمل clone"
  git clone https://github.com/OmarAfoshAhmad/wahda_websit.git .
else
  echo "   ℹ️  repo موجود — سيتم التحديث"
  git fetch origin
  git checkout main
  git pull --ff-only origin main
fi

echo "   ✅ المشروع جاهز"

# ── 3. فك ضغط التصدير ─────────────────────────────────────────────
echo "📦 [3/7] فك ملف التصدير..."
rm -rf "$IMPORT_DIR"
mkdir -p "$IMPORT_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$IMPORT_DIR"

echo "   ✅ تم فك الضغط"

# ── 4. استعادة ملف البيئة ─────────────────────────────────────────
echo "🔐 [4/7] استعادة متغيرات البيئة..."
if [ -f "$IMPORT_DIR/.env.production" ]; then
  cp "$IMPORT_DIR/.env.production" "$PROJECT_DIR/.env.production"
  chmod 600 "$PROJECT_DIR/.env.production"
  echo "   ✅ تمت استعادة .env.production"
else
  echo "   ⚠️  .env.production غير موجود داخل الأرشيف"
  echo "   يجب إنشاؤه يدوياً قبل المتابعة"
  exit 1
fi

# ── 5. تشغيل الحاويات ─────────────────────────────────────────────
echo "🐳 [5/7] تشغيل خدمات Docker..."

# إنشاء الشبكة الخارجية إن لم تكن موجودة
if ! docker network ls --format '{{.Name}}' | grep -q '^waadapp_tba_network$'; then
  docker network create waadapp_tba_network
  echo "   ✅ تم إنشاء الشبكة waadapp_tba_network"
fi

# بناء وتشغيل التطبيق و Redis
APP_IMAGE=wahda_web:latest docker compose -f docker-compose.prod.yml up -d --build

echo "   ✅ الحاويات تعمل"

# انتظار جاهزية قاعدة البيانات
echo "   ⏳ انتظار جاهزية PostgreSQL..."
for i in {1..30}; do
  if docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "   ✅ PostgreSQL جاهزة"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "   ❌ PostgreSQL لم تصبح جاهزة خلال المهلة"
    exit 1
  fi
done

# ── 6. استعادة قاعدة البيانات ─────────────────────────────────────
echo "🗄️  [6/7] استعادة قاعدة البيانات..."

if [ ! -f "$IMPORT_DIR/database.dump" ]; then
  echo "   ❌ ملف database.dump غير موجود"
  exit 1
fi

# إيقاف التطبيق مؤقتاً لتفادي الكتابة أثناء الاستعادة
docker stop wahda_app >/dev/null 2>&1 || true

# حذف schema public وإعادة إنشائها (داخل نفس DB فقط)
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

# الاستعادة
docker exec -i "$DB_CONTAINER" pg_restore \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --verbose \
  < "$IMPORT_DIR/database.dump"

echo "   ✅ تمت استعادة قاعدة البيانات"

# تشغيل التطبيق بعد الاستعادة
docker start wahda_app

# ── 7. التحقق النهائي ──────────────────────────────────────────────
echo "🧪 [7/7] فحص الصحة النهائية..."

# انتظار التطبيق
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${APP_HOST_PORT:-3101}/api/health" >/dev/null 2>&1; then
    echo "   ✅ Health check نجح"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "   ⚠️  Health check لم ينجح خلال المهلة. تحقق من logs"
  fi
done

# عرض حالة الحاويات
echo ""
echo "📋 حالة الحاويات:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "wahda_app|wahda_redis|waadapp-db|NAMES" || true

# تنظيف مجلد الاستيراد
rm -rf "$IMPORT_DIR"

echo ""
echo "══════════════════════════════════════════════"
echo " ✅ تم نقل البيئة بنجاح"
echo "══════════════════════════════════════════════"
echo ""
echo " للتحقق الإضافي:"
echo "   docker logs wahda_app --tail 50"
echo "   docker logs $DB_CONTAINER --tail 50"
echo ""
