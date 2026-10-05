-- ============================================================
--  Tadbirly — 23: DM pushes that reach iPhones + security fixes
--
--  Run AFTER 21 and 22. All-or-nothing: if any line fails, nothing
--  changes. Safe to re-run. Adapts to your live database: parts that
--  depend on an older file you may not have run are skipped cleanly.
--
--  PART A  Push: DM notifications stop being rejected by Apple
--  PART B  Security: closes the holes found in the full audit
--  PART C  Notifications: fewer duplicates, links open the right tab
-- ============================================================

begin;

-- ============================================================
-- PART A — PUSH
-- ============================================================

-- Lets you see OneSignal's reply for each notification:
--   select n.type, r.status_code, r.content
--     from notifications n join net._http_response r on r.id = n.push_request_id
--    order by n.created_at desc limit 10;
alter table public.notifications add column if not exists push_request_id bigint;

create or replace function public.send_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  app_id  text;
  api_key text;
  payload jsonb;
  req_id  bigint;
begin
  select value into app_id  from public.app_config where key = 'onesignal_app_id';
  select value into api_key from public.app_config where key = 'onesignal_api_key';
  if app_id is null or api_key is null
     or app_id like 'PASTE_%' or api_key like 'PASTE_%' then
    return null;
  end if;

  -- A brand-new notification always pushes. Only a re-alert of a row that's
  -- still unread ("1 new message" -> "4 new messages") is held back, so a
  -- burst of messages is one buzz every 15 seconds, not one per message.
  if tg_op = 'UPDATE'
     and old.pushed_at is not null
     and old.pushed_at > now() - interval '15 seconds' then
    return null;
  end if;

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

  -- Only pushed_at / push_request_id change, so the update trigger below
  -- (which needs title or body to change) does not fire again.
  update public.notifications
     set pushed_at = now(), push_request_id = req_id
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

-- DM notification: presence window 30s -> 20s (the chat screen now sends a
-- heartbeat every 8s, and only while you're actually looking at it).
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ch     record;
  target uuid;
  who    text;
  n      integer;
  ckey   text;
  msg    text;
begin
  select * into ch from public.chats where id = new.chat_id;
  if not found then return null; end if;

  target := case when ch.participant_id = new.sender_id
                 then ch.organizer_id else ch.participant_id end;
  if target is null or target = new.sender_id then return null; end if;

  -- Looking at this chat right now: the message is already on screen.
  if exists (
    select 1 from public.chat_presence p
     where p.chat_id = new.chat_id
       and p.user_id = target
       and p.seen_at > now() - interval '20 seconds'
  ) then
    return null;
  end if;

  select full_name into who from public.profiles where id = new.sender_id;
  who := coalesce(nullif(who, ''), 'Someone');

  select count(*) into n
    from public.messages m
   where m.chat_id = new.chat_id
     and m.sender_id = new.sender_id
     and m.read_at is null;

  if n <= 1 then
    msg := coalesce(new.body, '');
    if char_length(msg) > 140 then msg := left(msg, 139) || '…'; end if;
  else
    msg := n || ' new messages';
  end if;

  ckey := 'chat:' || new.chat_id::text;

  insert into public.notifications (user_id, type, title, body, link, collapse_key)
  values (target, 'message', who, msg, '/chat/' || new.chat_id::text, ckey)
  on conflict (user_id, collapse_key) where read_at is null and collapse_key is not null
  do update set title = excluded.title, body = excluded.body, created_at = now();

  return null;
end $$;


-- ============================================================
-- PART B — SECURITY
-- ============================================================

-- ---------- B1. Profiles: trust fields can't be self-edited ----------
-- Before: only role and verified_student were protected. A student could
-- set their own reliability to 100 with one API call.
-- Reliability is still recomputed normally when an organizer awards
-- someone, because that edit is made on a different person's row.
create or replace function public.freeze_trust_fields()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.role             := old.role;
    new.verified_student := old.verified_student;
    if auth.uid() = new.id then
      new.reliability      := old.reliability;
      new.is_pro           := old.is_pro;
      new.posts_this_month := old.posts_this_month;
      new.streak_count     := old.streak_count;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists freeze_trust_fields on public.profiles;
create trigger freeze_trust_fields
  before update on public.profiles
  for each row execute function public.freeze_trust_fields();

-- ---------- B2. Profiles are no longer readable without logging in ----------
-- Before: phone numbers, Telegram handles and test scores of every student
-- could be downloaded with the public key alone, no account needed.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (true);

-- ---------- B3. Applications: students can't accept themselves ----------
-- Before: an applicant could create their application as "accepted", or
-- flip it to accepted afterwards — skipping the organizer entirely and
-- getting into the event's group chat.
drop policy if exists "apps insert" on public.applications;
create policy "apps insert" on public.applications for insert with check (
  auth.uid() = applicant_id
  and status = 'pending'
  and checked_in = false
);

drop policy if exists "apps update" on public.applications;
create policy "apps update" on public.applications for update
  using (public.is_event_organizer(post_id))
  with check (public.is_event_organizer(post_id));

-- ---------- B4. Teams: approval can't be skipped ----------
-- Before: the update was locked, but a team could be CREATED as "approved".
-- (Only applies if team approval — file 15 — is installed.)
do $do$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'teams' and column_name = 'approved_at')
     and to_regprocedure('public.is_organizer()') is not null then

    execute $sql$
      create or replace function public.protect_team_status_on_insert()
      returns trigger language plpgsql security definer set search_path = public as $fn$
      begin
        if auth.uid() is not null and not public.is_organizer() then
          new.status      := 'pending';
          new.approved_by := null;
          new.approved_at := null;
        end if;
        return new;
      end $fn$;
    $sql$;

    execute 'drop trigger if exists protect_team_status_on_insert on public.teams';
    execute 'create trigger protect_team_status_on_insert
               before insert on public.teams
               for each row execute function public.protect_team_status_on_insert()';

    -- B16 (moved here, same dependency). Organizers can delete their account:
    -- approving a team left a reference that blocked account deletion, which
    -- Apple requires to work.
    execute 'alter table public.teams drop constraint if exists teams_approved_by_fkey';
    execute 'alter table public.teams add constraint teams_approved_by_fkey
               foreign key (approved_by) references public.profiles(id) on delete set null';
  end if;
