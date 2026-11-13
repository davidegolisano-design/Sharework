-- Run AFTER Davide has registered and confirmed his email. Never bootstrap
-- administrator privileges from a client-supplied name or unverified email.
do $$
declare account_id uuid;
begin
 select id into account_id from auth.users where lower(email)='replace-with-admin-email@example.com' and email_confirmed_at is not null;
 if account_id is null then raise exception 'Prima registra e conferma l’email di Davide';end if;
 update public.sw_profiles set role='admin',approved=true where id=account_id;
 if not found then raise exception 'Profilo Sharework non trovato';end if;
end $$;
