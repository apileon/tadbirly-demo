-- ============================================================
--  Tadbirly — Ranking / points leaderboard
--  Organizers assign points when they award someone.
--  Run once in Supabase SQL Editor.
-- ============================================================

-- Points carried by each award
alter table public.awards add column if not exists points integer not null default 0;

-- Backfill awards that were given before points existed
update public.awards set points = case kind
  when 'winner' then case place when 1 then 100 when 2 then 75 when 3 then 50 else 60 end
  when 'medal' then 30
  when 'mention' then 20
  when 'participation' then 10
  else 20 end
where points = 0;

-- ---------- Integrity: only the event's organizer may award ----------
-- (previously any signed-in user could insert an award for themselves,
--  which would be free points once ranking exists)
drop policy if exists "awards insert" on public.awards;
create policy "awards insert" on public.awards for insert with check (
  awarded_by = auth.uid()
  and exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
);

-- Recipients may only pin/unpin their award — never change points or kind.
create or replace function public.protect_award_fields()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and auth.uid() <> old.awarded_by then
    new.points        := old.points;
    new.kind          := old.kind;
    new.place         := old.place;
    new.note          := old.note;
    new.verified      := old.verified;
    new.badge_id      := old.badge_id;
    new.post_id       := old.post_id;
    new.recipient_id  := old.recipient_id;
    new.awarded_by    := old.awarded_by;
  end if;
  return new;
end $$;

drop trigger if exists protect_award_fields on public.awards;
create trigger protect_award_fields
  before update on public.awards
  for each row execute function public.protect_award_fields();

-- ---------- Leaderboard ----------
create or replace function public.leaderboard(limit_n integer default 200)
returns table (
  place bigint,
  user_id uuid,
  full_name text,
  university text,
  points bigint,
  wins bigint
)
language sql stable security definer set search_path = public as $$
  select
    rank() over (order by coalesce(sum(a.points), 0) desc)::bigint,
    p.id,
    p.full_name,
    p.university,
    coalesce(sum(a.points), 0)::bigint,
    count(a.id) filter (where a.kind = 'winner')::bigint
  from public.profiles p
  left join public.awards a
    on a.recipient_id = p.id and a.verified = true
  group by p.id, p.full_name, p.university
  order by 5 desc, p.full_name
  limit limit_n;
$$;

-- Your own points + rank, for the badge in the corner
create or replace function public.my_points()
returns table (points bigint, place bigint)
language sql stable security definer set search_path = public as $$
  with totals as (
    select p.id, coalesce(sum(a.points), 0) as pts
    from public.profiles p
    left join public.awards a on a.recipient_id = p.id and a.verified = true
    group by p.id
  ), ranked as (
    select id, pts, rank() over (order by pts desc) as rnk from totals
  )
  select pts::bigint, rnk::bigint from ranked where id = auth.uid();
$$;