end $do$;

-- ---------- B5. Team membership: no joining without consent ----------
-- Before: anyone could add themselves to any team as an accepted member,
-- or approve their own join request.
drop policy if exists "tm insert" on public.team_members;
create policy "tm insert" on public.team_members for insert with check (
  -- asking to join
  (auth.uid() = user_id and status = 'requested')
  -- the owner adding themselves when creating the team
  or (auth.uid() = user_id and status = 'accepted'
      and auth.uid() = (select owner_id from public.teams t where t.id = team_id))
  -- the owner inviting someone
  or (status = 'invited'
      and auth.uid() = (select owner_id from public.teams t where t.id = team_id))
);

create or replace function public.protect_team_member_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  team_owner uuid;
begin
  if auth.uid() is null then return new; end if;          -- dashboard / SQL editor

  if new.team_id is distinct from old.team_id or new.user_id is distinct from old.user_id then
    raise exception 'A team membership cannot be moved to another team or person';
  end if;

  select t.owner_id into team_owner from public.teams t where t.id = new.team_id;
  if auth.uid() = team_owner then return new; end if;     -- the owner decides

  -- Everyone else may only answer an invite, or step away.
  if new.status is distinct from old.status
     and not (old.status = 'invited' and new.status in ('accepted', 'declined'))
     and new.status <> 'declined' then
    raise exception 'Only the team owner can approve a join request';
  end if;
  return new;
end $$;

drop trigger if exists protect_team_member_status on public.team_members;
create trigger protect_team_member_status
  before update on public.team_members
  for each row execute function public.protect_team_member_status();

-- ---------- B6. Team applications: only the organizer decides ----------
-- Applications always start as "pending". If team approval (file 15) is
-- installed, only approved teams may apply — as before.
do $do$
begin
  execute 'drop policy if exists "tapp insert" on public.team_applications';
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'teams' and column_name = 'status') then
    execute $sql$
      create policy "tapp insert" on public.team_applications for insert with check (
        applied_by = auth.uid()
        and status = 'pending'
        and public.is_team_owner(team_id)
        and exists (select 1 from public.teams t where t.id = team_id and t.status = 'approved')
      )
    $sql$;
  else
    execute $sql$
      create policy "tapp insert" on public.team_applications for insert with check (
        applied_by = auth.uid()
        and status = 'pending'
        and public.is_team_owner(team_id)
      )
    $sql$;
  end if;
end $do$;

create or replace function public.protect_team_application_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and new.status is distinct from old.status
     and not public.is_event_organizer(new.post_id) then
    raise exception 'Only the event organizer can accept or reject a team';
  end if;
  return new;
end $$;

drop trigger if exists protect_team_application_status on public.team_applications;
create trigger protect_team_application_status
  before update on public.team_applications
  for each row execute function public.protect_team_application_status();

-- ---------- B7. Friend requests: only the receiver can accept ----------
-- Before: the sender could mark their own request "accepted" and force a
-- friendship (and a DM chat) on someone.
-- plpgsql (not sql) on purpose: if the blocks table isn't installed yet,
-- nobody is blocked, instead of the whole migration failing.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.blocks') is null then return false; end if;
  return exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
end $$;

