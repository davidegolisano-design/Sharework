begin;

create function public.sw_manage_users_list()
returns table(id uuid, full_name text, role text, approved boolean, email text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.sw_admin() then
  raise exception 'Solo super admin' using errcode='42501';
 end if;
 return query
  select p.id,p.full_name,p.role,p.approved,u.email::text
  from public.sw_profiles p join auth.users u on u.id=p.id
  order by p.created_at desc,p.id;
end $$;

create function public.sw_rename_user(target uuid, new_full_name text)
returns void
language plpgsql security definer set search_path='' as $$
declare clean_name text:=regexp_replace(new_full_name,'^[[:space:]]+|[[:space:]]+$','','g');
begin
 perform pg_catalog.pg_advisory_xact_lock(461785204);
 if not public.sw_admin() then
  raise exception 'Solo super admin' using errcode='42501';
 end if;
 if clean_name is null or char_length(clean_name) not between 2 and 120 then
  raise exception 'Inserisci un nome da 2 a 120 caratteri.' using errcode='22023';
 end if;
 update public.sw_profiles set full_name=clean_name where id=target;
 if not found then raise exception 'Utente non disponibile.' using errcode='P0002'; end if;
end $$;

revoke all on function public.sw_manage_users_list(), public.sw_rename_user(uuid,text) from public,anon,authenticated;
grant execute on function public.sw_manage_users_list(), public.sw_rename_user(uuid,text) to authenticated;

commit;
