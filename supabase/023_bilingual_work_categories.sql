begin;

alter table public.sw_work_categories
 add column name_en text check (char_length(btrim(name_en)) between 1 and 60);

grant insert(name_en), update(name_en) on public.sw_work_categories to authenticated;

commit;
