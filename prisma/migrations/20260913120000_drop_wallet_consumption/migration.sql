-- WalletConsumption لم يكن يُزاد عند الخصم قط (processClaim لم يُستدعَ من أي مسار)، وكان يُنقص عند الإلغاء فقط،
-- فقيمه بلا معنى محاسبي ولا يُقرأ منها أي قرار. الاستهلاك الحقيقي يُحسب دائماً من دفتر الحركات
-- عبر getCappedConsumption. لا فقدان بيانات: الجدول لا يحمل شيئاً لا يُشتق من "Transaction".
DROP TABLE IF EXISTS "WalletConsumption";
