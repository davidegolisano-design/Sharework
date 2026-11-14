begin;

create function public.sw_valid_work_regions(regions jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if not public.sw_valid_note_strokes(regions) then return false; end if;
 return not exists (
  select 1 from jsonb_array_elements(regions) as region
  where jsonb_array_length(region)<3
 );
end $$;

alter table public.sw_annotations
 add column regions jsonb not null default '[]' check(public.sw_valid_work_regions(regions)),
 add column decks_above smallint not null default 0 check(decks_above between 0 and 500),
 add column decks_below smallint not null default 0 check(decks_below between 0 and 500);
grant update(regions,decks_above,decks_below) on public.sw_annotations to authenticated;

commit;
