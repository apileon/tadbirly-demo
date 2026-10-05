-- ============================================================
--  Tadbirly — 21: DM push notifications + red-dot badge counts
--
--  Adds three things:
--    1. A push when someone DMs you, collapsed Instagram-style
--       ("Ahmad · 4 new messages") instead of one buzz per message.
--    2. Opening a chat clears that notification.
--    3. One badge_counts() call that feeds every red dot in the app.
--
--  Safe to re-run. Does NOT touch your OneSignal keys in app_config.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Two new columns on notifications
-- ------------------------------------------------------------
-- collapse_key: notifications sharing a key replace each other on the
--   phone instead of stacking up (OneSignal calls this web_push_topic).
-- pushed_at:    when we last actually sent a push for this row, so a
--   burst of messages doesn't become a burst of buzzes.
alter table public.notifications add column if not exists collapse_key text;
alter table public.notifications add column if not exists pushed_at   timestamptz;

-- Unique, so two messages committing at the same instant can't create two
-- competing "unread" rows for the same chat.
drop index if exists public.notifications_collapse_idx;
create unique index if not exists notifications_collapse_idx
  on public.notifications (user_id, collapse_key)
  where read_at is null and collapse_key is not null;


-- ------------------------------------------------------------
-- 2. send_push(): now collapse-aware and throttled
-- ------------------------------------------------------------
create or replace function public.send_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  app_id    text;
  api_key   text;
  payload   jsonb;
  last_push timestamptz;
begin
  select value into app_id  from public.app_config where key = 'onesignal_app_id';
  select value into api_key from public.app_config where key = 'onesignal_api_key';
  if app_id is null or api_key is null
     or app_id like 'PASTE_%' or api_key like 'PASTE_%' then
    return null;
  end if;

  -- Throttle: for collapsing notifications (chats), don't fire again within
  -- 15 seconds. This deliberately looks at the whole collapse key, not just
  -- this row — when the recipient has the chat open, each message marks the
  -- old notification read and a fresh row is created, so a per-row check
  -- would let a rapid conversation buzz the phone on every single message.
  if new.collapse_key is not null then
    select max(pushed_at) into last_push
      from public.notifications
     where user_id = new.user_id
       and collapse_key = new.collapse_key
       and pushed_at > now() - interval '1 hour';
    if last_push is not null and last_push > now() - interval '15 seconds' then
      return null;
    end if;
  end if;

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

  -- Same topic = the new notification replaces the old one on the device.
  if new.collapse_key is not null then
    payload := payload || jsonb_build_object('web_push_topic', new.collapse_key);
  end if;

  perform net.http_post(
    url     := 'https://api.onesignal.com/notifications',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Key ' || api_key
               ),
    body    := payload
  );

  -- Record the send. This only changes pushed_at, so the update trigger
  -- below (which requires title/body to change) will not re-fire.
  update public.notifications set pushed_at = now() where id = new.id;

  return null;
end $$;

-- Insert trigger: unchanged behaviour, every new notification pushes.
drop trigger if exists trg_send_push on public.notifications;
create trigger trg_send_push
  after insert on public.notifications
  for each row execute function public.send_push();

-- Update trigger: lets a collapsed chat notification re-push when its
-- text changes ("1 new message" -> "4 new messages"). Deliberately does
-- NOT fire when the row is merely marked read.
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
-- 3. Notify on a new direct message
-- ------------------------------------------------------------
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ch     record;
  target uuid;
  who    text;
  n      integer;
  ckey   text;
  head   text;
  msg    text;
begin
  select * into ch from public.chats where id = new.chat_id;
  if not found then return null; end if;

  -- A chat is exactly two people; the recipient is whoever didn't send it.
  target := case when ch.participant_id = new.sender_id
                 then ch.organizer_id else ch.participant_id end;
  if target is null or target = new.sender_id then return null; end if;

  select full_name into who from public.profiles where id = new.sender_id;
  who := coalesce(nullif(who, ''), 'Someone');

  -- How many of this sender's messages in this chat are still unread.
  select count(*) into n
    from public.messages m
   where m.chat_id = new.chat_id
     and m.sender_id = new.sender_id
     and m.read_at is null;

  head := who;
  if n <= 1 then
    msg := left(coalesce(new.body, ''), 140);
  else
    msg := n || ' new messages';
  end if;

  ckey := 'chat:' || new.chat_id::text;

  -- One row per (person, chat) while it stays unread. On conflict we update
  -- instead, which re-fires the push trigger (subject to the throttle) and
  -- bumps created_at so it sorts to the top of the notification list.
  insert into public.notifications (user_id, type, title, body, link, collapse_key)
  values (target, 'message', head, msg, '/chat/' || new.chat_id::text, ckey)
  on conflict (user_id, collapse_key) where read_at is null and collapse_key is not null
  do update set title = excluded.title, body = excluded.body, created_at = now();

  return null;
