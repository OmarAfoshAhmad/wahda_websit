-- نوع حركة مستقل للصيدلية (يُضاف في migration منفصلة لأن قيمة enum الجديدة لا تُستخدم في نفس المعاملة).
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'PHARMACY';
