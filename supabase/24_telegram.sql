-- ============================================================
--  Tadbirly — 24: notifications through a Telegram bot
--
--  Most students live in Telegram, and an iPhone only gets web push
--  once Tadbirly is on its Home Screen. So any student can connect
--  their Telegram once, and from then on every notification also
--  arrives as a message from our bot — on any phone, nothing to install.
--
--  How it fits together
--    Profile → "Connect Telegram" opens t.me/<bot>?start=<one-time code>
--    → the student presses Start → Telegram calls the edge function
--    supabase/functions/telegram-webhook → telegram_handle_update() below
--    ties that chat to the account → send_push() now delivers each
--    notification to Telegram (plus web push, if they switch that on).
--
--  Run AFTER 23. All-or-nothing, safe to re-run. Re-running never
--  overwrites the bot token / username you put in.
--
--  ------------------------------------------------------------
--  SETUP  (step by step: supabase/functions/telegram-webhook/README.md)
--  ------------------------------------------------------------
--   1. Run this whole file in the Supabase SQL Editor.
--
--   2. Put in your bot's token and username — HERE, in the SQL Editor.
--      Never paste the token into a chat, a screenshot or a file you
--      commit: anyone who has it can message every connected student.
--
--        update public.app_config set value = '<token from @BotFather>'
--         where key = 'telegram_bot_token';
--        update public.app_config set value = 'tadbirly_bot'   -- no @
--         where key = 'telegram_bot_username';
--
--   3. Deploy the edge function "telegram-webhook" with Verify JWT OFF.
--
--   4. Register the webhook: run the setWebhook block at the very bottom
--      of this file (take away the -- in front of its lines first), then
--      check Telegram's answer with the query under it.
--
--  Until step 2 is done nothing changes for anyone: the Profile card
--  stays hidden and pushes work exactly as before. Setting the token
--  back to PASTE_BOT_TOKEN_HERE later switches Telegram off again, and
--  everyone falls back to web push.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Settings — in app_config, which no client can read
-- ------------------------------------------------------------
-- do nothing on conflict: re-running this file must never replace a real
-- token with the placeholder, or change the webhook secret Telegram holds.
insert into public.app_config (key, value) values
  ('telegram_bot_token',      'PASTE_BOT_TOKEN_HERE'),
  ('telegram_bot_username',   'PASTE_BOT_USERNAME_HERE'),
  -- 64 random hex characters. Telegram sends it back on every webhook call;
  -- without it nobody can pretend to be Telegram.
  ('telegram_webhook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;


-- ------------------------------------------------------------
-- 2. Which Telegram chat belongs to which account
-- ------------------------------------------------------------
create table if not exists public.telegram_links (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  chat_id   bigint not null unique,
  username  text,
  -- false: notifications go to Telegram only. true: web push as well.
  also_push boolean not null default false,
  linked_at timestamptz not null default now()
);

-- You can see your own link. Nobody can write to it directly — only the
-- functions below do.
alter table public.telegram_links enable row level security;
drop policy if exists "telegram links read own" on public.telegram_links;
create policy "telegram links read own" on public.telegram_links
  for select to authenticated using (user_id = auth.uid());


-- ------------------------------------------------------------
-- 3. One-time codes carried by the t.me link
-- ------------------------------------------------------------
-- RLS on, no policies: invisible to every client.
create table if not exists public.telegram_link_codes (
  code       text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.telegram_link_codes enable row level security;
create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes (user_id);


-- ------------------------------------------------------------
-- 4. Internal helpers (no client can call these)
-- ------------------------------------------------------------

-- A Telegram setting, or null while it's missing or still a PASTE_
-- placeholder. Only knows the three telegram_* keys, so it can never be
-- used to read the OneSignal key. Forgives the usual paste slips:
-- spaces around the token, "@tadbirly_bot", "https://t.me/tadbirly_bot".
create or replace function public.telegram_config(k text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  if k is null or k not in ('telegram_bot_token', 'telegram_bot_username', 'telegram_webhook_secret') then
    return null;
  end if;

  select btrim(value, E' \t\r\n') into v from public.app_config where key = k;
  if v is null or v = '' or starts_with(v, 'PASTE_') then
    return null;
  end if;

  if k = 'telegram_bot_username' then
    v := regexp_replace(v, '^(https?://)?(www\.)?(t|telegram)\.me/', '', 'i');
    v := ltrim(v, '@');
    if v !~ '^[A-Za-z0-9_]{5,64}$' then return null; end if;
  elsif k = 'telegram_bot_token' then
    -- 123456789:AA… — anything else is a paste accident, and would also end
    -- up inside the API URL.
    if v !~ '^[0-9]+:[A-Za-z0-9_-]{20,}$' then return null; end if;
  end if;

  return v;
end $$;

-- Text for Telegram's HTML mode: only & < > need escaping outside tags.
create or replace function public.tg_escape(t text)
returns text language sql immutable security definer set search_path = public as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- Queues one bot message (pg_net sends it right after the transaction
-- commits) and returns the pg_net request id — Telegram's answer shows up
-- in net._http_response under that id. Null, and nothing sent, while the
-- bot token isn't set.
--   html        — already escaped with tg_escape() wherever user text goes in
--   button_url  — adds one "open this" button under the message
create or replace function public.telegram_send(
  chat bigint,
  html text,
  button_text text default null,
  button_url  text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  token   text := public.telegram_config('telegram_bot_token');
  payload jsonb;
begin
  if token is null or chat is null or coalesce(btrim(html), '') = '' then
    return null;
  end if;

  payload := jsonb_build_object(
    'chat_id', chat,
    'text', html,
    'parse_mode', 'HTML',
    -- Old and new (Bot API 7.0+) spelling of "no link preview". Telegram
    -- uses the new one when both are there.
    'disable_web_page_preview', true,
    'link_preview_options', jsonb_build_object('is_disabled', true)
  );

  if button_url is not null and coalesce(btrim(button_text), '') <> '' then
    payload := payload || jsonb_build_object(
      'reply_markup', jsonb_build_object(
        'inline_keyboard', jsonb_build_array(jsonb_build_array(
          jsonb_build_object('text', button_text, 'url', button_url)
        ))
      )
    );
  end if;

  return net.http_post(
    url     := 'https://api.telegram.org/bot' || token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := payload
  );
end $$;


-- ------------------------------------------------------------
-- 5. What the Profile screen calls
-- ------------------------------------------------------------

-- A fresh t.me link with a one-time code: 32 hex characters, fine for
-- Telegram's start parameter (A-Z a-z 0-9 _ -, up to 64). Single use,
-- valid for one hour.
--
-- The app fetches this link BEFORE the tap (a browser only lets a tap open
-- a new tab if nothing is awaited first), and again after each tap so the
-- next one is fresh. So a person's newer codes must not cancel their older
-- ones — the one they just opened in Telegram may not have been used yet.
-- Instead: codes expire after an hour, a person keeps at most their five
-- newest, and linking spends all of them at once.
create or replace function public.telegram_link_start()
returns json language plpgsql security definer set search_path = public as $$
declare
  me       uuid := auth.uid();
  bot      text := public.telegram_config('telegram_bot_username');
  new_code text;
begin
  if me is null then
    raise exception 'Please sign in again to connect Telegram';
  end if;
  if bot is null or public.telegram_config('telegram_bot_token') is null then
    raise exception 'Telegram notifications aren''t available yet — please try again later';
  end if;

  delete from public.telegram_link_codes
   where created_at < now() - interval '1 hour';

  delete from public.telegram_link_codes c
   where c.user_id = me
     and c.code not in (
       select k.code from public.telegram_link_codes k
        where k.user_id = me
        order by k.created_at desc
        limit 4
     );

  new_code := replace(gen_random_uuid()::text, '-', '');
  insert into public.telegram_link_codes (code, user_id) values (new_code, me);

  return json_build_object('url', 'https://t.me/' || bot || '?start=' || new_code);
end $$;

-- { available, linked, username, also_push }. available = the bot is set up,
-- so the app knows whether to show the Telegram card at all.
create or replace function public.telegram_status()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  lk public.telegram_links;
begin
  if auth.uid() is not null then
    select * into lk from public.telegram_links where user_id = auth.uid();
  end if;

  return json_build_object(
    'available', public.telegram_config('telegram_bot_username') is not null
                 and public.telegram_config('telegram_bot_token') is not null,
    'linked',    lk.user_id is not null,
    'username',  lk.username,
    'also_push', coalesce(lk.also_push, false)
  );
end $$;

-- "Disconnect" in the app. Tells the chat, so it doesn't just go quiet.
create or replace function public.telegram_unlink()
returns void language plpgsql security definer set search_path = public as $$
declare
  old_chat bigint;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again';
  end if;

  delete from public.telegram_links
   where user_id = auth.uid()
  returning chat_id into old_chat;

  if old_chat is not null then
    perform public.telegram_send(old_chat,
      'Disconnected from Tadbirly — notifications won''t arrive here any more.'
      || E'\n\n' || 'To reconnect: Tadbirly → Profile → Connect Telegram.');
  end if;
end $$;

-- The "Also send browser notifications" switch.
create or replace function public.telegram_set_also_push(v boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.telegram_links
     set also_push = coalesce(v, false)
   where user_id = auth.uid();
  if not found then
    raise exception 'Telegram isn''t connected';
  end if;
end $$;


-- ------------------------------------------------------------
-- 6. Everything the bot receives (via the telegram-webhook edge function)
-- ------------------------------------------------------------
-- The edge function calls this with the public anon key, so ANYONE can call
-- it — the webhook secret is the gate: without the exact secret Telegram was
-- given in setWebhook, it returns without reading anything else.
--
-- It never raises. An error would make the edge function's call fail, and a
-- webhook that fails gets the same update re-sent by Telegram over and over.
create or replace function public.telegram_handle_update(u jsonb, secret text)
returns void language plpgsql security definer set search_path = public as $$
declare
  expected   text;
  msg        jsonb;
  chat       bigint;
  txt        text;
  cmd        text;
  arg        text;
  uname      text;
  link_user  uuid;
  made_at    timestamptz;
  greet_name text;
  prev_chat  bigint;
  home       constant text := 'https://tadbirly.expo.app';
begin
  expected := public.telegram_config('telegram_webhook_secret');
  if expected is null or secret is null or secret <> expected then
    return;
  end if;

  begin
    -- They blocked the bot ("Stop and block"). Messages to them now fail, and
    -- a linked account doesn't get web push by default, so unlink — from then
    -- on their notifications go through web push again.
    if jsonb_typeof(u -> 'my_chat_member') = 'object' then
      if (u #>> '{my_chat_member,chat,type}') = 'private'
         and (u #>> '{my_chat_member,new_chat_member,status}') in ('kicked', 'left') then
        delete from public.telegram_links
         where chat_id = (u #>> '{my_chat_member,chat,id}')::bigint;
      end if;
      return;
    end if;

    -- Only messages in a one-to-one chat with the bot; groups are ignored.
    msg := u -> 'message';
    if jsonb_typeof(msg) is distinct from 'object'
       or (msg #>> '{chat,type}') is distinct from 'private' then
      return;
    end if;
    chat := (msg #>> '{chat,id}')::bigint;
    if chat is null then
      return;
    end if;

    txt   := btrim(coalesce(msg ->> 'text', ''));
    -- "/start@tadbirly_bot abc" → cmd '/start', arg 'abc'
    cmd   := lower(split_part(coalesce(substring(txt from '^\S+'), ''), '@', 1));
    arg   := btrim(coalesce(substring(txt from '^\S+\s+(.*)$'), ''));
    uname := nullif(btrim(coalesce(msg #>> '{from,username}', '')), '');

    -- ---------- /start <code>: the link from the Profile screen ----------
    if cmd = '/start' and arg <> '' then
      select c.user_id, c.created_at
        into link_user, made_at
        from public.telegram_link_codes c
       where c.code = arg
       for update;                       -- a double tap / re-sent update waits here

      if link_user is null or made_at < now() - interval '1 hour' then
        delete from public.telegram_link_codes where code = arg;
        perform public.telegram_send(chat,
          'This link has expired or was already used.'
          || E'\n\n' || 'Get a new one in Tadbirly: Profile → Connect Telegram.'
          || case when exists (select 1 from public.telegram_links l where l.chat_id = chat)
                  then E'\n\n' || 'This chat is still connected ✅'
                  else '' end,
          'Open Tadbirly', home || '/profile');
        return;
      end if;

      -- This Telegram chat was connected to a different Tadbirly account
      -- (a shared phone): it moves to this one.
      delete from public.telegram_links l
       where l.chat_id = chat and l.user_id <> link_user;

      -- Was this account connected to another Telegram chat before?
      select l.chat_id into prev_chat
        from public.telegram_links l where l.user_id = link_user;

      -- also_push starts false on a first link and is kept on a re-link.
      insert into public.telegram_links (user_id, chat_id, username, also_push, linked_at)
      values (link_user, chat, uname, false, now())
      on conflict (user_id) do update
        set chat_id   = excluded.chat_id,
            username  = excluded.username,
            linked_at = excluded.linked_at;

      -- Spent: this code, and every other link this person still had open.
      delete from public.telegram_link_codes where user_id = link_user;

      -- Tell the old chat, so a hijacked link is noticed rather than silent.
      if prev_chat is not null and prev_chat <> chat then
        perform public.telegram_send(prev_chat,
          'Your Tadbirly account was just connected to a different Telegram account, '
          || 'so notifications won''t arrive here any more.');
      end if;

      select split_part(btrim(coalesce(p.full_name, '')), ' ', 1)
        into greet_name
        from public.profiles p where p.id = link_user;

      perform public.telegram_send(chat,
        '✅ Connected'
        || case when coalesce(greet_name, '') <> '' then ', ' || public.tg_escape(greet_name) else '' end
        || '! Your Tadbirly notifications will arrive here.'
        || E'\n\n' || 'Send /stop to disconnect.',
        'Open Tadbirly', home || '/profile');
      return;
    end if;

    -- ---------- /start on its own (or /help) ----------
    if cmd in ('/start', '/help') then
      if exists (select 1 from public.telegram_links l where l.chat_id = chat) then
        perform public.telegram_send(chat,
          '👋 This chat is connected to Tadbirly — your notifications arrive here.'
          || E'\n\n' || 'Send /stop to disconnect.',
          'Open Tadbirly', home);
      else
        perform public.telegram_send(chat,
          '👋 Hi! I bring your Tadbirly notifications — friend requests, messages, acceptances — to Telegram.'
          || E'\n\n' || 'To switch them on: open Tadbirly → Profile → <b>Connect Telegram</b>.',
          'Open Tadbirly', home || '/profile');
      end if;
      return;
    end if;

    -- ---------- /stop ----------
    if cmd = '/stop' then
      delete from public.telegram_links l
       where l.chat_id = chat
      returning l.user_id into link_user;

      perform public.telegram_send(chat,
        case when link_user is not null
             then 'Disconnected. You won''t get Tadbirly notifications here any more.'
                  || E'\n\n' || 'To reconnect: Tadbirly → Profile → Connect Telegram.'
             else 'This chat isn''t connected to a Tadbirly account.'
        end);
      return;
    end if;

    -- ---------- anything else ----------
    -- Keep the "Connected as @username" line in the app current.
    update public.telegram_links l
       set username = uname
     where l.chat_id = chat and l.username is distinct from uname;

    perform public.telegram_send(chat,
      'I only deliver notifications, so I can''t pass replies on. To answer, open Tadbirly.',
      'Open Tadbirly', home);

  exception when others then
    -- Anything unexpected (a malformed update, a race) is dropped quietly;
    -- whatever this update had changed is rolled back with it.
    raise warning 'telegram_handle_update: % (%)', sqlerrm, sqlstate;
  end;
end $$;


-- ------------------------------------------------------------
-- 7. send_push(): Telegram first, then OneSignal as before
-- ------------------------------------------------------------
-- Telegram's answer for each notification, next to OneSignal's:
--   select n.type, r.status_code, r.content
--     from notifications n join net._http_response r on r.id = n.telegram_request_id
--    order by n.created_at desc limit 10;
alter table public.notifications add column if not exists telegram_request_id bigint;

-- Same as 23 for everyone without Telegram: same throttle, same OneSignal
-- payload (still no web_push_topic), same pushed_at / push_request_id stamp.
-- For a connected account the notification also goes to their chat, and web
-- push is skipped unless they switched "Also send browser notifications" on.
create or replace function public.send_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  app_id  text;
  api_key text;
  payload jsonb;
  req_id  bigint;
  tl      public.telegram_links;
  tl_req  bigint;
  head    text;
  txt     text;
  html    text;
begin
  -- A brand-new notification always goes out. Only a re-alert of a row that's
  -- still unread ("1 new message" -> "4 new messages") is held back, so a
  -- burst of messages is one buzz every 15 seconds, not one per message.
  if tg_op = 'UPDATE'
     and old.pushed_at is not null
     and old.pushed_at > now() - interval '15 seconds' then
    return null;
  end if;

  -- 1. Telegram, for anyone who connected it.
  select * into tl from public.telegram_links where user_id = new.user_id;
  if tl.chat_id is not null then
    -- Its own block: a Telegram problem must never stop the notification —
    -- or the message / friend request that created it — from being saved.
    begin
      head := coalesce(nullif(btrim(new.title), ''), 'Tadbirly');
      if char_length(head) > 200 then head := left(head, 199) || '…'; end if;
      txt := btrim(coalesce(new.body, ''));
      if char_length(txt) > 1000 then txt := left(txt, 999) || '…'; end if;

      html := '<b>' || public.tg_escape(head) || '</b>';
      if txt <> '' then
        html := html || E'\n' || public.tg_escape(txt);
      end if;

      -- Same address the web push opens. Only an app path is appended, so a
      -- bad link can't make Telegram reject the whole message.
      tl_req := public.telegram_send(
        tl.chat_id, html, 'Open in Tadbirly',
        'https://tadbirly.expo.app' || case when new.link ~ '^/\S*$' then new.link else '' end
      );
    exception when others then
      tl_req := null;
      raise warning 'send_push: Telegram message not queued: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  -- 2. OneSignal (web push) — unchanged. Skipped only when the Telegram
  --    message was actually queued and they haven't asked for both; if the
  --    bot is switched off (token back to PASTE_), everyone gets web push.
  if tl_req is null or tl.also_push then
    select value into app_id  from public.app_config where key = 'onesignal_app_id';
    select value into api_key from public.app_config where key = 'onesignal_api_key';
    if app_id is not null and api_key is not null
       and app_id not like 'PASTE_%' and api_key not like 'PASTE_%' then

      -- Deliberately NO web_push_topic. DM notifications used 'chat:<uuid>'
      -- (41 chars with a colon); web push only allows 32 URL-safe characters
      -- and Apple rejects anything else with 400 BadWebPushTopic — which is
      -- why friend requests reached iPhones and DMs didn't. iPhones ignore
      -- notification replacement anyway, so nothing is lost.
      payload := jsonb_build_object(
        'app_id', app_id,
        'target_channel', 'push',
        'include_aliases', jsonb_build_object(
           'external_id', jsonb_build_array(new.user_id::text)
        ),
        'headings', jsonb_build_object('en', new.title),
        'contents', jsonb_build_object('en', coalesce(nullif(new.body, ''), 'Open Tadbirly')),
        'url', 'https://tadbirly.expo.app' || coalesce(new.link, '')
      );

      req_id := net.http_post(
        url     := 'https://api.onesignal.com/notifications',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Key ' || api_key
                   ),
        body    := payload
      );
    end if;
  end if;

  -- Nothing went out (no Telegram, OneSignal keys not set): leave the row alone.
  if tl_req is null and req_id is null then
    return null;
  end if;

  -- Only pushed_at / push_request_id / telegram_request_id change, so the
  -- update trigger below (which needs title or body to change) does not
  -- fire again.
  update public.notifications
     set pushed_at = now(),
         push_request_id = req_id,
         telegram_request_id = tl_req
   where id = new.id;

  return null;
end $$;

drop trigger if exists trg_send_push on public.notifications;
create trigger trg_send_push
  after insert on public.notifications
  for each row execute function public.send_push();

drop trigger if exists trg_send_push_update on public.notifications;
create trigger trg_send_push_update
  after update on public.notifications
  for each row
  when (
    new.read_at is null
    and (new.title is distinct from old.title or new.body is distinct from old.body)
  )
  execute function public.send_push();


-- ------------------------------------------------------------
-- 8. Who may call what
-- ------------------------------------------------------------
-- Supabase gives anon + authenticated EXECUTE on every new function in
-- public by default, so each one is closed first, then opened as needed.

-- Internal only. (A trigger needs no EXECUTE grant to fire.)
revoke execute on function public.telegram_config(text)                    from public, anon, authenticated;
revoke execute on function public.tg_escape(text)                          from public, anon, authenticated;
revoke execute on function public.telegram_send(bigint, text, text, text)  from public, anon, authenticated;
revoke execute on function public.send_push()                              from public, anon, authenticated;

-- The Profile screen: signed-in users only.
revoke execute on function public.telegram_link_start()             from public, anon;
revoke execute on function public.telegram_status()                 from public, anon;
revoke execute on function public.telegram_unlink()                 from public, anon;
revoke execute on function public.telegram_set_also_push(boolean)   from public, anon;
grant  execute on function public.telegram_link_start()             to authenticated;
grant  execute on function public.telegram_status()                 to authenticated;
grant  execute on function public.telegram_unlink()                 to authenticated;
grant  execute on function public.telegram_set_also_push(boolean)   to authenticated;

-- The webhook: called by the edge function with the anon key. The secret
-- inside is what protects it.
revoke execute on function public.telegram_handle_update(jsonb, text) from public;
grant  execute on function public.telegram_handle_update(jsonb, text) to anon, authenticated;

-- Let the API see the new functions straight away.
notify pgrst, 'reload schema';

commit;


-- ============================================================
--  AFTER DEPLOYING THE EDGE FUNCTION: register the webhook
--
--  Take away the "-- " in front of the next block's lines, select just that
--  block, and Run. It reads the token and secret from app_config (cleaned up
--  exactly as the bot uses them), so they never have to be typed or pasted
--  anywhere else.
--
--  allowed_updates: 'message' for /start and /stop, 'my_chat_member' so that
--  a student who blocks the bot is unlinked (and gets web push again).
-- ============================================================
-- select net.http_post(
--   url     := 'https://api.telegram.org/bot'
--              || coalesce(public.telegram_config('telegram_bot_token'), 'TOKEN-NOT-SET')
--              || '/setWebhook',
--   headers := '{"Content-Type": "application/json"}'::jsonb,
--   body    := jsonb_build_object(
--     'url',             'https://mezvvxosdcddninqgvjz.supabase.co/functions/v1/telegram-webhook',
--     'secret_token',    public.telegram_config('telegram_webhook_secret'),
--     'allowed_updates', jsonb_build_array('message', 'my_chat_member')
--   )
-- ) as request_id;
--
-- It returns a number (request_id). A few seconds later, read Telegram's
-- answer with that number in place of 12345. You want status 200 and
--   {"ok":true,"result":true,"description":"Webhook was set"}
-- (or "Webhook is already set"). No row yet? Wait a moment, run it again.
-- 401 Unauthorized / 404 Not Found = the token in app_config is wrong.
--
-- select status_code, content from net._http_response where id = 12345;
