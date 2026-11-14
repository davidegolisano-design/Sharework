begin;
alter table public.sw_projects add column deleted_at timestamptz;
alter policy sw_project_add on public.sw_projects with check(
 (select public.sw_admin()) and created_by=(select auth.uid()) and deleted_at is null
);
alter policy sw_project_edit on public.sw_projects using(
 deleted_at is null and (select public.sw_manage_projects())
) with check(deleted_at is null and (select public.sw_manage_projects()));

alter policy sw_project_read on public.sw_projects using(
 deleted_at is null and ((select public.sw_manage_projects()) or public.sw_project_level(id) is not null)
);

create or replace function public.sw_project_level(target uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when p.role in ('super_admin','admin') then 'edit'
  else (select access_level from public.sw_project_access where project_id=target and user_id=p.id)
 end from public.sw_profiles p
 where p.id=auth.uid() and p.approved
 and exists(select 1 from public.sw_projects j where j.id=target and j.deleted_at is null);
$$;

alter policy sw_document_read on public.sw_documents using(
 public.sw_project_level(project_id) is not null and ((select public.sw_admin()) or ship_plan is not null)
);

create function public.sw_remove_project(target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(461785204);
 if not public.sw_admin() then raise exception 'Solo super admin' using errcode='42501'; end if;
 update public.sw_projects set deleted_at=now() where id=target and deleted_at is null;
end $$;
revoke all on function public.sw_remove_project(uuid) from public,anon,authenticated;
grant execute on function public.sw_remove_project(uuid) to authenticated;
commit;
