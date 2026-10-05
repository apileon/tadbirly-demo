-- ============================================================
--  Tadbirly — feature batch
--  • contact info on profiles (Telegram / phone / LinkedIn)
--  • delete your own DM messages
--  • per-event group chat (organizer + accepted participants)
--  • public roster for the event page (who applied / accepted)
--  Run once in Supabase SQL Editor.
-- ============================================================

-- 1) Contact info on profiles
alter table public.profiles add column if not exists telegram text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists linkedin text;

-- 2) People can delete their own DM messages
drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages
  for delete using (sender_id = auth.uid());

-- 3) Event group chat
create table if not exists public.event_messages (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.event_messages enable row level security;

-- Who may use an event's chat: its organizer, or an accepted participant.
create or replace function public.can_access_event_chat(p uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where id = p and author_id = auth.uid())
      or exists (select 1 from public.applications
                 where post_id = p and applicant_id = auth.uid() and status = 'accepted');
$$;

drop policy if exists "evmsg read" on public.event_messages;
create policy "evmsg read" on public.event_messages
  for select using (public.can_access_event_chat(post_id));

drop policy if exists "evmsg insert" on public.event_messages;
create policy "evmsg insert" on public.event_messages
  for insert with check (sender_id = auth.uid() and public.can_access_event_chat(post_id));

drop policy if exists "evmsg delete own" on public.event_messages;
create policy "evmsg delete own" on public.event_messages
  for delete using (sender_id = auth.uid());

-- Live updates for the event chat (safe to re-run)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'event_messages'
  ) then
    alter publication supabase_realtime add table public.event_messages;
  end if;
end $$;

-- 4) Public roster: who applied / got accepted (shown on the event page)
create or replace function public.event_roster(p uuid)
returns table (id uuid, full_name text, status text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, a.status
  from public.applications a
  join public.profiles pr on pr.id = a.applicant_id
  where a.post_id = p and a.status in ('pending', 'accepted')
  order by a.status asc, a.created_at asc;
$$;
