-- ============================================================
--  Tadbirly — AI Career Coach: daily usage cap + context loader
--  Used ONLY by the `career-coach` edge function (service role).
--  Run once in Supabase SQL Editor. Safe to re-run.
--
--  * coach_usage     — one row per (student, Tashkent day). RLS on, no
--                      policies: the app can never read or write it.
--  * coach_consume() — atomically takes one answer from today's quota.
--  * coach_refund()  — gives it back when the AI call failed.
--  * coach_context() — the student's OWN academic data + upcoming open
--                      events, as compact JSON. No names, emails, phones.
--  All three are callable by service_role only.
--
--  Written defensively: columns added by later scripts (honors, ielts,
--  sat, act, milliy, bio, moderation, awards.kind/place …) are read via
--  to_jsonb(row)->>'col', so a missing column gives NULL, not an error;
--  awards/badges are only queried if those tables exist.
-- ============================================================

create table if not exists public.coach_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);

alter table public.coach_usage enable row level security;
-- No policies on purpose. Only SECURITY DEFINER functions below touch it.
revoke all on table public.coach_usage from anon, authenticated;

-- ---------- coach_consume ----------
-- Returns {allowed, used, cap, reason}. reason: null | 'daily_limit' | 'global_limit'.
-- p_global_cap is a project-wide safety valve on spend (all students, per day).
create or replace function public.coach_consume(
  p_user uuid,
  p_cap integer default 10,
  p_global_cap integer default 1500
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Asia/Tashkent')::date;
  v_used  integer;
  v_total integer;
begin
  if p_user is null then
    return jsonb_build_object('allowed', false, 'used', 0, 'cap', p_cap, 'reason', 'no_user');
  end if;

  select coalesce(sum(cu.count), 0) into v_total
    from public.coach_usage cu where cu.day = v_day;
  if v_total >= p_global_cap then
    select coalesce(max(cu.count), 0) into v_used
      from public.coach_usage cu where cu.user_id = p_user and cu.day = v_day;
    return jsonb_build_object('allowed', false, 'used', v_used, 'cap', p_cap, 'reason', 'global_limit');
  end if;

  -- Atomic: the conditional upsert only bumps the counter while under the cap.
  insert into public.coach_usage as cu (user_id, day, count)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set count = cu.count + 1
    where cu.count < p_cap
  returning cu.count into v_used;

  if v_used is null then
    return jsonb_build_object('allowed', false, 'used', p_cap, 'cap', p_cap, 'reason', 'daily_limit');
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used, 'cap', p_cap, 'reason', null);
end;
$$;

-- ---------- coach_refund ----------
create or replace function public.coach_refund(p_user uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.coach_usage
     set count = greatest(count - 1, 0)
   where user_id = p_user
     and day = (now() at time zone 'Asia/Tashkent')::date;
$$;

-- ---------- coach_context ----------
create or replace function public.coach_context(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today  date := (now() at time zone 'Asia/Tashkent')::date;
  v_row    jsonb;
  v_prof   jsonb := '{}'::jsonb;
  v_att    jsonb := '[]'::jsonb;
  v_awards jsonb := '[]'::jsonb;
  v_up     jsonb := '[]'::jsonb;
begin
  -- Profile: academic fields only (no name, avatar, phone, email, city).
  select to_jsonb(p) into v_row from public.profiles p where p.id = p_user;
  if v_row is not null then
    v_prof := jsonb_strip_nulls(jsonb_build_object(
      'university',    v_row -> 'university',
      'faculty',       v_row -> 'faculty',
      'major',         v_row -> 'major',
      'academic_year', v_row -> 'academic_year',
      'languages',     v_row -> 'languages',
      'skills',        v_row -> 'skills',
      'honors',        v_row -> 'honors',
      'ielts',         v_row -> 'ielts',
      'sat',           v_row -> 'sat',
      'act',           v_row -> 'act',
      'milliy',        v_row -> 'milliy',
      'bio',           to_jsonb(left(v_row ->> 'bio', 400))
    ));
  end if;

  -- Events the student was accepted to (most recent first).
  select coalesce(jsonb_agg(s.x), '[]'::jsonb) into v_att
  from (
    select jsonb_strip_nulls(jsonb_build_object(
             'title',    left(po.title, 120),
             'category', po.category,
             'kind',     po.kind,
             'date',     po.event_date
           )) as x
      from public.applications a
      join public.posts po on po.id = a.post_id
     where a.applicant_id = p_user
       and a.status = 'accepted'
     order by po.event_date desc nulls last, a.created_at desc
     limit 30
  ) s;

  -- Verified awards (only if the passport tables exist on this database).
  if to_regclass('public.awards') is not null and to_regclass('public.badges') is not null then
    execute $q$
      select coalesce(jsonb_agg(s.x), '[]'::jsonb)
      from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'award',    coalesce(to_jsonb(aw) ->> 'kind', 'medal'),
                 'place',    to_jsonb(aw) -> 'place',
                 'badge',    left(b.name, 100),
                 'event',    left(po.title, 120),
                 'category', po.category
               )) as x
          from public.awards aw
          join public.badges b on b.id = aw.badge_id
          join public.posts po on po.id = aw.post_id
         where aw.recipient_id = $1
           and coalesce(to_jsonb(aw) ->> 'verified', 'true') <> 'false'
         order by aw.created_at desc
         limit 20
      ) s
    $q$ into v_awards using p_user;
  end if;

  -- Upcoming open, approved events the student hasn't applied to yet.
  select coalesce(jsonb_agg(s.x), '[]'::jsonb) into v_up
  from (
    select jsonb_strip_nulls(jsonb_build_object(
             'id',       po.id,
             'title',    left(po.title, 120),
             'category', po.category,
             'kind',     po.kind,
             'date',     po.event_date,
             'deadline', po.deadline
           )) as x
      from public.posts po
     where po.status = 'open'
       and coalesce(to_jsonb(po) ->> 'moderation', 'approved') = 'approved'
       and (po.event_date is null or po.event_date >= v_today)
       and (po.deadline   is null or po.deadline   >= v_today)
       and not exists (
         select 1 from public.applications a
          where a.post_id = po.id and a.applicant_id = p_user
       )
     order by po.boosted desc, coalesce(po.event_date, po.deadline) asc nulls last, po.created_at desc
     limit 15
  ) s;

  return jsonb_build_object(
    'profile',  v_prof,
    'attended', v_att,
    'awards',   coalesce(v_awards, '[]'::jsonb),
    'upcoming', v_up,
    'today',    v_today
  );
end;
$$;

-- Service role only — never callable from the app with a user/anon key.
revoke all on function public.coach_consume(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.coach_refund(uuid)                    from public, anon, authenticated;
revoke all on function public.coach_context(uuid)                   from public, anon, authenticated;
grant execute on function public.coach_consume(uuid, integer, integer) to service_role;
grant execute on function public.coach_refund(uuid)                    to service_role;
grant execute on function public.coach_context(uuid)                   to service_role;
