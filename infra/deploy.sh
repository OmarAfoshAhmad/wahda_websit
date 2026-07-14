#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  سكريبت النشر الكامل — Waha Health Care
#  deploy.sh
# ═══════════════════════════════════════════════════════════════════
#
# يُشغّل 3 مكونات على VPS واحد بـ 4 CPU / 16GB RAM:
#   1. PgBouncer  — مُجمّع اتصالات PostgreSQL (منفذ 5433)
#   2. Next.js ×N — عدد نسخ ديناميكي حسب CPU عبر PM2 cluster mode
#   3. Nginx      — موزع الحمل (منفذ 80 / 443)
#
# الاستخدام:
#   chmod +x infra/deploy.sh
#   ./infra/deploy.sh
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

echo ""
echo "══════════════════════════════════════════════"
echo " 🚀 نشر Waha Health Care"
echo "══════════════════════════════════════════════"
echo ""

# 1. بناء التطبيق
echo "📦 [1/5] بناء التطبيق..."
npm run build
npx prisma generate
echo "   ✅ تم البناء بنجاح"

# 2. تشغيل ترحيل قاعدة البيانات
echo "🗄️  [2/5] ترحيل قاعدة البيانات..."
npx prisma migrate deploy
echo "   ✅ تم الترحيل"

# 3. تثبيت/تحديث PM2
echo "⚙️  [3/5] تهيئة PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi
# إيقاف النسخة القديمة (إن وجدت) بشكل أنيق
pm2 delete waha-health-care 2>/dev/null || true
echo "   ✅ PM2 جاهز"

# 4. تشغيل التطبيق عبر PM2 (عدد نسخ ديناميكي)
echo "🌐 [4/5] تشغيل التطبيق..."
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
echo "   ✅ التطبيق يعمل (عدد النسخ حسب CPU):"
pm2 list | grep waha-health-care

# 5. التحقق من Nginx
echo "🔧 [5/5] إعادة تشغيل Nginx..."
if command -v nginx &> /dev/null; then
    sudo nginx -t && sudo systemctl reload nginx
    echo "   ✅ Nginx محدّث"
else
    echo "   ⚠️  Nginx غير مثبت. ثبّته بـ: sudo apt install nginx"
fi

echo ""
echo "══════════════════════════════════════════════"
echo " ✅ تم النشر الكامل بنجاح!"
echo "══════════════════════════════════════════════"
echo ""
echo " المراقبة:"
echo "   pm2 monit              # مراقبة CPU/RAM لحظياً"
echo "   pm2 logs               # سجلات التطبيق"
echo "   pm2 reload ecosystem.config.js --env production  # تحديث بلا توقف"
echo ""
