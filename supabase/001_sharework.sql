-- Sharework: run once in the SQL editor. No credentials in this file.
begin;
create table public.sw_profiles (
 id uuid primary key references auth.users(id), full_name text not null check(length(full_name) between 2 and 120),
 approved boolean not null default false, role text not null default 'member' check(role in ('member','admin')),
 created_at timestamptz not null default now()
);
create function public.sw_member() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.sw_profiles where id=auth.uid() and approved); $$;
create function public.sw_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.sw_profiles where id=auth.uid() and approved and role='admin'); $$;
revoke all on function public.sw_member(),public.sw_admin() from public;
grant execute on function public.sw_member(),public.sw_admin() to authenticated;
create function public.sw_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.sw_profiles(id,full_name) values(new.id,left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Utente'),120));
 return new;
end $$;
create trigger sw_auth_user after insert on auth.users for each row execute function public.sw_new_user();
revoke all on function public.sw_new_user() from public;
-- Users registered before setup remain pending; nobody is auto-promoted.
insert into public.sw_profiles(id,full_name)
select id,case when length(trim(coalesce(raw_user_meta_data->>'full_name','')))>=2 then left(trim(raw_user_meta_data->>'full_name'),120) else 'Utente' end from auth.users
on conflict(id) do nothing;
create table public.sw_projects (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 180),
 file_path text not null unique, file_name text not null, page_count integer not null check(page_count>0),
 created_by uuid not null references public.sw_profiles(id), created_at timestamptz not null default now(), next_note integer not null default 1
);
create function public.sw_project_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not public.sw_member() then raise exception 'Accesso non autorizzato';end if;
 if split_part(new.file_path,'/',1)<>auth.uid()::text then raise exception 'Percorso PDF non valido';end if;
 new.created_by=auth.uid();new.created_at=now();new.next_note=1;return new;
end $$;
create trigger sw_project_identity before insert on public.sw_projects for each row execute function public.sw_project_insert();
revoke all on function public.sw_project_insert() from public;
create table public.sw_annotations (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.sw_projects(id),
 page integer not null check(page>0), kind text not null check(kind in ('note','highlight')), number integer,
 title text not null default '' check(length(title)<=250),description text not null default '' check(length(description)<=20000),
 color text not null default '#e9b824' check(color ~ '^#[0-9a-fA-F]{6}$'), shape text not null default 'circle' check(shape in ('circle','square','diamond','triangle')),
 opacity integer not null default 35 check(opacity between 0 and 100), width numeric not null default 18 check(width>0 and width<=60),
 x numeric not null default 0 check(x between 0 and 1),y numeric not null default 0 check(y between 0 and 1),
 points jsonb not null default '[]' check(jsonb_typeof(points)='array' and jsonb_array_length(points)<=20000),
 created_by uuid not null references public.sw_profiles(id),author_name text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),updated_by uuid references public.sw_profiles(id),
 version integer not null default 1,deleted boolean not null default false,
 unique(project_id,number)
);
create index sw_annotation_project on public.sw_annotations(project_id,page);
create function public.sw_annotation_write() returns trigger language plpgsql security definer set search_path='' as $$
declare count_pages integer;p jsonb;
begin
 if not public.sw_member() then raise exception 'Accesso non autorizzato';end if;
 if tg_op='INSERT' then
  new.created_by=auth.uid();select full_name into new.author_name from public.sw_profiles where id=auth.uid();
  new.created_at=now();new.version=1;new.deleted=false;
  if new.kind='note' then update public.sw_projects set next_note=next_note+1 where id=new.project_id returning next_note-1 into new.number;else new.number=null;end if;
 else
  if (new.id,new.project_id,new.page,new.kind,new.number,new.created_by,new.author_name,new.created_at) is distinct from (old.id,old.project_id,old.page,old.kind,old.number,old.created_by,old.author_name,old.created_at) then raise exception 'Identità annotazione non modificabile';end if;
  new.version=old.version+1;
 end if;
 select page_count into count_pages from public.sw_projects where id=new.project_id;
 if count_pages is null or new.page>count_pages then raise exception 'Pagina non valida';end if;
 for p in select value from jsonb_array_elements(new.points) loop
  if jsonb_typeof(p)<>'array' or jsonb_array_length(p)<>2 then raise exception 'Tratto non valido';end if;
  if jsonb_typeof(p->0)<>'number' or jsonb_typeof(p->1)<>'number' then raise exception 'Coordinate non valide';end if;
  if (p->>0)::numeric not between 0 and 1 or (p->>1)::numeric not between 0 and 1 then raise exception 'Coordinate non valide';end if;
 end loop;
 new.updated_at=now();new.updated_by=auth.uid();return new;
end $$;
create trigger sw_annotation_identity before insert or update on public.sw_annotations for each row execute function public.sw_annotation_write();
revoke all on function public.sw_annotation_write() from public;
alter table public.sw_profiles enable row level security;
alter table public.sw_projects enable row level security;
alter table public.sw_annotations enable row level security;
revoke all on public.sw_profiles,public.sw_projects,public.sw_annotations from anon,authenticated;
grant select on public.sw_profiles to authenticated;
grant select,insert on public.sw_projects to authenticated;
grant update(title) on public.sw_projects to authenticated;
grant select,insert on public.sw_annotations to authenticated;
grant update(title,description,color,shape,opacity,width,x,y,points,deleted) on public.sw_annotations to authenticated;
create policy sw_profile_read on public.sw_profiles for select to authenticated using(id=auth.uid() or public.sw_admin() or (approved and public.sw_member()));
create policy sw_project_read on public.sw_projects for select to authenticated using(public.sw_member());
create policy sw_project_add on public.sw_projects for insert to authenticated with check(public.sw_member() and created_by=auth.uid());
create policy sw_project_edit on public.sw_projects for update to authenticated using(public.sw_member()) with check(public.sw_member());
create policy sw_note_read on public.sw_annotations for select to authenticated using(public.sw_member());
create policy sw_note_add on public.sw_annotations for insert to authenticated with check(public.sw_member() and created_by=auth.uid());
create policy sw_note_edit on public.sw_annotations for update to authenticated using(public.sw_member()) with check(public.sw_member());
create function public.sw_set_approval(target uuid,allow_access boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.sw_admin() then raise exception 'Solo amministratore';end if;
 if target=auth.uid() then raise exception 'Non puoi disattivare il tuo account';end if;
 update public.sw_profiles set approved=allow_access where id=target and role<>'admin';
end $$;
revoke all on function public.sw_set_approval(uuid,boolean) from public;grant execute on function public.sw_set_approval(uuid,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sharework-pdfs','sharework-pdfs',false,50000000,array['application/pdf']);
create policy sw_pdf_read on storage.objects for select to authenticated using(bucket_id='sharework-pdfs' and public.sw_member() and (exists(select 1 from public.sw_projects p where p.file_path=name) or (storage.foldername(name))[1]=auth.uid()::text));
create policy sw_pdf_upload on storage.objects for insert to authenticated with check(bucket_id='sharework-pdfs' and public.sw_member() and (storage.foldername(name))[1]=auth.uid()::text);
create policy sw_pdf_cleanup on storage.objects for delete to authenticated using(bucket_id='sharework-pdfs' and public.sw_member() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.sw_projects p where p.file_path=name));
commit;
