begin;

-- Keep existing numbers and allocate the remaining numbers from each project's counter.
alter table public.sw_annotations disable trigger sw_annotation_identity;

with missing as (
 select a.id, p.next_note + row_number() over(partition by a.project_id order by a.created_at,a.id) - 1 as number
 from public.sw_annotations a
 join public.sw_projects p on p.id=a.project_id
 where a.number is null
)
update public.sw_annotations a set number=missing.number from missing where a.id=missing.id;

update public.sw_projects p set next_note=greatest(p.next_note, counts.last_number+1)
from (select project_id,max(number) as last_number from public.sw_annotations group by project_id) counts
where counts.project_id=p.id;

create or replace function public.sw_annotation_write() returns trigger language plpgsql security definer set search_path='' as $$
declare count_pages integer;p jsonb;
begin
 if not public.sw_member() then raise exception 'Accesso non autorizzato';end if;
 if tg_op='INSERT' then
  new.created_by=auth.uid();select full_name into new.author_name from public.sw_profiles where id=auth.uid();
  new.created_at=now();new.version=1;new.deleted=false;
  update public.sw_projects set next_note=next_note+1 where id=new.project_id returning next_note-1 into new.number;
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
alter table public.sw_annotations enable trigger sw_annotation_identity;
alter table public.sw_annotations alter column number set not null;

commit;
