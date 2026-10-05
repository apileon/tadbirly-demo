-- ============================================================
--  Tadbirly — teams must be approved by an organizer before
--  they can apply to events. Organizers can also moderate/delete
--  any team. Run once in Supabase SQL Editor.
-- ============================================================

alter table public.teams add column if not exists status text not null default 'pending';
  -- pending | approved | rejected
alter table public.teams add column if not exists approved_by uuid references public.profiles(id);
alter table public.teams add column if not exists approved_at timestamptz;

-- Is the caller an organizer account?
create or replace function public.is_organizer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'organizer');
$$;

-- Owner may edit their own team; any organizer may moderate.
drop policy if exists "teams update" on public.teams;
create policy "teams update" on public.teams for update using (
  auth.uid() = owner_id or public.is_organizer()
);

-- Owner may delete their own team; any organizer may delete any team.
drop policy if exists "teams delete" on public.teams;
create policy "teams delete" on public.teams for delete using (
  auth.uid() = owner_id or public.is_organizer()
);

-- A team owner must not be able to approve their own team.
create or replace function public.protect_team_status()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_organizer() then
    new.status      := old.status;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

drop trigger if exists protect_team_status on public.teams;
create trigger protect_team_status
  before update on public.teams
  for each row execute function public.protect_team_status();

-- Only approved teams may apply to events.
drop policy if exists "tapp insert" on public.team_applications;
create policy "tapp insert" on public.team_applications for insert with check (
  applied_by = auth.uid()
  and public.is_team_owner(team_id)
  and exists (select 1 from public.teams t where t.id = team_id and t.status = 'approved')
);

-- Organizers (and the team's own people) can read a team's roster.
create or replace function public.team_roster_admin(t uuid)
returns table (id uuid, full_name text, university text, reliability integer)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.university, pr.reliability
  from public.team_members tm
  join public.profiles pr on pr.id = tm.user_id
  where tm.team_id = t
    and tm.status = 'accepted'
    and (public.is_organizer() or public.is_team_member(t) or public.is_team_owner(t))
  order by pr.full_name;
$$;
