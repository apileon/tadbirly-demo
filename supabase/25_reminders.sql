-- ============================================================
--  Tadbirly — 25: automatic event reminders (+ an optional start time)
--
--  Accepted students forget. Now they're reminded automatically — as
--  ordinary notifications, so a reminder arrives wherever everything else
--  does: the bell, web push, and Telegram once 24 is installed.
--
--    Accepted students
--      the evening before, from 20:00     Tomorrow: <event>
--                                         Starts 15:00 · <location>
--      2 hours before the start time      Starting soon: <event>
--                                         Starts at 15:00 · <location>
--      no start time: 08:00 on the day    Today: <event>
--    The organizer
--      the evening before, from 20:00     Tomorrow: <event>
--                                         12 students accepted
--
--  Tashkent time throughout (UTC+5 all year), whatever time zone the
--  server itself runs in. The start time is new and optional: the Post and
--  Edit event forms fill posts.start_time.
--
--  How it works
--    Supabase Cron (pg_cron) calls send_event_reminders() every 10 minutes
--    and it sends whatever has come due. Each reminder is first written
--    into event_reminders_sent — one row per (event, person, kind) — and
--    only sent if that row is new, so a re-run, a late run or two runs at
--    once can never send anything twice. Moving an event to another day or
--    time re-arms its reminders for the new moment.
--
--  Run AFTER 24. (It also works after 23 alone — reminders then go out as
--  web push only, until 24 is in.) All-or-nothing, safe to re-run.
--
--  pg_cron: this file switches it on itself, the way Supabase documents it
--  (supabase.com/docs/guides/cron/install). If your project won't allow
--  that, everything else is still installed and the result row at the
--  bottom says NOT scheduled: enable pg_cron in Dashboard → Integrations →
--  Cron (or Database → Extensions), then run this file again.
--
--  Is it running?
--    select jobid, schedule, command, active
--      from cron.job where jobname = 'tadbirly-reminders';
--    select status, return_message, start_time
--      from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'tadbirly-reminders')
--     order by start_time desc limit 10;
--    select * from public.event_reminders_sent order by sent_at desc limit 20;
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Optional start time
-- ------------------------------------------------------------
-- Wall-clock time in Tashkent, the same way event_date is a Tashkent
-- calendar day. Null = no time given: the app shows just the date, and
-- students get a morning reminder instead of a "starting soon" one.
alter table public.posts add column if not exists start_time time;


-- ------------------------------------------------------------
-- 2. Which reminders have gone out
-- ------------------------------------------------------------
-- The primary key is the whole dedupe: each person gets each kind of
-- reminder for an event once. RLS on, no policies: invisible to every client.
create table if not exists public.event_reminders_sent (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind    text not null,                 -- eve | soon | morning | eve_org
  sent_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);
alter table public.event_reminders_sent enable row level security;


-- ------------------------------------------------------------
-- 3. The reminder run (every 10 minutes, see 5.)
-- ------------------------------------------------------------
-- Returns how many reminders it sent.
-- p_now exists only for testing ("act as if it were this moment"); the cron
-- job calls it with no argument, i.e. now().
create or replace function public.send_event_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  -- Dates and start times are Tashkent wall-clock values, so the clock is
  -- read in Tashkent too. Everything below compares whole timestamps, never
  -- bare times: "2 hours before 00:30" is 22:30 on the day BEFORE.
  now_tk   timestamp := p_now at time zone 'Asia/Tashkent';
  today_tk date      := (p_now at time zone 'Asia/Tashkent')::date;
  r        record;
  fresh    boolean;
  sent     integer := 0;
