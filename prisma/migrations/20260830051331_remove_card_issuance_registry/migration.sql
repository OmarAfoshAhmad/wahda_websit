-- إزالة جدولَي وحدة "جدول الحقيقة" (Truth Registry) نهائياً بناءً على طلب المستخدم بحذف الوحدة بالكامل.
-- تحقّقنا قبل الحذف أن كلا الجدولين فارغ (0 صف)، فلا فقدان بيانات.
DROP TABLE IF EXISTS "CardIssuanceRegistry";
DROP TABLE IF EXISTS "CardIssuanceRegistryAll";
