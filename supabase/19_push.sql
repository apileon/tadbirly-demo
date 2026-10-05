-- ============================================================
--  Tadbirly — send a phone push for every notification
--  Uses OneSignal. Keys live in app_config, which no client can
--  read — only the security-definer function below.
--  Run once in Supabase SQL Editor, AFTER pasting your keys.
-- ============================================================

create extension if not exists pg_net;

-- Secret settings. No RLS policies at all = no client can ever read this.
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;

-- ⬇⬇ PASTE YOUR TWO ONESIGNAL KEYS HERE BEFORE RUNNING ⬇⬇
insert into public.app_config (key, value) values
  ('onesignal_app_id',  'PASTE_APP_ID_HERE'),
  ('onesignal_api_key', 'PASTE_REST_API_KEY_HERE')
on conflict (key) do update set value = excluded.value;

-- Fires on every row added to notifications and pushes it to that person's
-- phone. Silently does nothing if the keys aren't set yet.
create or replace function public.send_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  app_id  text;
  api_key text;
begin
  select value into app_id  from public.app_config where key = 'onesignal_app_id';
  select value into api_key from public.app_config where key = 'onesignal_api_key';
  if app_id is null or api_key is null
     or app_id like 'PASTE_%' or api_key like 'PASTE_%' then
    return null;
  end if;

  perform net.http_post(
    url     := 'https://api.onesignal.com/notifications',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Key ' || api_key
               ),
    body    := jsonb_build_object(
                 'app_id', app_id,
                 'target_channel', 'push',
                 'include_aliases', jsonb_build_object(
                    'external_id', jsonb_build_array(new.user_id::text)
                 ),
                 'headings', jsonb_build_object('en', new.title),
                 'contents', jsonb_build_object('en', coalesce(nullif(new.body, ''), 'Open Tadbirly')),
                 'url', 'https://tadbirly.expo.app' || coalesce(new.link, '')
               )
  );
  return null;
end $$;

drop trigger if exists trg_send_push on public.notifications;
create trigger trg_send_push
  after insert on public.notifications
  for each row execute function public.send_push();
