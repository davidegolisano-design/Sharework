begin;

alter table public.sw_profiles drop constraint sw_profiles_role_check;
alter table public.sw_profiles add constraint sw_profiles_role_check
 check(role in ('super_admin','admin','member','viewer'));

-- The previous administrators already managed user approvals.
update public.sw_profiles set role='super_admin' where role='admin' and approved;

create or replace function public.sw_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sw_profiles where id=auth.uid() and approved and role='super_admin');
$$;

create function public.sw_can_write() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sw_profiles where id=auth.uid() and approved and role in ('super_admin','admin','member'));
$$;

create function public.sw_can_configure() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sw_profiles where id=auth.uid() and approved and role in ('super_admin','admin'));
$$;

revoke all on function public.sw_can_write(),public.sw_can_configure() from public;
grant execute on function public.sw_can_write(),public.sw_can_configure() to authenticated;

create or replace function public.sw_set_approval(target uuid,allow_access boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(461785204);
 if not public.sw_admin() then raise exception 'Solo super admin'; end if;
 if target=auth.uid() then raise exception 'Non puoi modificare il tuo account'; end if;
 update public.sw_profiles set approved=allow_access where id=target;
end $$;

create function public.sw_set_role(target uuid,new_role text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(461785204);
 if not public.sw_admin() then raise exception 'Solo super admin'; end if;
 if target=auth.uid() then raise exception 'Non puoi cambiare il tuo ruolo'; end if;
 update public.sw_profiles set role=new_role where id=target;
end $$;
revoke all on function public.sw_set_role(uuid,text) from public;
grant execute on function public.sw_set_role(uuid,text) to authenticated;

alter table public.sw_documents add column ship_plan jsonb;
alter table public.sw_annotations drop constraint sw_annotations_shape_check;
alter table public.sw_annotations add constraint sw_annotations_shape_check
 check(shape in ('circle','square','diamond','triangle','flame','warning','electric','tool'));

alter policy sw_project_add on public.sw_projects with check(public.sw_can_write() and created_by=auth.uid());
alter policy sw_project_edit on public.sw_projects using(public.sw_can_write()) with check(public.sw_can_write());
alter policy sw_document_add on public.sw_documents with check(public.sw_can_write() and created_by=auth.uid() and ship_plan is null);
alter policy sw_document_edit on public.sw_documents using(public.sw_can_write()) with check(public.sw_can_write());
alter policy sw_note_add on public.sw_annotations with check(public.sw_can_write() and created_by=auth.uid());
alter policy sw_note_edit on public.sw_annotations using(public.sw_can_write()) with check(public.sw_can_write());
alter policy sw_pdf_upload on storage.objects with check(bucket_id='sharework-pdfs' and public.sw_can_write() and (storage.foldername(name))[1]=auth.uid()::text);
alter policy sw_pdf_cleanup on storage.objects using(bucket_id='sharework-pdfs' and public.sw_can_write() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.sw_documents d where d.file_path=name));

create function public.sw_validate_ship_plan() returns trigger
language plpgsql set search_path='' as $$
declare
 overview jsonb:=new.ship_plan->'overview';
 decks jsonb:=new.ship_plan->'decks';
 sheet jsonb;
 sheet_page integer;
 seen integer[]:='{}';
begin
 if new.ship_plan is not distinct from old.ship_plan then return new; end if;
 if not public.sw_can_configure() then raise exception 'Solo admin può configurare i Piani nave'; end if;
 if new.ship_plan is null then return new; end if;
 if jsonb_typeof(overview) is distinct from 'object' or jsonb_typeof(decks) is distinct from 'array' then
  raise exception 'Configurazione Piani nave non valida';
 end if;
 if jsonb_array_length(decks)=0 or jsonb_array_length(decks)>=new.page_count then
  raise exception 'Definisci almeno un ponte e una pagina longitudinale';
 end if;
 for sheet in select value from jsonb_array_elements(jsonb_build_array(overview)||decks) loop
  if jsonb_typeof(sheet->'page') is distinct from 'number'
   or jsonb_typeof(sheet->'x0') is distinct from 'number'
   or jsonb_typeof(sheet->'x1') is distinct from 'number'
   or jsonb_typeof(sheet->'frame0') is distinct from 'number'
   or jsonb_typeof(sheet->'frame1') is distinct from 'number'
   or jsonb_typeof(sheet->'meters') is distinct from 'number' then
   raise exception 'Riferimenti di calibrazione incompleti';
  end if;
  sheet_page=(sheet->>'page')::integer;
  if sheet_page not between 1 and new.page_count or sheet_page=any(seen) then raise exception 'Pagina mancante o già assegnata'; end if;
  if (sheet->>'x0')::numeric not between 0 and 1 or (sheet->>'x1')::numeric not between 0 and 1
   or abs((sheet->>'x1')::numeric-(sheet->>'x0')::numeric)<0.00001
   or (sheet->>'frame0')::numeric <> (overview->>'frame0')::numeric
   or (sheet->>'frame1')::numeric = (sheet->>'frame0')::numeric
   or (sheet->>'meters')::numeric <= 0 then raise exception 'Calibrazione non valida'; end if;
  if cardinality(seen)>0 then
   if jsonb_typeof(sheet->'base') is distinct from 'number'
    or jsonb_typeof(sheet->'name') is distinct from 'string'
    or length(btrim(sheet->>'name')) not between 1 and 80 then raise exception 'Nome o linea di base del ponte mancante'; end if;
   if (sheet->>'base')::numeric not between 0 and 1 then raise exception 'Linea di base non valida'; end if;
  end if;
  seen=array_append(seen,sheet_page);
 end loop;
 return new;
end $$;
create trigger sw_document_ship_plan before update of ship_plan on public.sw_documents
 for each row execute function public.sw_validate_ship_plan();
grant update(ship_plan) on public.sw_documents to authenticated;

create function public.sw_ship_annotation_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare plan jsonb;
begin
 if not public.sw_can_write() then raise exception 'Accesso non autorizzato'; end if;
 select ship_plan into plan from public.sw_documents where id=new.document_id for share;
 if plan is not null and not exists(
  select 1 from jsonb_array_elements(plan->'decks') as deck where (deck->>'page')::integer=new.page
 ) then raise exception 'Aggiungi annotazioni dalla pianta di un ponte configurato'; end if;
 return new;
end $$;
revoke all on function public.sw_ship_annotation_insert() from public;
-- Existing annotations stay editable. New annotations must originate on a configured deck.
create trigger sw_annotation_ship_page before insert on public.sw_annotations
 for each row execute function public.sw_ship_annotation_insert();

commit;
