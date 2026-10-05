-- ============================================================
--  Tadbirly — fix: team members should see the whole roster
--  (previously each member could only see their own row).
--  Uses a SECURITY DEFINER helper to avoid RLS recursion.
--  Run this in Supabase SQL Editor.
-- ============================================================

create or replace function public.is_team_member(t uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
    where team_id = t and user_id = auth.uid() and status = 'accepted'
  );
$$;

-- Additional read policy (RLS combines policies with OR):
-- any accepted member of a team can see all rows for that team.
drop policy if exists "tm read members" on public.team_members;
create policy "tm read members" on public.team_members
  for select using ( public.is_team_member(team_id) );
