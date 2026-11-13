-- Existing row-level access rules continue to protect subscription events.
do $$ declare t text; begin
 foreach t in array array['sw_projects','sw_documents','sw_annotations','sw_profiles'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
