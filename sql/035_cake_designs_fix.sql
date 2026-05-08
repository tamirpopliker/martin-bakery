-- ═══════════════════════════════════════════════════════════════════════
-- 035: Fix RLS for cake-designs bucket
-- Bug in 034: unqualified `name` inside the EXISTS subquery resolved to
-- app_users.name (the branch's Hebrew display name), not the storage
-- object's path. Result: foldername(name) = NULL so the policy never
-- matched. Fix by qualifying with `storage.objects.name`.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "cake_designs_read"   on storage.objects;
drop policy if exists "cake_designs_write"  on storage.objects;
drop policy if exists "cake_designs_update" on storage.objects;
drop policy if exists "cake_designs_delete" on storage.objects;

create policy "cake_designs_read" on storage.objects for select
  using (
    bucket_id = 'cake-designs' and (
      exists (select 1 from app_users where auth_uid = auth.uid() and role = 'admin')
      or exists (
        select 1 from app_users
        where auth_uid = auth.uid()
          and role = 'branch'
          and (storage.foldername(storage.objects.name))[1] = app_users.branch_id::text
      )
    )
  );

create policy "cake_designs_write" on storage.objects for insert
  with check (
    bucket_id = 'cake-designs' and (
      exists (select 1 from app_users where auth_uid = auth.uid() and role = 'admin')
      or exists (
        select 1 from app_users
        where auth_uid = auth.uid()
          and role = 'branch'
          and (storage.foldername(storage.objects.name))[1] = app_users.branch_id::text
      )
    )
  );

create policy "cake_designs_update" on storage.objects for update
  using (
    bucket_id = 'cake-designs' and (
      exists (select 1 from app_users where auth_uid = auth.uid() and role = 'admin')
      or exists (
        select 1 from app_users
        where auth_uid = auth.uid()
          and role = 'branch'
          and (storage.foldername(storage.objects.name))[1] = app_users.branch_id::text
      )
    )
  );

create policy "cake_designs_delete" on storage.objects for delete
  using (
    bucket_id = 'cake-designs' and (
      exists (select 1 from app_users where auth_uid = auth.uid() and role = 'admin')
      or exists (
        select 1 from app_users
        where auth_uid = auth.uid()
          and role = 'branch'
          and (storage.foldername(storage.objects.name))[1] = app_users.branch_id::text
      )
    )
  );
