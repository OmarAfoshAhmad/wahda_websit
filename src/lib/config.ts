/**
 * ثوابت العمل — Business Constants
 * لتغيير أي قيمة: عدّل هنا فقط، التغيير ينعكس تلقائياً في جميع أجزاء النظام.
 */

/** الرصيد الابتدائي لكل مستفيد جديد بالدينار الليبي */
const _rawBalance = Number(process.env.INITIAL_BALANCE ?? "600");
export const INITIAL_BALANCE =
  Number.isFinite(_rawBalance) && _rawBalance > 0 ? _rawBalance : 600;
