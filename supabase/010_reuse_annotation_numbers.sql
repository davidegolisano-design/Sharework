begin;

alter table public.sw_annotations drop constraint sw_annotations_project_id_number_key;
create unique index sw_active_annotation_number on public.sw_annotations(project_id,number)
 where not deleted;

create or replace function public.sw_annotation_write() returns trigger language plpgsql security definer set search_path='' as $$
declare count_pages integer;p jsonb;
begin
 if not public.sw_member() then raise exception 'Accesso non autorizzato';end if;
 if tg_op='INSERT' then
  new.created_by=auth.uid();select full_name into new.author_name from public.sw_profiles where id=auth.uid();
  new.created_at=now();new.version=1;new.deleted=false;
 else
  if (new.id,new.project_id,new.document_id,new.page,new.kind,new.number,new.created_by,new.author_name,new.created_at) is distinct from (old.id,old.project_id,old.document_id,old.page,old.kind,old.number,old.created_by,old.author_name,old.created_at) then raise exception 'Identità annotazione non modificabile';end if;
  new.version=old.version+1;
 end if;
 -- Serialize allocation with inserts and plan publication for this project.
 if tg_op='INSERT' or (old.deleted and not new.deleted) then
  perform 1 from public.sw_projects where id=new.project_id for update;
  if tg_op='INSERT' or exists(
   select 1 from public.sw_annotations
   where project_id=new.project_id and number=new.number and not deleted
  ) then
   select coalesce(min(expected) filter(where number>expected),count(*)+1)
    into new.number
    from (
     select number,row_number() over(order by number) as expected
     from public.sw_annotations
     where project_id=new.project_id and not deleted
    ) as occupied;
  end if;
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

commit;
