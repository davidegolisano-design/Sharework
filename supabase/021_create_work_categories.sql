begin;

alter table public.sw_work_categories
 add column glyph text,
 alter column id set default ('emoji_' || replace(gen_random_uuid()::text,'-','')),
 add constraint sw_work_categories_custom_symbol check (
  (glyph is null and left(id,6)<>'emoji_') or
  (id ~ '^emoji_[0-9a-f]{32}$' and name is not null and glyph is not null
   and char_length(btrim(glyph)) between 1 and 24
   and replace(glyph,U&'\FE0F','')<>'')
 );

create unique index sw_work_categories_glyph_idx
 on public.sw_work_categories ((replace(glyph,U&'\FE0F',''))) where glyph is not null;

grant insert(name,glyph) on public.sw_work_categories to authenticated;
create policy "Super admins create categories" on public.sw_work_categories for insert to authenticated
 with check ((select public.sw_admin()));

revoke insert(category_id,glyph,name) on public.sw_work_emoji from authenticated;
drop policy "Super admins add emoji" on public.sw_work_emoji;

create or replace function public.sw_validate_work_emoji() returns trigger
language plpgsql set search_path='' as $$
begin
 if left(new.shape,6)='emoji_' and not exists (
  select 1 from public.sw_work_categories where id=new.shape and glyph is not null
 ) and not exists (
  select 1 from public.sw_work_emoji where id=new.shape
 ) then
  raise exception 'Unknown work emoji' using errcode='23514';
 end if;
 return new;
end;
$$;

commit;
