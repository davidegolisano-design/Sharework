begin;
alter table public.sw_annotations
 add column work_type text check(work_type in ('hot_work','welding','pipework','lifting','painting','electrical','mechanical','inspection','safety','cleaning','other')),
 add column work_start timestamptz,
 add column work_end timestamptz,
 add column work_status text default 'started' check(work_status in ('pending','started','paused','completed')),
 add constraint sw_work_schedule_order check(work_end is null or work_start is null or work_end>work_start);
alter table public.sw_annotations alter column work_status drop default;
grant update(work_type,work_start,work_end,work_status) on public.sw_annotations to authenticated;
commit;
