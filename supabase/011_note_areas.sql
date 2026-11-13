begin;

create function public.sw_valid_note_strokes(strokes jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare stroke jsonb; point jsonb; total integer:=0;
begin
 if jsonb_typeof(strokes)<>'array' or jsonb_array_length(strokes)>100 then return false; end if;
 for stroke in select value from jsonb_array_elements(strokes) loop
  if jsonb_typeof(stroke)<>'array' or jsonb_array_length(stroke)<2 then return false; end if;
  total=total+jsonb_array_length(stroke);
  if total>20000 then return false; end if;
  for point in select value from jsonb_array_elements(stroke) loop
   if jsonb_typeof(point)<>'array' or jsonb_array_length(point)<>2 then return false; end if;
   if jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then return false; end if;
   if (point->>0)::numeric not between 0 and 1 or (point->>1)::numeric not between 0 and 1 then return false; end if;
  end loop;
 end loop;
 return true;
end $$;

alter table public.sw_annotations add column strokes jsonb not null default '[]'
 check(public.sw_valid_note_strokes(strokes));
grant update(strokes) on public.sw_annotations to authenticated;

commit;