end $$;

drop trigger if exists trg_notify_message on public.messages;
create trigger trg_notify_message
  after insert on public.messages
  for each row execute function public.notify_message();


-- ------------------------------------------------------------
-- 4. Opening a chat clears its notification
-- ------------------------------------------------------------
create or replace function public.mark_chat_read(c uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.messages m
     set read_at = now()
   where m.chat_id = c
     and m.sender_id <> auth.uid()
     and m.read_at is null
     and exists (
       select 1 from public.chats ch
        where ch.id = c
          and (ch.participant_id = auth.uid() or ch.organizer_id = auth.uid())
     );

  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and collapse_key = 'chat:' || c::text
     and read_at is null;
end $$;


-- ------------------------------------------------------------
-- 5. Every red dot in the app, in one round trip
-- ------------------------------------------------------------
create or replace function public.badge_counts()
returns json language sql security definer stable set search_path = public as $$
  select json_build_object(
    -- Social tab
    'messages', (
      select count(*) from public.messages m
        join public.chats c on c.id = m.chat_id
       where m.read_at is null
         and m.sender_id <> auth.uid()
         and (c.participant_id = auth.uid() or c.organizer_id = auth.uid())
    ),
    -- Portal → Requests
    'friend_requests', (
      select count(*) from public.connections
       where target_id = auth.uid() and status = 'pending'
    ),
    -- Portal → Teams (invites sent to me, and requests to join my teams)
    'team_invites', (
      select count(*) from public.team_members
       where user_id = auth.uid() and status = 'invited'
    ),
    'team_requests', (
      select count(*) from public.team_members tm
        join public.teams t on t.id = tm.team_id
       where t.owner_id = auth.uid() and tm.status = 'requested'
    ),
    -- Organizer only: teams awaiting approval
    'team_approvals', (
      select count(*) from public.teams t
       where t.status = 'pending'
         and exists (
           select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'organizer'
         )
    ),
    -- Organizer only: applications waiting on a decision
    'applications', (
      select count(*) from public.applications a
        join public.posts p on p.id = a.post_id
       where p.author_id = auth.uid() and a.status = 'pending'
    ),
    'team_applications', (
      select count(*) from public.team_applications ta
        join public.posts p on p.id = ta.post_id
       where p.author_id = auth.uid() and ta.status = 'pending'
    ),
    -- The bell
    'notifications', (
      select count(*) from public.notifications
       where user_id = auth.uid() and read_at is null
    )
  );
$$;


-- ------------------------------------------------------------
-- 6. Unread count per chat, for the per-row bubbles in the list
-- ------------------------------------------------------------
create or replace function public.unread_by_chat()
returns table (chat_id uuid, unread bigint, last_at timestamptz)
language sql security definer stable set search_path = public as $$
  select m.chat_id,
         count(*) filter (where m.read_at is null and m.sender_id <> auth.uid()) as unread,
         max(m.created_at) as last_at
    from public.messages m
    join public.chats c on c.id = m.chat_id
   where c.participant_id = auth.uid() or c.organizer_id = auth.uid()
   group by m.chat_id;
$$;

-- ------------------------------------------------------------
-- 7. Make sure the badge tables broadcast changes
-- ------------------------------------------------------------
-- The app only uses these as a "something changed, recount" signal — it never
-- reads the payload. So they deliberately keep the default replica identity
-- (primary key only). Realtime does NOT apply RLS to DELETE payloads, so
-- `replica identity full` here would broadcast whole deleted rows — the
-- friend graph, and applicants' private application messages — to anyone
-- subscribed. Do not add it.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.connections;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.team_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.applications; exception when duplicate_object then null; end;
  end if;
end $$;

grant execute on function public.badge_counts()  to authenticated;
grant execute on function public.unread_by_chat() to authenticated;
revoke execute on function public.badge_counts()  from public, anon;
revoke execute on function public.unread_by_chat() from public, anon;
