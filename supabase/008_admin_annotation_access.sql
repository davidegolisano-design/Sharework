begin;
create or replace function public.sw_project_level(target uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when p.role in ('super_admin','admin') then 'edit'
  else (select access_level from public.sw_project_access where project_id=target and user_id=p.id)
 end from public.sw_profiles p where p.id=auth.uid() and p.approved;
$$;
commit;
