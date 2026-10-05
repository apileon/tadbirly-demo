-- ============================================================
--  Tadbirly — Team Builder
--  Run in Supabase SQL Editor after the earlier scripts.
-- ============================================================

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  competition text,
  description text,
  spots integer,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'accepted',   -- invited | requested | accepted | declined
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create policy "teams read"   on public.teams for select using (true);
create policy "teams insert" on public.teams for insert with check (auth.uid() = owner_id);
create policy "teams update" on public.teams for update using (auth.uid() = owner_id);
create policy "teams delete" on public.teams for delete using (auth.uid() = owner_id);

-- A member row is visible to the member and to the team owner.
create policy "tm read" on public.team_members for select using (
  auth.uid() = user_id or auth.uid() = (select owner_id from public.teams t where t.id = team_id)
);
-- You can add yourself (request) or, as owner, add others (invite).
create policy "tm insert" on public.team_members for insert with check (
  auth.uid() = user_id or auth.uid() = (select owner_id from public.teams t where t.id = team_id)
);
create policy "tm update" on public.team_members for update using (
  auth.uid() = user_id or auth.uid() = (select owner_id from public.teams t where t.id = team_id)
);
create policy "tm delete" on public.team_members for delete using (
  auth.uid() = user_id or auth.uid() = (select owner_id from public.teams t where t.id = team_id)
);
