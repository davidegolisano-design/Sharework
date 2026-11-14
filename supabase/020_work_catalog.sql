begin;

create table public.sw_work_categories(
 id text primary key,
 name text check(char_length(btrim(name)) between 1 and 60)
);

insert into public.sw_work_categories(id) values
 ('scaffolding'),('hot_work'),('lifting'),('mechanical'),('pipework'),('electrical'),
 ('cleaning'),('testing'),('painting'),('inspection'),('safety');

create table public.sw_work_emoji(
 id text primary key default ('emoji_' || replace(gen_random_uuid()::text,'-',''))
  check(id ~ '^emoji_[0-9a-f]{32}$'),
 category_id text not null references public.sw_work_categories(id),
 glyph text not null unique check(char_length(btrim(glyph)) between 1 and 24),
 name text not null check(char_length(btrim(name)) between 1 and 60)
);

create index sw_work_emoji_category_id_idx on public.sw_work_emoji(category_id);

alter table public.sw_work_categories enable row level security;
alter table public.sw_work_emoji enable row level security;
revoke all on public.sw_work_categories, public.sw_work_emoji from anon, authenticated;
grant select on public.sw_work_categories, public.sw_work_emoji to authenticated;
grant update(name) on public.sw_work_categories to authenticated;
grant insert(category_id,glyph,name) on public.sw_work_emoji to authenticated;

create policy "Approved users read categories" on public.sw_work_categories for select to authenticated
 using ((select public.sw_member()));
create policy "Approved users read emoji" on public.sw_work_emoji for select to authenticated
 using ((select public.sw_member()));
create policy "Super admins rename categories" on public.sw_work_categories for update to authenticated
 using ((select public.sw_admin())) with check ((select public.sw_admin()));
create policy "Super admins add emoji" on public.sw_work_emoji for insert to authenticated
 with check ((select public.sw_admin()));

alter table public.sw_annotations drop constraint sw_annotations_shape_check,
 add constraint sw_annotations_shape_check check(shape in (
  'circle','square','diamond','triangle','flame','warning','electric','tool',
  'welding','pipes','lifting','painting','inspection','ppe','cleaning','fire_watch',
  'mechanical','drilling','measurement','testing','scaffolding'
 ) or shape ~ '^emoji_[0-9a-f]{32}$');

create function public.sw_validate_work_emoji() returns trigger
language plpgsql set search_path='' as $$
begin
 if left(new.shape,6)='emoji_' and not exists (
  select 1 from public.sw_work_emoji where id=new.shape
 ) then
  raise exception 'Unknown work emoji' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.sw_validate_work_emoji() from public;
create trigger sw_validate_work_emoji before insert or update of shape on public.sw_annotations
 for each row execute function public.sw_validate_work_emoji();

do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.sw_work_categories, public.sw_work_emoji;
 end if;
end;
$$;
commit;
