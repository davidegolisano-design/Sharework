begin;

alter table public.sw_work_categories
 add column archived boolean not null default false,
 drop constraint sw_work_categories_custom_symbol,
 add constraint sw_work_categories_custom_symbol check (
  (id in ('circle','square','diamond','triangle') and glyph is null and not archived) or
  (id not in ('circle','square','diamond','triangle')
   and (left(id,6)<>'emoji_' or (id ~ '^emoji_[0-9a-f]{32}$' and name is not null and glyph is not null))
   and (glyph is null or (char_length(btrim(glyph)) between 1 and 24 and replace(glyph,U&'\FE0F','')<>'')))
 );

insert into public.sw_work_categories(id) values ('circle'),('square'),('diamond'),('triangle');

-- Promote standalone symbols created by the first catalog version. Their IDs are
-- already stored on annotations, so those references carry over to the new category.
with promoted as (
 insert into public.sw_work_categories(id,name,glyph)
 select id,name,glyph from public.sw_work_emoji
 on conflict do nothing
 returning id
)
delete from public.sw_work_emoji old using promoted where old.id=promoted.id;

drop index public.sw_work_categories_glyph_idx;
create unique index sw_work_categories_glyph_idx
 on public.sw_work_categories ((replace(glyph,U&'\FE0F',''))) where glyph is not null and not archived;

grant update(glyph,archived) on public.sw_work_categories to authenticated;

create or replace function public.sw_validate_work_emoji() returns trigger
language plpgsql set search_path='' as $$
declare unavailable boolean;
begin
 if tg_op='UPDATE' and new.shape is not distinct from old.shape then
  return new;
 end if;
 if left(new.shape,6)='emoji_' then
  select archived into unavailable from public.sw_work_categories
   where id=new.shape and glyph is not null;
  if not found and not exists (select 1 from public.sw_work_emoji where id=new.shape) then
   raise exception 'Unknown work emoji' using errcode='23514';
  end if;
 else
  select archived into unavailable from public.sw_work_categories where id=case new.shape
   when 'flame' then 'hot_work' when 'welding' then 'hot_work'
   when 'tool' then 'mechanical' when 'drilling' then 'mechanical'
   when 'pipes' then 'pipework' when 'electric' then 'electrical'
   when 'measurement' then 'inspection'
   when 'ppe' then 'safety' when 'fire_watch' then 'safety' when 'warning' then 'safety'
   else new.shape end;
 end if;
 if unavailable then
  raise exception 'Categoria eliminata. Scegli un altro simbolo.' using errcode='23514';
 end if;
 return new;
end;
$$;

commit;
