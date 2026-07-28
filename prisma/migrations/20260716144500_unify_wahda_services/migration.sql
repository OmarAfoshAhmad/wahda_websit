-- The application is now a single service platform. These rows expose the
-- existing Wahda direct-balance services in the shared service catalogue.
INSERT INTO "ServiceType" (id, code, name, is_active, created_at, updated_at)
VALUES
  ('svc_general_wahda', 'GENERAL', 'الخدمات العامة — مصرف الوحدة', true, NOW(), NOW()),
  ('svc_medicine_wahda', 'MEDICINE', 'الأدوية — مصرف الوحدة', true, NOW(), NOW()),
  ('svc_supplies_wahda', 'SUPPLIES', 'المستلزمات — مصرف الوحدة', true, NOW(), NOW())
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    is_active = true,
    updated_at = NOW();

INSERT INTO "SystemSetting" (key, value, description, updated_at)
VALUES (
  'SHOW_WAHDA_ALLOCATION_WINDOW',
  'true',
  'إظهار نافذة مخصص مصرف الوحدة داخل المنظومة الموحدة',
  NOW()
)
ON CONFLICT (key) DO NOTHING;