begin
  for r in
    with ev as (
      -- Every window below lies within a day of the event, so only events
      -- from yesterday to tomorrow can have anything due.
      select p.id, p.author_id, p.title, p.event_date, p.start_time,
             to_char(p.start_time, 'HH24:MI') as hhmi,
             nullif(btrim(p.location), '')    as place
        from public.posts p
       where p.event_date between today_tk - 1 and today_tk + 1
         and p.status <> 'completed'
         -- Read through jsonb: the moderation column (file 02) isn't in every
         -- database, and naming it directly would break the whole function
         -- wherever it's missing.
         and coalesce(to_jsonb(p) ->> 'moderation', 'approved') <> 'removed'
    ),
    going as (
      -- Accepted students only. An organizer on their own list is already
      -- reminded as the organizer.
      select e.*, a.applicant_id as user_id
        from ev e
        join public.applications a on a.post_id = e.id and a.status = 'accepted'
       where a.applicant_id <> e.author_id
    ),
    due as (
      -- The evening before, from 20:00 until midnight.
      select g.id as post_id, g.user_id, 'eve' as kind,
             'Tomorrow: ' || g.title as title,
             concat_ws(' · ', 'Starts ' || g.hhmi, g.place) as body
        from going g
       where now_tk >= (g.event_date - 1) + time '20:00'
         and now_tk <  g.event_date::timestamp
      union all
      -- The last 2 hours before a set start time.
      select g.id, g.user_id, 'soon',
             'Starting soon: ' || g.title,
             concat_ws(' · ', 'Starts at ' || g.hhmi, g.place)
        from going g
       where g.start_time is not null
         and now_tk >= (g.event_date + g.start_time) - interval '2 hours'
         and now_tk <  g.event_date + g.start_time
      union all
      -- No start time: from 08:00 on the day. Not after 20:00 — a "Today"
      -- that late (say, the cron was down) is likely after the event.
      select g.id, g.user_id, 'morning',
             'Today: ' || g.title,
             g.place
        from going g
       where g.start_time is null
         and now_tk >= g.event_date + time '08:00'
         and now_tk <  g.event_date + time '20:00'
      union all
      -- The organizer, the evening before: how many are coming. Nothing
      -- while nobody is accepted — if someone is accepted later that
      -- evening, it goes out on the next run.
      select e.id, e.author_id, 'eve_org',
             'Tomorrow: ' || e.title,
             n.accepted || case when n.accepted = 1 then ' student accepted'
                                else ' students accepted' end
        from ev e
        cross join lateral (select count(*) as accepted from going g where g.id = e.id) n
       where n.accepted > 0
         and now_tk >= (e.event_date - 1) + time '20:00'
         and now_tk <  e.event_date::timestamp
    )
    select d.*
      from due d
     -- A cheap pre-check, so reminders sent on an earlier run cost no insert
     -- attempt. The insert below is what actually guarantees "only once".
     where not exists (
       select 1 from public.event_reminders_sent s
        where s.post_id = d.post_id and s.user_id = d.user_id and s.kind = d.kind
     )
  loop
    begin
      -- Claim it first; only a row this run really inserted gets sent. A run
      -- overlapping this one waits here for our row, then skips it.
      insert into public.event_reminders_sent (post_id, user_id, kind)
      values (r.post_id, r.user_id, r.kind)
      on conflict do nothing
      returning true into fresh;

      if fresh then
        perform public.push_notification(
          r.user_id, 'reminder', r.title,
          coalesce(nullif(r.body, ''), 'Tap to see the details.'),
          '/post/' || r.post_id);
        sent := sent + 1;
      end if;
    exception when others then
      -- One bad row must not hold up everyone else's reminders. Its claim is
      -- undone with it, so the next run tries it again.
      raise warning 'send_event_reminders: % for post % / user % not sent: % (%)',
        r.kind, r.post_id, r.user_id, sqlerrm, sqlstate;
    end;
  end loop;

  return sent;
end $$;


-- ------------------------------------------------------------
-- 4. A moved event is reminded about again
-- ------------------------------------------------------------
-- Otherwise "Tomorrow: …" sent for the old date would count as sent for the
-- new one too, and nobody would be reminded before the real day. Only a
-- real change of day or time re-arms — saving an edit with the same date
-- and time keeps everything as sent.
-- Security definer: the organizer's own session can't touch this table.
create or replace function public.rearm_event_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.event_reminders_sent where post_id = new.id;
  return null;
end $$;

drop trigger if exists rearm_event_reminders on public.posts;
create trigger rearm_event_reminders
  after update of event_date, start_time on public.posts
  for each row
  when (old.event_date is distinct from new.event_date
        or old.start_time is distinct from new.start_time)
  execute function public.rearm_event_reminders();


-- ------------------------------------------------------------
-- 5. Every 10 minutes (Supabase Cron = the pg_cron extension)
-- ------------------------------------------------------------
do $do$
begin
  -- Supabase lets the SQL Editor switch pg_cron on (its documented SQL
  -- install). In its own block: if this project doesn't allow it, the rest
  -- of this file still goes in, and only the timer is missing.
  if to_regclass('cron.job') is null then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then
      raise notice 'pg_cron could not be switched on from SQL: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  if to_regclass('cron.job') is null then
    raise notice 'Reminders are installed but NOT scheduled: enable pg_cron in Dashboard → Integrations → Cron (or Database → Extensions), then run 25_reminders.sql again.';
    return;
  end if;

  -- Exactly one job, however often this file runs. Current pg_cron already
  -- replaces a job scheduled again under the same name; removing it first
  -- also covers older versions, which would add a second one. (unschedule
  -- raises for a name it doesn't know, hence the check.)
  if exists (select 1 from cron.job where jobname = 'tadbirly-reminders') then
    perform cron.unschedule('tadbirly-reminders');
  end if;
  perform cron.schedule('tadbirly-reminders', '*/10 * * * *', 'select public.send_event_reminders()');
end $do$;


-- ------------------------------------------------------------
-- 6. Who may call what
-- ------------------------------------------------------------
-- Supabase gives anon + authenticated EXECUTE on every new function in
-- public by default. Both of these are server-only: the cron job runs as
-- postgres, which owns them, and a trigger needs no EXECUTE grant to fire.
-- (Anyone able to call send_event_reminders could pass a p_now of their
-- choosing and set everyone's reminders off early.)
revoke execute on function public.send_event_reminders(timestamptz) from public, anon, authenticated;
revoke execute on function public.rearm_event_reminders()           from public, anon, authenticated;

-- Let the API see posts.start_time straight away.
notify pgrst, 'reload schema';

commit;


-- The SQL Editor shows this row. (It doesn't show NOTICEs.)
select case
  when to_regclass('cron.job') is null then
    'Reminders installed but NOT scheduled: enable pg_cron in Dashboard → Integrations → Cron, then run this file again.'
  else
    'Reminders installed and scheduled: tadbirly-reminders runs every 10 minutes.'
end as result;
