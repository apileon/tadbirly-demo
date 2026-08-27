-- ============================================================
--  Tadbirly — Moderation & safety (Week 1)
--  Run this in Supabase SQL Editor AFTER schema.sql.
--  Adds: reports, user blocks, and post moderation status.
--  These are required for App Store / Play Store approval of
--  apps with user-generated content.
-- ============================================================

-- Posts get a moderation flag. Default 'approved' keeps the MVP
-- frictionless; flip to 'pending' + manual review if abuse appears.
alter table public.posts
  add column if not exists moderation text not null default 'approved';  -- approved | pending | removed

-- ---------- REPORTS ----------  (report a post or a user)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
-- A user can file a report and see their own reports.
create policy "reports insert" on public.reports for insert with check (auth.uid() = reporter_id);
create policy "reports read"   on public.reports for select using (auth.uid() = reporter_id);

-- ---------- BLOCKS ----------  (hide a user from another user)
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;
create policy "blocks manage" on public.blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- Helper the app calls to hide blocked authors from the feed.
create or replace function public.blocked_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select blocked_id from public.blocks where blocker_id = auth.uid();
$$;
