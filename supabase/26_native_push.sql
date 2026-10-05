-- ============================================================
--  Tadbirly — 26: pushes for the iOS / Android app
--
--  The phone app (react-native-onesignal) uses the SAME OneSignal app
--  as the website and logs in with the same external id (the Supabase
--  user id), so send_push() already reaches it. This only changes the
--  OneSignal payload so taps behave well in the app:
--
--    url  → web_url   browsers open exactly the same page as before;
--                     the app is no longer handed a launch URL, which
--                     would open Safari / Chrome instead of the app.
--    data.link        the in-app path; the app reads it on tap
--                     (OneSignal additionalData) and navigates there.
--    collapse_id      chat notifications ("4 new messages") replace the
--                     previous one on the phone — md5(collapse_key),
--                     32 chars (limit 64). Mobile only. Still NO
--                     web_push_topic (Apple rejects it for web push).
--    ios_sound        'default' so iOS plays the normal sound.
--
--  Everything else in send_push() is the same code as 24_telegram.sql:
--  Telegram delivery, the 15-second re-alert throttle, also_push,
--  pushed_at / push_request_id / telegram_request_id stamps, and both
--  triggers. Run AFTER 24 (and 25). All-or-nothing, safe to re-run.
--
--  OneSignal Create message API fields used:
--    https://documentation.onesignal.com/reference/push-notification
--    https://documentation.onesignal.com/docs/en/links      (url/web_url/app_url)
--    https://documentation.onesignal.com/docs/en/push       (collapse_id, data)
-- ============================================================

begin;

-- Same as 24 for everyone; only the OneSignal payload differs (see top).
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

  -- 2. OneSignal (web push + iOS/Android app). Skipped only when the Telegram
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
        -- 26: web_url instead of url. Same address for browsers; the phone
        -- app gets no launch URL, so a tap opens the app (not Safari/Chrome)
        -- and lib/push.native.js navigates to data.link.
        'web_url', 'https://tadbirly.expo.app' || coalesce(new.link, ''),
        'data', jsonb_build_object('link', coalesce(new.link, '')),
        -- iOS app: play the standard sound (no custom file in the bundle).
        'ios_sound', 'default'
      );

      -- 26: chat re-alerts replace the previous banner in the phone app.
      -- collapse_id is mobile-only (max 64 chars); md5() is always 32 hex
      -- characters. Still NO web_push_topic — see above.
      if new.collapse_key is not null then
        payload := payload || jsonb_build_object('collapse_id', md5(new.collapse_key));
      end if;

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

-- Internal only (create or replace keeps the grants, this just restates it).
revoke execute on function public.send_push() from public, anon, authenticated;

commit;
