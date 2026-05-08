-- ═══════════════════════════════════════════════════════════════════════
-- 034: Cake topper print editor — storage bucket + RLS
-- Private bucket. Path convention: <branch_id>/<uuid>_<filename>
-- Branch users read/write only their own folder; admin can access all.
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('cake-designs', 'cake-designs', false)
on conflict (id) do nothing;

drop policy if exists "cake_designs_read"  on storage.objects;
drop policy if exists "cake_designs_write" on storage.objects;
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
          and (storage.foldername(name))[1] = branch_id::text
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
          and (storage.foldername(name))[1] = branch_id::text
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
          and (storage.foldername(name))[1] = branch_id::text
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
          and (storage.foldername(name))[1] = branch_id::text
      )
    )
  );
