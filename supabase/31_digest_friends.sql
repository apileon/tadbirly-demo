-- ============================================================
--  Tadbirly — 31: weekly digest + "friends going"
--
--    1. Weekly digest      One notification every Sunday 19:00 Tashkent:
--                          "7 new opportunities · 2 deadlines this week ·
--                           3 friends joined events" — in the person's own
--                          language (profiles.locale, English by default).
--                          Nothing at all for someone with nothing to say.
--    2. Friends going      friends_going(post ids) for the feed and the event
--                          page: "Aziz and 2 friends are going".
--
--  "Joined this week" needs to know WHEN someone was accepted, so
--  applications get an accepted_at stamp (set by a trigger, backfilled once
--  from the "You got accepted" notifications already sent).
--
--  Run AFTER 29 (growth). All-or-nothing, safe to re-run.
--
--  Is it running?
--    select jobid, schedule, active from cron.job where jobname = 'tadbirly-weekly-digest';
--    select * from public.digest_sent order by sent_at desc limit 20;
--  Try it without sending (rolls back):
--    begin; select public.send_weekly_digest(); rollback;
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. When was someone accepted?
-- ------------------------------------------------------------
alter table public.applications add column if not exists accepted_at timestamptz;

-- Stamped by the database only: a client can't backdate or move it.
create or replace function public.stamp_application_accepted_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'accepted' then
    if tg_op = 'INSERT' or old.status is distinct from 'accepted' then
      new.accepted_at := now();
    else
      new.accepted_at := old.accepted_at;
    end if;
  else
    new.accepted_at := null;
  end if;
  return new;
end $$;

-- Off while backfilling: with it on, the backfill below would be reset to
-- the old (empty) value.
drop trigger if exists stamp_application_accepted_at on public.applications;

-- Backfill once from the "accepted" notifications (link '/post/<id>').
-- Rows with no such notification stay null = "not this week".
update public.applications a
   set accepted_at = n.ts
  from (select user_id, link, max(created_at) as ts
          from public.notifications
         where type = 'accepted' and link like '/post/%'
         group by user_id, link) n
 where a.status = 'accepted'
   and a.accepted_at is null
   and n.user_id = a.applicant_id
   and n.link = '/post/' || a.post_id::text;

create trigger stamp_application_accepted_at
  before insert or update on public.applications
  for each row execute function public.stamp_application_accepted_at();

create index if not exists applications_accepted_at_idx
  on public.applications (accepted_at) where status = 'accepted';


