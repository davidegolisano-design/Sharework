begin;
create extension if not exists pg_net;

-- The shared webhook token is generated inside Vault and never sent to the web app.
select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''),'sw_registration_webhook_token')
where not exists(select 1 from vault.secrets where name='sw_registration_webhook_token');

create function public.sw_registration_mail_config(registration_id uuid, webhook_token text)
returns table(full_name text,email text,smtp_user text,smtp_password text)
language sql stable security definer set search_path='' as $$
 select p.full_name,u.email::text,
  coalesce((select decrypted_secret from vault.decrypted_secrets where name='sw_registration_smtp_user'),'sharework.reg@liveasta.it'),
  credentials.decrypted_secret
 from public.sw_profiles p join auth.users u on u.id=p.id
 join vault.decrypted_secrets credentials on credentials.name='sw_registration_smtp_password'
 where p.id=registration_id and u.email is not null
 and exists(select 1 from vault.decrypted_secrets where name='sw_registration_webhook_token' and decrypted_secret=webhook_token);
$$;
revoke all on function public.sw_registration_mail_config(uuid,text) from public,anon,authenticated;
grant execute on function public.sw_registration_mail_config(uuid,text) to service_role;

create function public.sw_queue_registration_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from vault.secrets where name='sw_registration_smtp_password') then return new; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sw_registration_webhook_token';
 if token is null then return new; end if;
 perform net.http_post(
  url:='https://jdxwwfptoeiwwrskndqi.supabase.co/functions/v1/registration-alert',
  body:=jsonb_build_object('id',new.id),
  headers:=jsonb_build_object('Content-Type','application/json','x-sharework-token',token),
  timeout_milliseconds:=25000
 );
 return new;
exception when others then
 -- A notification failure must never prevent account registration.
 raise warning 'Sharework registration alert could not be queued: %', SQLSTATE;
 return new;
end $$;
revoke all on function public.sw_queue_registration_alert() from public,anon,authenticated;
create trigger sw_registration_alert after insert on public.sw_profiles
 for each row execute function public.sw_queue_registration_alert();
commit;
