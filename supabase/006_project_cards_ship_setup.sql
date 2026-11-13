begin;

create or replace function public.sw_can_configure() returns boolean
language sql stable security definer set search_path='' as $$
 select public.sw_admin();
$$;

create unique index sw_one_ship_plan_per_project on public.sw_documents(project_id) where ship_plan is not null;

alter table public.sw_projects
 add column start_date date,
 add column end_date date,
 add column cover_image text,
 add constraint sw_project_period check (
   (start_date is null and end_date is null)
   or (start_date is not null and end_date is not null and start_date <= end_date)
 ),
 add constraint sw_project_cover check (
   cover_image is null or (
     length(cover_image) <= 145000
     and cover_image ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
   )
 );
grant update(start_date,end_date,cover_image) on public.sw_projects to authenticated;

commit;
