-- ============================================================
--  Tadbirly — 22: don't buzz someone who's already in the chat
--
--  The push decision happens in Postgres, which has no idea which
--  screen you're looking at. So we tell it: the chat screen sends a
--  heartbeat while it's open, and notify_message skips anyone whose
--  heartbeat is fresh.
--
--  Run AFTER 21_dm_push_and_badges.sql. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who is currently looking at which chat
-- ------------------------------------------------------------
create table if not exists public.chat_presence (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- RLS on with no policies: no client can read or write this directly.
-- Only the two security-definer functions below touch it, so nobody can
-- see who is reading what.
alter table public.chat_presence enable row level security;

create index if not exists chat_presence_seen_idx
  on public.chat_presence (chat_id, seen_at);


-- ------------------------------------------------------------
-- 2. Heartbeat in / out
-- ------------------------------------------------------------
create or replace function public.touch_chat_presence(c uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Only the two people in the chat can claim presence in it.
  if not exists (
    select 1 from public.chats ch
     where ch.id = c
       and (ch.participant_id = auth.uid() or ch.organizer_id = auth.uid())
  ) then
    return;
  end if;

  insert into public.chat_presence (chat_id, user_id, seen_at)
  values (c, auth.uid(), now())
  on conflict (chat_id, user_id) do update set seen_at = now();
end $$;

create or replace function public.leave_chat_presence(c uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.chat_presence
   where chat_id = c and user_id = auth.uid();
$$;


-- ------------------------------------------------------------
-- 3. notify_message(): skip anyone who's watching the chat
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

  -- They have this chat open right now — the message is already on their
  -- screen. No notification row at all, which also means no push, no toast
  -- and no bell count. The heartbeat is every 15s and stops the instant the
  -- tab is hidden, so a locked phone starts getting pushes again quickly.
  if exists (
    select 1 from public.chat_presence p
     where p.chat_id = new.chat_id
       and p.user_id = target
       and p.seen_at > now() - interval '30 seconds'
  ) then
    return null;
  end if;

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

  insert into public.notifications (user_id, type, title, body, link, collapse_key)
  values (target, 'message', head, msg, '/chat/' || new.chat_id::text, ckey)
  on conflict (user_id, collapse_key) where read_at is null and collapse_key is not null
  do update set title = excluded.title, body = excluded.body, created_at = now();

  return null;
end $$;


-- ------------------------------------------------------------
-- 4. Housekeeping
-- ------------------------------------------------------------
-- Rows are deleted when the screen closes, but a crashed tab or a killed
-- browser leaves one behind. They're harmless (the 30s window makes them
-- inert) — this just stops the table growing forever.
create or replace function public.sweep_chat_presence()
returns void language sql security definer set search_path = public as $$
  delete from public.chat_presence where seen_at < now() - interval '1 hour';
$$;

grant execute on function public.touch_chat_presence(uuid) to authenticated;
grant execute on function public.leave_chat_presence(uuid) to authenticated;
revoke execute on function public.touch_chat_presence(uuid) from public, anon;
revoke execute on function public.leave_chat_presence(uuid) from public, anon;
revoke execute on function public.sweep_chat_presence()    from public, anon;
