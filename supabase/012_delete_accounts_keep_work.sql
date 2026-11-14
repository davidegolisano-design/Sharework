begin;

-- These UUIDs record past authorship. Authorization uses live profiles and
-- project assignments, which are removed by their cascading foreign keys.
alter table public.sw_annotations
 drop constraint sw_annotations_created_by_fkey,
 drop constraint sw_annotations_updated_by_fkey;
alter table public.sw_documents drop constraint sw_documents_created_by_fkey;
alter table public.sw_projects drop constraint sw_projects_created_by_fkey;

-- Match the live schema and also upgrade installations created from the original SQL.
alter table public.sw_profiles drop constraint sw_profiles_id_fkey,
 add constraint sw_profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

commit;