create or replace function public.protect_connection()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  -- The two people in a request never change.
  if not ((new.requester_id = old.requester_id and new.target_id = old.target_id)
       or (new.requester_id = old.target_id and new.target_id = old.requester_id)) then
    raise exception 'A friend request cannot be moved to other people';
  end if;

  -- Re-sending after a decline: the person re-sending becomes the requester.
  if old.status = 'declined' and new.status = 'pending' then
    if new.requester_id <> auth.uid() then
      raise exception 'You can only re-send your own request';
    end if;
    if public.is_blocked_between(new.requester_id, new.target_id) then
      raise exception 'You can''t send a request to this person';
    end if;
    return new;
  end if;

  if new.requester_id <> old.requester_id then
    raise exception 'A friend request cannot change direction';
  end if;

  if new.status = 'accepted' and old.status is distinct from 'accepted'
     and auth.uid() <> old.target_id then
    raise exception 'Only the person who received the request can accept it';
  end if;

  return new;
end $$;

drop trigger if exists protect_connection on public.connections;
create trigger protect_connection
  before update on public.connections
  for each row execute function public.protect_connection();

-- ---------- B8. Blocking actually blocks ----------
-- Before: blocking only hid someone's events from your feed. They could
-- still message you and send friend requests.
drop policy if exists "conn insert" on public.connections;
create policy "conn insert" on public.connections for insert with check (
  auth.uid() = requester_id
  and status = 'pending'
  and not public.is_blocked_between(requester_id, target_id)
);

drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages for insert with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.chats c
     where c.id = chat_id
       and (c.participant_id = auth.uid() or c.organizer_id = auth.uid())
       and not public.is_blocked_between(c.participant_id, c.organizer_id)
  )
);

-- ---------- B9. Event medals: only that event's organizer ----------
do $do$
begin
  if to_regclass('public.badges') is not null then
    execute 'drop policy if exists "badges insert" on public.badges';
    execute $sql$
      create policy "badges insert" on public.badges for insert with check (
        auth.uid() = organizer_id and public.is_event_organizer(post_id)
      )
    $sql$;
    execute 'drop policy if exists "badges update" on public.badges';
    execute $sql$
      create policy "badges update" on public.badges for update using (
        auth.uid() = organizer_id and public.is_event_organizer(post_id)
      )
    $sql$;
  end if;
end $do$;

-- ---------- B10. Points can't be absurd ----------
-- Checked when an award is given or its points change. Existing awards
-- are left exactly as they are (a table constraint would also re-check
-- them every time a student pins a medal).
create or replace function public.check_award_points()
returns trigger language plpgsql as $$
begin
  if new.points is not null and (new.points < 0 or new.points > 100) then
    raise exception 'Points must be between 0 and 100';
  end if;
  return new;
end $$;

do $do$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'awards' and column_name = 'points') then
    execute 'drop trigger if exists check_award_points on public.awards';
    execute 'create trigger check_award_points
               before insert or update of points on public.awards
               for each row execute function public.check_award_points()';
  end if;
end $do$;

-- ---------- B11. Moderation flag is enforced ----------
-- (Only if the moderation column — file 02 — is installed.)
do $do$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'posts' and column_name = 'moderation') then
    execute 'drop policy if exists "posts read" on public.posts';
    execute $sql$
      create policy "posts read" on public.posts for select
        using (moderation <> 'removed' or auth.uid() = author_id)
    $sql$;

    execute $sql$
      create or replace function public.protect_post_moderation()
      returns trigger language plpgsql as $fn$
      begin
        if auth.uid() is not null then
          new.moderation := old.moderation;   -- only you, from the dashboard, can change it
        end if;
        return new;
      end $fn$;
    $sql$;

    execute 'drop trigger if exists protect_post_moderation on public.posts';
    execute 'create trigger protect_post_moderation
               before update on public.posts
               for each row execute function public.protect_post_moderation()';
  end if;
end $do$;

