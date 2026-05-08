-- 041_hr_documents_storage.sql
-- Private bucket "hr-documents" + tiered RLS:
-- admin: full access. branch managers: own branch only. factory managers: own department.
-- Path convention: <kind>/<branch_id_or_department>/<employee_id>/<doc_type_key>/<uuid>_<file>

INSERT INTO storage.buckets (id, name, public)
VALUES ('hr-documents', 'hr-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "hr_documents_select" ON storage.objects;
DROP POLICY IF EXISTS "hr_documents_write"  ON storage.objects;
DROP POLICY IF EXISTS "hr_documents_update" ON storage.objects;
DROP POLICY IF EXISTS "hr_documents_delete" ON storage.objects;

CREATE POLICY "hr_documents_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'hr-documents' AND (
      EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
      OR (
        (storage.foldername(storage.objects.name))[1] = 'branch'
        AND EXISTS (
          SELECT 1 FROM app_users
          WHERE auth_uid = auth.uid()
            AND role = 'branch'
            AND email NOT ILIKE '%@martin.local'
            AND (storage.foldername(storage.objects.name))[2] = app_users.branch_id::text
        )
      )
      OR (
        (storage.foldername(storage.objects.name))[1] = 'factory'
        AND EXISTS (
          SELECT 1 FROM app_users
          WHERE auth_uid = auth.uid()
            AND role = 'factory'
            AND (
              app_users.managed_department IS NULL
              OR (storage.foldername(storage.objects.name))[2] = app_users.managed_department
            )
        )
      )
    )
  );

CREATE POLICY "hr_documents_write" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'hr-documents' AND (
      EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
      OR (
        (storage.foldername(storage.objects.name))[1] = 'branch'
        AND EXISTS (
          SELECT 1 FROM app_users
          WHERE auth_uid = auth.uid()
            AND role = 'branch'
            AND email NOT ILIKE '%@martin.local'
            AND (storage.foldername(storage.objects.name))[2] = app_users.branch_id::text
        )
      )
      OR (
        (storage.foldername(storage.objects.name))[1] = 'factory'
        AND EXISTS (
          SELECT 1 FROM app_users
          WHERE auth_uid = auth.uid()
            AND role = 'factory'
            AND (
              app_users.managed_department IS NULL
              OR (storage.foldername(storage.objects.name))[2] = app_users.managed_department
            )
        )
      )
    )
  );

CREATE POLICY "hr_documents_update" ON storage.objects FOR UPDATE
  USING      (bucket_id = 'hr-documents' AND EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'))
  WITH CHECK (bucket_id = 'hr-documents' AND EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

CREATE POLICY "hr_documents_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'hr-documents' AND EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));
