begin;

create table public.sw_project_access (
 project_id uuid not null references public.sw_projects(id) on delete cascade,
 user_id uuid not null references public.sw_profiles(id) on delete cascade,
 access_level text not null check(access_level in ('edit','view')),
 primary key(project_id,user_id)
);
create index sw_project_access_user on public.sw_project_access(user_id,project_id);
alter table public.sw_project_access enable row level security;
revoke all on public.sw_project_access from anon,authenticated;
grant select,insert,update,delete on public.sw_project_access to authenticated;

create function public.sw_manage_projects() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sw_profiles where id=auth.uid() and approved and role in ('admin','super_admin'));
$$;
create function public.sw_project_level(target uuid) returns text
language sql stable security definer set search_path='' as $$
 select case p.role
  when 'super_admin' then 'edit'
  when 'admin' then 'view'
  else (select access_level from public.sw_project_access where project_id=target and user_id=p.id)
 end from public.sw_profiles p where p.id=auth.uid() and p.approved;
$$;
revoke all on function public.sw_manage_projects(),public.sw_project_level(uuid) from public;
grant execute on function public.sw_manage_projects(),public.sw_project_level(uuid) to authenticated;

create policy sw_access_read on public.sw_project_access for select to authenticated
 using((select public.sw_manage_projects()) or (user_id=(select auth.uid()) and (select public.sw_member())));
create policy sw_access_add on public.sw_project_access for insert to authenticated
 with check((select public.sw_manage_projects()) and exists(select 1 from public.sw_profiles p where p.id=user_id and p.approved and p.role in ('member','viewer')));
create policy sw_access_edit on public.sw_project_access for update to authenticated
 using((select public.sw_manage_projects()))
 with check((select public.sw_manage_projects()) and exists(select 1 from public.sw_profiles p where p.id=user_id and p.approved and p.role in ('member','viewer')));
create policy sw_access_remove on public.sw_project_access for delete to authenticated using((select public.sw_manage_projects()));

alter policy sw_profile_read on public.sw_profiles using(id=(select auth.uid()) or (select public.sw_admin()) or (approved and (select public.sw_manage_projects())));
alter policy sw_project_read on public.sw_projects using(public.sw_project_level(id) is not null);
alter policy sw_project_add on public.sw_projects with check((select public.sw_manage_projects()) and created_by=(select auth.uid()));
alter policy sw_project_edit on public.sw_projects using((select public.sw_manage_projects())) with check((select public.sw_manage_projects()));

alter policy sw_document_read on public.sw_documents using((select public.sw_admin()) or (ship_plan is not null and public.sw_project_level(project_id) is not null));
alter policy sw_document_add on public.sw_documents with check((select public.sw_admin()) and created_by=(select auth.uid()) and ship_plan is null);
alter policy sw_document_edit on public.sw_documents using((select public.sw_admin())) with check((select public.sw_admin()));
revoke update(ship_plan) on public.sw_documents from authenticated;

-- Serialize plan changes with annotation writes and preserve the old document and its notes.
create function public.sw_publish_ship_plan(target uuid, previous uuid, configuration jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare project_key uuid; current_plan uuid;
begin
 if not public.sw_admin() then raise exception 'Solo super admin'; end if;
 if configuration is null then raise exception 'Configurazione Piani nave non valida'; end if;
 select project_id into project_key from public.sw_documents where id=target;
 if project_key is null then raise exception 'Documento o pagina non validi'; end if;
 perform 1 from public.sw_projects where id=project_key for update;
 select id into current_plan from public.sw_documents where project_id=project_key and ship_plan is not null;
 if current_plan is distinct from previous then raise exception 'Il piano nave è cambiato. Riapri il progetto.'; end if;
 if current_plan is distinct from target then
  update public.sw_documents set ship_plan=null where id=current_plan;
 end if;
 update public.sw_documents set ship_plan=configuration where id=target;
end $$;
revoke all on function public.sw_publish_ship_plan(uuid,uuid,jsonb) from public;
grant execute on function public.sw_publish_ship_plan(uuid,uuid,jsonb) to authenticated;

alter policy sw_note_read on public.sw_annotations using(
 public.sw_project_level(project_id) is not null
 and exists(select 1 from public.sw_documents d where d.id=document_id and d.project_id=sw_annotations.project_id and d.ship_plan is not null)
);
alter policy sw_note_add on public.sw_annotations with check(
 public.sw_project_level(project_id)='edit' and created_by=(select auth.uid())
 and exists(select 1 from public.sw_documents d where d.id=document_id and d.project_id=sw_annotations.project_id and d.ship_plan is not null)
);
alter policy sw_note_edit on public.sw_annotations using(
 public.sw_project_level(project_id)='edit'
 and exists(select 1 from public.sw_documents d where d.id=document_id and d.project_id=sw_annotations.project_id and d.ship_plan is not null)
) with check(
 public.sw_project_level(project_id)='edit'
 and exists(select 1 from public.sw_documents d where d.id=document_id and d.project_id=sw_annotations.project_id and d.ship_plan is not null)
);

-- Use the same project/document lock order as publication and numbering.
create or replace function public.sw_ship_annotation_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare plan jsonb;
begin
 if public.sw_project_level(new.project_id) is distinct from 'edit' then raise exception 'Accesso non autorizzato'; end if;
 perform 1 from public.sw_projects where id=new.project_id for update;
 select ship_plan into plan from public.sw_documents where id=new.document_id and project_id=new.project_id for share;
 if plan is null or not exists(
  select 1 from jsonb_array_elements(plan->'decks') as deck where (deck->>'page')::integer=new.page
 ) then raise exception 'Aggiungi annotazioni dalla pianta di un ponte configurato'; end if;
 return new;
end $$;
alter trigger sw_annotation_ship_page on public.sw_annotations rename to sw_annotation_access;

alter policy sw_pdf_read on storage.objects using(bucket_id='sharework-pdfs' and exists(
 select 1 from public.sw_documents d where d.file_path=name
));
alter policy sw_pdf_upload on storage.objects with check(bucket_id='sharework-pdfs' and (select public.sw_admin()) and (storage.foldername(name))[1]=(select auth.uid())::text);
alter policy sw_pdf_cleanup on storage.objects using(bucket_id='sharework-pdfs' and (select public.sw_admin()) and (storage.foldername(name))[1]=(select auth.uid())::text and not exists(select 1 from public.sw_documents d where d.file_path=name));
-- The uploader can read newly uploaded files for upload rollback.
create policy sw_pdf_staging on storage.objects for select to authenticated using(
 bucket_id='sharework-pdfs' and (select public.sw_admin()) and (storage.foldername(name))[1]=(select auth.uid())::text
);

commit;
