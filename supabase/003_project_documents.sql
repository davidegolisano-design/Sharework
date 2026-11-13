-- Multiple PDF documents per project. Existing documents/annotations preserved.
begin;
create table public.sw_documents (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.sw_projects(id),
 title text not null check(length(title) between 1 and 180),file_path text not null unique,file_name text not null,
 page_count integer not null check(page_count>0),created_by uuid not null references public.sw_profiles(id),created_at timestamptz not null default now()
);
insert into public.sw_documents(id,project_id,title,file_path,file_name,page_count,created_by,created_at)
select id,id,left(file_name,180),file_path,file_name,page_count,created_by,created_at from public.sw_projects where file_path is not null;
alter table public.sw_projects alter column file_path drop not null,alter column file_name drop not null,alter column page_count drop not null;
alter table public.sw_annotations add column document_id uuid references public.sw_documents(id);
update public.sw_annotations set document_id=project_id;
alter table public.sw_annotations alter column document_id set not null;
create index sw_annotations_document on public.sw_annotations(document_id,page);
create index sw_documents_project on public.sw_documents(project_id);
create function public.sw_document_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not public.sw_member() then raise exception 'Accesso non autorizzato';end if;
 if split_part(new.file_path,'/',1)<>auth.uid()::text then raise exception 'Percorso PDF non valido';end if;
 new.created_by=auth.uid();new.created_at=now();return new;
end $$;
create trigger sw_document_identity before insert on public.sw_documents for each row execute function public.sw_document_insert();
revoke all on function public.sw_document_insert() from public;
alter table public.sw_documents enable row level security;
revoke all on public.sw_documents from anon,authenticated;
grant select,insert on public.sw_documents to authenticated;
grant update(title) on public.sw_documents to authenticated;
create policy sw_document_read on public.sw_documents for select to authenticated using(public.sw_member());
create policy sw_document_add on public.sw_documents for insert to authenticated with check(public.sw_member() and created_by=auth.uid());
create policy sw_document_edit on public.sw_documents for update to authenticated using(public.sw_member()) with check(public.sw_member());
create or replace function public.sw_annotation_write() returns trigger language plpgsql security definer set search_path='' as $$
declare count_pages integer;p jsonb;
begin
 if not public.sw_member() then raise exception 'Accesso non autorizzato';end if;
 if tg_op='INSERT' then
  new.created_by=auth.uid();select full_name into new.author_name from public.sw_profiles where id=auth.uid();
  new.created_at=now();new.version=1;new.deleted=false;
  if new.kind='note' then update public.sw_projects set next_note=next_note+1 where id=new.project_id returning next_note-1 into new.number;else new.number=null;end if;
 else
  if (new.id,new.project_id,new.document_id,new.page,new.kind,new.number,new.created_by,new.author_name,new.created_at) is distinct from (old.id,old.project_id,old.document_id,old.page,old.kind,old.number,old.created_by,old.author_name,old.created_at) then raise exception 'Identità annotazione non modificabile';end if;
  new.version=old.version+1;
 end if;
 select page_count into count_pages from public.sw_documents where id=new.document_id and project_id=new.project_id;
 if count_pages is null or new.page>count_pages then raise exception 'Documento o pagina non validi';end if;
 for p in select value from jsonb_array_elements(new.points) loop
  if jsonb_typeof(p)<>'array' or jsonb_array_length(p)<>2 then raise exception 'Tratto non valido';end if;
  if jsonb_typeof(p->0)<>'number' or jsonb_typeof(p->1)<>'number' then raise exception 'Coordinate non valide';end if;
  if (p->>0)::numeric not between 0 and 1 or (p->>1)::numeric not between 0 and 1 then raise exception 'Coordinate non valide';end if;
 end loop;
 new.updated_at=now();new.updated_by=auth.uid();return new;
end $$;
drop policy sw_pdf_read on storage.objects;
drop policy sw_pdf_cleanup on storage.objects;
create policy sw_pdf_read on storage.objects for select to authenticated using(bucket_id='sharework-pdfs' and public.sw_member() and (exists(select 1 from public.sw_documents d where d.file_path=name) or (storage.foldername(name))[1]=auth.uid()::text));
create policy sw_pdf_cleanup on storage.objects for delete to authenticated using(bucket_id='sharework-pdfs' and public.sw_member() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.sw_documents d where d.file_path=name));
commit;
