-- ============================================================
--  Tadbirly — event results (places) + points
--  Run once in Supabase SQL Editor.
-- ============================================================

-- 1) A place (1 = winner) on an accepted application
alter table public.applications add column if not exists place integer;

-- 2) Roster now includes place (return type changes → drop first)
drop function if exists public.event_roster(uuid);
create or replace function public.event_roster(p uuid)
returns table (id uuid, full_name text, status text, place integer)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, a.status, a.place
  from public.applications a
  join public.profiles pr on pr.id = a.applicant_id
  where a.post_id = p and a.status in ('pending', 'accepted')
  order by a.status asc, a.place asc nulls last, a.created_at asc;
$$;

-- 3) A user's results (for public profiles + points)
create or replace function public.user_results(u uuid)
returns table (post_id uuid, title text, place integer, status text, event_date date)
language sql stable security definer set search_path = public as $$
  select a.post_id, p.title, a.place, a.status, p.event_date
  from public.applications a
  join public.posts p on p.id = a.post_id
  where a.applicant_id = u and a.status = 'accepted'
  order by a.place asc nulls last, p.event_date desc nulls last;
$$;