-- ------------------------------------------------------------
-- 2. Who has had a digest this week
-- ------------------------------------------------------------
-- week_start = the Monday (Tashkent) of the ISO week. RLS on, no policies:
-- invisible to every client.
create table if not exists public.digest_sent (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.digest_sent enable row level security;


-- ------------------------------------------------------------
-- 3. Russian plural form: 1 возможность / 2 возможности / 5 возможностей
-- ------------------------------------------------------------
create or replace function public.digest_ru_plural(n integer, one text, few text, many text)
returns text language sql immutable set search_path = public as $$
  select case
    when n % 10 = 1 and n % 100 <> 11 then one
    when n % 10 between 2 and 4 and n % 100 not between 12 and 14 then few
    else many
  end;
$$;


-- ------------------------------------------------------------
-- 4. The weekly digest (Sunday 19:00 Tashkent, see 6.)
-- ------------------------------------------------------------
-- Returns how many digests it sent. p_now is for testing only; the cron job
-- calls it with no argument.
create or replace function public.send_weekly_digest(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  today_tk date := (p_now at time zone 'Asia/Tashkent')::date;
  week_tk  date := date_trunc('week', p_now at time zone 'Asia/Tashkent')::date;  -- ISO Monday
  since    timestamptz := p_now - interval '7 days';
  -- friend id -> joined-this-week, per user: computed first so the block
  -- filter can depend on whether is_blocked_between exists.
  fr       jsonb;
  r        record;
  fresh    boolean;
  parts    text[];
  ttl      text;
  sent     integer := 0;
begin
  if to_regprocedure('public.is_blocked_between(uuid,uuid)') is not null then
    select coalesce(jsonb_object_agg(uid, n), '{}'::jsonb) into fr
      from (
        select f.uid, count(distinct f.fid)::int as n
          from (select c.requester_id as uid, c.target_id as fid
                  from public.connections c where c.status = 'accepted'
                union
                select c.target_id, c.requester_id
                  from public.connections c where c.status = 'accepted') f
          join public.applications a
            on a.applicant_id = f.fid and a.status = 'accepted'
           and a.accepted_at >= since and a.accepted_at < p_now
         where f.uid <> f.fid
           and not public.is_blocked_between(f.uid, f.fid)
         group by f.uid
      ) x;
  else
    select coalesce(jsonb_object_agg(uid, n), '{}'::jsonb) into fr
      from (
        select f.uid, count(distinct f.fid)::int as n
          from (select c.requester_id as uid, c.target_id as fid
                  from public.connections c where c.status = 'accepted'
                union
                select c.target_id, c.requester_id
                  from public.connections c where c.status = 'accepted') f
          join public.applications a
            on a.applicant_id = f.fid and a.status = 'accepted'
           and a.accepted_at >= since and a.accepted_at < p_now
         where f.uid <> f.fid
         group by f.uid
      ) x;
  end if;

  for r in
    with fresh_posts as (
      -- Posted this week, still open, still ahead.
      select p.id, p.author_id, lower(coalesce(p.category, '')) as cat, p.kind
        from public.posts p
       where p.created_at >= since and p.created_at < p_now
         and p.status = 'open'
         and coalesce(to_jsonb(p) ->> 'moderation', 'approved') not in ('removed', 'pending')
         and (p.event_date is null or p.event_date >= today_tk)
         and (p.deadline   is null or p.deadline   >= today_tk)
    ),
    people as (
      select pr.id, lower(coalesce(pr.locale, 'en')) as loc,
             array(select lower(x) from unnest(coalesce(pr.interests, '{}'::text[])) x) as ints
        from public.profiles pr
    ),
    counts as (
      select pe.id, pe.loc,
             -- Matching their interests when they have any (and there is a
             -- match), otherwise everything new.
             (select case when cardinality(pe.ints) > 0 and m.matched > 0 then m.matched else m.total end
                from (select count(*) filter (
                               where fp.cat = any(pe.ints)
                                  or (fp.kind = 'internship' and 'internship' = any(pe.ints))) as matched,
                             count(*) as total
                        from fresh_posts fp
                       where fp.author_id <> pe.id) m)::int as new_n,
             -- Deadlines in the next 7 days among events they saved or applied
             -- to (a rejected application doesn't count).
             (select count(*) from public.posts p
               where p.deadline between today_tk and today_tk + 6
                 and p.status = 'open'
                 and coalesce(to_jsonb(p) ->> 'moderation', 'approved') <> 'removed'
                 -- Saved but not applied yet, or applied and still pending.
                 -- (Already accepted: the deadline no longer matters to them.)
                 and ((exists (select 1 from public.saved_posts s
                                where s.post_id = p.id and s.user_id = pe.id)
                       and not exists (select 1 from public.applications a
                                        where a.post_id = p.id and a.applicant_id = pe.id))
                      or exists (select 1 from public.applications a
                                  where a.post_id = p.id and a.applicant_id = pe.id
                                    and a.status = 'pending')))::int as dl_n,
             coalesce((fr ->> pe.id::text)::int, 0) as fr_n
        from people pe
       where not exists (select 1 from public.digest_sent d
                          where d.user_id = pe.id and d.week_start = week_tk)
    )
    select * from counts where new_n > 0 or dl_n > 0 or fr_n > 0
  loop
    begin
      insert into public.digest_sent (user_id, week_start) values (r.id, week_tk)
      on conflict do nothing returning true into fresh;
      if fresh then
        parts := '{}';
        if r.loc = 'uz' then
          ttl := 'Bu hafta Tadbirly''da';
          if r.new_n > 0 then parts := parts || (r.new_n || ' ta yangi imkoniyat'); end if;
          if r.dl_n  > 0 then parts := parts || ('shu hafta ' || r.dl_n || ' ta muddat tugaydi'); end if;
          if r.fr_n  > 0 then parts := parts || (r.fr_n || ' nafar do‘stingiz tadbirlarga qo‘shildi'); end if;
        elsif r.loc = 'ru' then
          ttl := 'На этой неделе в Tadbirly';
          if r.new_n > 0 then parts := parts || (r.new_n || ' ' || public.digest_ru_plural(r.new_n,
               'новая возможность', 'новые возможности', 'новых возможностей')); end if;
          if r.dl_n  > 0 then parts := parts || (r.dl_n || ' ' || public.digest_ru_plural(r.dl_n,
               'дедлайн', 'дедлайна', 'дедлайнов') || ' на этой неделе'); end if;
          if r.fr_n  > 0 then parts := parts || (r.fr_n || ' ' || public.digest_ru_plural(r.fr_n,
               'друг идёт на мероприятие', 'друга идут на мероприятия', 'друзей идут на мероприятия')); end if;
        else
          ttl := 'This week on Tadbirly';
          if r.new_n > 0 then parts := parts || (r.new_n || case when r.new_n = 1
               then ' new opportunity' else ' new opportunities' end); end if;
          if r.dl_n  > 0 then parts := parts || (r.dl_n || case when r.dl_n = 1
               then ' deadline this week' else ' deadlines this week' end); end if;
          if r.fr_n  > 0 then parts := parts || (r.fr_n || case when r.fr_n = 1
               then ' friend joined an event' else ' friends joined events' end); end if;
        end if;
        perform public.push_notification(r.id, 'digest', ttl, array_to_string(parts, ' · '), '/');
        sent := sent + 1;
      end if;
    exception when others then
      -- One bad row must not stop everyone else's digest; its claim is undone
      -- with it, so a re-run tries again.
      raise warning 'send_weekly_digest: user % not sent: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;

  return sent;
end $$;


-- ------------------------------------------------------------
-- 5. Friends going — for the feed and the event page
-- ------------------------------------------------------------
-- For each of the given events: how many of your friends are accepted, and
-- the first names + avatars of up to three of them (those with a photo
-- first). Events with no friends going are left out.
create or replace function public.friends_going(p_posts uuid[])
returns table (post_id uuid, n integer, names text[], avatars text[])
language plpgsql stable security definer set search_path = public as $$
declare
  me      uuid := auth.uid();
  friends uuid[];
begin
  if me is null or p_posts is null or cardinality(p_posts) = 0 then return; end if;
  -- One feed page at a time, not the whole table.
  if cardinality(p_posts) > 200 then p_posts := p_posts[1:200]; end if;

  select coalesce(array_agg(distinct fid), '{}') into friends
    from (select case when c.requester_id = me then c.target_id else c.requester_id end as fid
            from public.connections c
           where c.status = 'accepted'
             and (c.requester_id = me or c.target_id = me)) f
   where fid <> me;

  if cardinality(friends) > 0 and to_regprocedure('public.is_blocked_between(uuid,uuid)') is not null then
    select coalesce(array_agg(f), '{}') into friends
      from unnest(friends) f
     where not public.is_blocked_between(me, f);
  end if;
  if cardinality(friends) = 0 then return; end if;

  return query
    with going as (
      select a.post_id as pid, pr.id as uid,
             nullif(split_part(btrim(coalesce(pr.full_name, '')), ' ', 1), '') as first_name,
             nullif(btrim(pr.avatar_url), '') as avatar,
             row_number() over (
               partition by a.post_id
               order by (nullif(btrim(pr.avatar_url), '') is null),
                        a.accepted_at desc nulls last, a.created_at desc, pr.id) as rn
        from public.applications a
        join public.profiles pr on pr.id = a.applicant_id
       where a.post_id = any(p_posts)
         and a.status = 'accepted'
         and a.applicant_id = any(friends)
    )
    select g.pid,
           count(*)::int,
           coalesce(array_agg(coalesce(g.first_name, 'Friend') order by g.rn) filter (where g.rn <= 3), '{}'),
           coalesce(array_agg(coalesce(g.avatar, '') order by g.rn) filter (where g.rn <= 3), '{}')
      from going g
     group by g.pid;
end $$;


-- ------------------------------------------------------------
-- 6. Every Sunday 19:00 Tashkent = 14:00 UTC (pg_cron runs in UTC)
-- ------------------------------------------------------------
do $do$
begin
  if to_regclass('cron.job') is null then
    raise notice 'Weekly digest installed but NOT scheduled: enable pg_cron, then run 31 again.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'tadbirly-weekly-digest') then
    perform cron.unschedule('tadbirly-weekly-digest');
  end if;
  perform cron.schedule('tadbirly-weekly-digest', '0 14 * * 0', 'select public.send_weekly_digest()');
end $do$;


-- ------------------------------------------------------------
-- 7. Who may call what
-- ------------------------------------------------------------
-- The digest and the helpers are server-only (cron runs as postgres, the
-- owner; a trigger needs no EXECUTE grant). friends_going: signed-in only.
revoke execute on function public.send_weekly_digest(timestamptz)          from public, anon, authenticated;
revoke execute on function public.stamp_application_accepted_at()          from public, anon, authenticated;
revoke execute on function public.digest_ru_plural(integer, text, text, text)     from public, anon, authenticated;
revoke execute on function public.friends_going(uuid[])                    from public, anon;
grant  execute on function public.friends_going(uuid[])                    to authenticated;

notify pgrst, 'reload schema';

commit;


select case
  when to_regclass('cron.job') is null then
    'Tadbirly 31 installed, weekly digest NOT scheduled: enable pg_cron, then run this file again.'
  else
    'Tadbirly 31 installed: tadbirly-weekly-digest runs Sundays 19:00 Tashkent.'
end as result;