-- ---------- B12. Server functions nobody should call directly ----------
-- Before: any logged-in student (or even a logged-out visitor) could call
-- push_notification and send a real push with any text to anyone's phone.
-- The notification triggers still use it internally, so nothing breaks.
-- Each one is only touched if it exists in your database.
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.push_notification(uuid, text, text, text, text)',
    'public.recompute_reliability(uuid)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;

  -- Social lookups: logged-in users only.
  foreach f in array array[
    'public.friends_of(uuid)',
    'public.mutual_friends(uuid)',
    'public.recent_events_of(uuid, integer)',
    'public.user_results(uuid)',
    'public.event_roster(uuid)',
    'public.leaderboard(integer)',
    'public.my_points()',
    'public.is_blocked_between(uuid, uuid)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $do$;

-- ---------- B13. Deleted messages no longer broadcast their text ----------
-- Realtime doesn't apply row security to deletions; with "full" identity
-- the whole deleted message — text included — went to every listener.
-- The app only needs the id, which the default identity still sends.
alter table public.messages replica identity default;
do $do$
begin
  if to_regclass('public.event_messages') is not null then
    execute 'alter table public.event_messages replica identity default';
  end if;
end $do$;

-- ---------- B14. Uploads: images only, 5 MB max ----------
update storage.buckets
   set file_size_limit    = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id in ('avatars', 'covers', 'news');

-- ---------- B15. Message length limits (new messages only) ----------
-- Insert-only on purpose: marking old messages read updates them, and a
-- table constraint would re-check (and could reject) those old rows.
create or replace function public.check_message_body()
returns trigger language plpgsql as $$
begin
  if new.body is null or char_length(btrim(new.body)) = 0 then
    raise exception 'Message is empty';
  end if;
  if char_length(new.body) > 4000 then
    raise exception 'Message is too long (4000 characters max)';
  end if;
  return new;
end $$;

drop trigger if exists check_message_body on public.messages;
create trigger check_message_body
  before insert on public.messages
  for each row execute function public.check_message_body();

do $do$
begin
  if to_regclass('public.event_messages') is not null then
    execute 'drop trigger if exists check_message_body on public.event_messages';
    execute 'create trigger check_message_body
               before insert on public.event_messages
               for each row execute function public.check_message_body()';
  end if;
end $do$;

-- ---------- B16. Organizers can delete their account ----------
-- (Handled together with B4 above, since it needs the same file.)


-- ============================================================
-- PART C — NOTIFICATIONS
-- ============================================================

-- Friend requests: open straight onto Portal → Requests; a request from
-- someone who once declined you notifies (a repeat from the same sender
-- after being declined does not — that would be a harassment vector).
create or replace function public.notify_connection()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.status = 'pending' and old.status = 'declined'
         and new.requester_id <> old.requester_id) then
    select full_name into who from public.profiles where id = new.requester_id;
    perform public.push_notification(new.target_id, 'friend_request',
      coalesce(who, 'Someone') || ' wants to be your friend',
      'Tap to accept or decline.', '/portal?tab=networking');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    select full_name into who from public.profiles where id = new.target_id;
    perform public.push_notification(new.requester_id, 'friend_accepted',
      coalesce(who, 'Someone') || ' accepted your friend request',
      'You can message each other now.', '/user/' || new.target_id::text);
  end if;
  return null;
end $$;

-- Applications: when a whole team is accepted, each member is told they're
-- in — instead of the organizer getting one "new application" per member.
create or replace function public.notify_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev record; who text;
begin
  select id, title, author_id into ev from public.posts where id = new.post_id;
  if ev.id is null then return null; end if;

  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      perform public.push_notification(new.applicant_id, 'accepted',
        'You got accepted to ' || ev.title,
        'Your team was accepted. Tap to open the event and its group chat.', '/post/' || ev.id);
    else
      select full_name into who from public.profiles where id = new.applicant_id;
      perform public.push_notification(ev.author_id, 'new_application',
        'New application for ' || ev.title,
        coalesce(who, 'Someone') || ' applied. Tap to review.', '/applicants/' || ev.id);
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.push_notification(new.applicant_id, 'accepted',
        'You got accepted to ' || ev.title,
        'Tap to open the event and its group chat.', '/post/' || ev.id);
    elsif new.status = 'rejected' then
      perform public.push_notification(new.applicant_id, 'rejected',
        'Update on ' || ev.title,
        'You were not selected this time.', '/post/' || ev.id);
    end if;
  end if;
  return null;
end $$;

-- Team invites and join requests: open straight onto Portal → Teams.
create or replace function public.notify_team_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; who text;
begin
  select id, name, owner_id into t from public.teams where id = new.team_id;
  if t.id is null then return null; end if;

  if tg_op = 'INSERT' then
    if new.status = 'invited' then
      perform public.push_notification(new.user_id, 'team_invite',
        'You were invited to ' || t.name,
        'Tap to accept or decline.', '/portal?tab=teams');
    elsif new.status = 'requested' then
      select full_name into who from public.profiles where id = new.user_id;
      perform public.push_notification(t.owner_id, 'team_request',
        coalesce(who, 'Someone') || ' wants to join ' || t.name,
        'Tap to review the request.', '/portal?tab=teams');
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    select full_name into who from public.profiles where id = new.user_id;
    if old.status = 'invited' then
      perform public.push_notification(t.owner_id, 'team_joined',
        coalesce(who, 'Someone') || ' joined ' || t.name, '', '/team/' || t.id);
    elsif old.status = 'requested' then
      perform public.push_notification(new.user_id, 'team_joined',
        'You joined ' || t.name, 'Your request to join was accepted.', '/team/' || t.id);
    end if;
  end if;
  return null;
end $$;

commit;
