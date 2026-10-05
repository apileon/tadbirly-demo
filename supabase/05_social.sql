-- ============================================================
--  Tadbirly — social: streaks, standardized tests, networking
--  Run in Supabase SQL Editor after the earlier scripts.
-- ============================================================

-- Streak (TikTok-style)
alter table public.profiles add column if not exists streak_count integer not null default 0;
alter table public.profiles add column if not exists last_active date;

-- Standardized tests on the passport
alter table public.profiles add column if not exists ielts text;
alter table public.profiles add column if not exists sat text;
alter table public.profiles add column if not exists act text;
alter table public.profiles add column if not exists milliy text;

-- Networking: connection requests between people
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',   -- pending | accepted | declined
  created_at timestamptz not null default now(),
  unique (requester_id, target_id)
);
alter table public.connections enable row level security;
create policy "conn read"   on public.connections for select using (auth.uid() = requester_id or auth.uid() = target_id);
create policy "conn insert" on public.connections for insert with check (auth.uid() = requester_id);
create policy "conn update" on public.connections for update using (auth.uid() = target_id or auth.uid() = requester_id);

-- Networking chats have no event attached
alter table public.chats alter column post_id drop not null;
