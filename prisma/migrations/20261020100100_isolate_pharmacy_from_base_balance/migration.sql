-- حركات الصيدلية لا تستهلك الرصيد العام: تُنقل إلى النوع PHARMACY (مستبعد من الرصيد الأساسي)،
-- ثم يُعاد حساب الرصيد المخزَّن وحالة المستفيدين المتأثرين من الدفتر بنفس قاعدة calculateBeneficiaryBalance.
UPDATE "Transaction" SET "type" = 'PHARMACY'
WHERE "type" = 'MEDICINE' AND "id" IN (SELECT "transaction_id" FROM "PharmacyDispense");

WITH affected AS (
  SELECT DISTINCT "beneficiary_id" AS id FROM "PharmacyDispense"
), spent AS (
  SELECT a.id, COALESCE(SUM(COALESCE(t."actual_company_share", t."amount")), 0) AS total
  FROM affected a
  LEFT JOIN "Transaction" t ON t."beneficiary_id" = a.id
    AND t."is_cancelled" = false
    AND t."type" NOT IN ('CANCELLATION', 'DENTAL', 'OPTICS', 'PHYSIOTHERAPY', 'EQUESTRIAN', 'PHARMACY')
  GROUP BY a.id
)
UPDATE "Beneficiary" b
SET "remaining_balance" = ROUND((b."total_balance" - s.total)::numeric, 2),
    "status" = CASE
      WHEN b."status" = 'SUSPENDED' THEN b."status"
      WHEN b."total_balance" - s.total <= 0 THEN 'FINISHED'::"BeneficiaryStatus"
      ELSE 'ACTIVE'::"BeneficiaryStatus"
    END,
    -- مثل settleBeneficiaryBalance: من يعود نشطًا يُمسح سبب الاكتمال.
    "completed_via" = CASE
      WHEN b."status" = 'FINISHED' AND b."total_balance" - s.total > 0 THEN NULL
      ELSE b."completed_via"
    END
FROM spent s
WHERE b."id" = s.id;
