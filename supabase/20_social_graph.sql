-- ============================================================
--  Tadbirly — social graph on public profiles
--    • mutual friends ("Kent +4 mutual friends")
--    • a person's friend list, viewable by anyone
--    • the last events they actually attended
--  These are security-definer so a viewer can read the parts of
--  someone else's connections/applications they're allowed to
--  see, without opening those tables up wholesale.
--  Run once in Supabase SQL Editor.
-- ============================================================

-- Friends you and this person have in common.
create or replace function public.mutual_friends(target uuid)
returns table (id uuid, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select case when c.requester_id = auth.uid() then c.target_id else c.requester_id end as fid
    from public.connections c
    where c.status = 'accepted'
      and (c.requester_id = auth.uid() or c.target_id = auth.uid())
  ),
  theirs as (
    select case when c.requester_id = target then c.target_id else c.requester_id end as fid
    from public.connections c
    where c.status = 'accepted'
      and (c.requester_id = target or c.target_id = target)
  )
  select p.id, p.full_name, p.avatar_url
  from mine m
  join theirs t on t.fid = m.fid
  join public.profiles p on p.id = m.fid
  where m.fid <> auth.uid() and m.fid <> target
  order by p.full_name;
$$;

-- Everyone this person is friends with.
create or replace function public.friends_of(target uuid)
returns table (id uuid, full_name text, avatar_url text, university text, reliability integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, p.university, p.reliability
  from public.connections c
  join public.profiles p
    on p.id = case when c.requester_id = target then c.target_id else c.requester_id end
  where c.status = 'accepted'
    and (c.requester_id = target or c.target_id = target)
  order by p.full_name;
$$;

-- The most recent events they were accepted to.
create or replace function public.recent_events_of(target uuid, n integer default 3)
returns table (
  id uuid, title text, event_date date, cover_url text,
  category text, kind text, status text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.event_date, p.cover_url, p.category, p.kind, p.status
  from public.applications a
  join public.posts p on p.id = a.post_id
  where a.applicant_id = target and a.status = 'accepted'
  order by coalesce(p.event_date, p.created_at::date) desc
  limit greatest(n, 1);
$$;
