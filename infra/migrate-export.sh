#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  سكربت تصدير بيئة الإنتاج — Waha Health Care
#  migrate-export.sh
# ═══════════════════════════════════════════════════════════════════
#
#  يُنفَّذ على السيرفر القديم لتصدير كل شيء:
#    1. نسخة احتياطية من قاعدة البيانات (PostgreSQL)
#    2. بيانات Redis (اختياري)
#    3. ملف .env.production
#    4. الكود المصدري (أو يمكن clone من GitHub)
#
#  الاستخدام:
#    chmod +x infra/migrate-export.sh
#    ./infra/migrate-export.sh
#
#  الناتج: مجلد مضغوط واحد جاهز للنقل
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── الإعدادات ──────────────────────────────────────────────────────
DB_CONTAINER="${DB_CONTAINER:-waadapp-db}"
DB_USER="${DB_USER:-wahda_user}"
DB_NAME="${DB_NAME:-wahda_websit}"
PROJECT_DIR="${PROJECT_DIR:-/opt/wahda_websit/alwaha-care}"
EXPORT_DIR="${PROJECT_DIR}/migration-export"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_NAME="wahda_migration_${TIMESTAMP}.tar.gz"

echo ""
echo "══════════════════════════════════════════════"
echo " 📦 تصدير بيئة الإنتاج - Waha Health Care"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. تنظيف وإنشاء مجلد التصدير ──────────────────────────────────
echo "📁 [1/5] إعداد مجلد التصدير..."
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"
echo "   ✅ تم: $EXPORT_DIR"

# ── 2. نسخة احتياطية من قاعدة البيانات ─────────────────────────────
echo "🗄️  [2/5] تصدير قاعدة البيانات..."

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "   ❌ خطأ: الحاوية '$DB_CONTAINER' غير شغالة!"
  echo "   تأكد من تشغيل الحاويات: docker ps"
  exit 1
fi

# تصدير كامل مع الـ schema و data
docker exec "$DB_CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  --verbose \
  > "$EXPORT_DIR/database.dump" 2>"$EXPORT_DIR/pg_dump.log"

DB_SIZE=$(du -h "$EXPORT_DIR/database.dump" | cut -f1)
echo "   ✅ تم تصدير القاعدة ($DB_SIZE)"

# التحقق من صحة الملف
MIN_SIZE=1024
ACTUAL_SIZE=$(stat --format=%s "$EXPORT_DIR/database.dump" 2>/dev/null || stat -f%z "$EXPORT_DIR/database.dump" 2>/dev/null)
if [ "$ACTUAL_SIZE" -lt "$MIN_SIZE" ]; then
  echo "   ⚠️  تحذير: حجم الملف صغير جداً ($ACTUAL_SIZE بايت). تحقق من القاعدة."
fi

# ── 3. نسخ ملف البيئة ──────────────────────────────────────────────
echo "🔐 [3/5] نسخ ملف البيئة (.env.production)..."
if [ -f "$PROJECT_DIR/.env.production" ]; then
  cp "$PROJECT_DIR/.env.production" "$EXPORT_DIR/.env.production"
  echo "   ✅ تم نسخ .env.production"
else
  echo "   ⚠️  لم يتم العثور على .env.production"
  echo "   ستحتاج إنشاء الملف يدوياً على السيرفر الجديد"
fi

# ── 4. معلومات Docker الحالية ───────────────────────────────────────
echo "🐳 [4/5] حفظ معلومات Docker الحالية..."

# حفظ قائمة الحاويات والشبكات
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" > "$EXPORT_DIR/docker-containers.txt"
docker network ls > "$EXPORT_DIR/docker-networks.txt"
docker volume ls > "$EXPORT_DIR/docker-volumes.txt"

# حفظ إصدار النظام
echo "--- System Info ---" > "$EXPORT_DIR/system-info.txt"
echo "Date: $(date)" >> "$EXPORT_DIR/system-info.txt"
echo "Hostname: $(hostname)" >> "$EXPORT_DIR/system-info.txt"
uname -a >> "$EXPORT_DIR/system-info.txt" 2>/dev/null || true
docker --version >> "$EXPORT_DIR/system-info.txt" 2>/dev/null || true
docker compose version >> "$EXPORT_DIR/system-info.txt" 2>/dev/null || true
echo "   ✅ تم حفظ المعلومات"

# ── 5. ضغط كل شيء ──────────────────────────────────────────────────
echo "📦 [5/5] ضغط الملفات..."
cd "$PROJECT_DIR"
tar -czf "$ARCHIVE_NAME" -C "$EXPORT_DIR" .
ARCHIVE_SIZE=$(du -h "$ARCHIVE_NAME" | cut -f1)
echo "   ✅ تم الضغط: $PROJECT_DIR/$ARCHIVE_NAME ($ARCHIVE_SIZE)"

# ── تنظيف المجلد المؤقت ──────────────────────────────────────────
rm -rf "$EXPORT_DIR"

echo ""
echo "══════════════════════════════════════════════"
echo " ✅ تم التصدير بنجاح!"
echo "══════════════════════════════════════════════"
echo ""
echo " الملف الناتج:"
echo "   $PROJECT_DIR/$ARCHIVE_NAME"
echo ""
echo " الخطوة التالية — انقل الملف للسيرفر الجديد:"
echo ""
echo "   scp $PROJECT_DIR/$ARCHIVE_NAME user@NEW_SERVER:/tmp/"
echo ""
echo " أو باستخدام rsync:"
echo ""
echo "   rsync -avzP $PROJECT_DIR/$ARCHIVE_NAME user@NEW_SERVER:/tmp/"
echo ""
