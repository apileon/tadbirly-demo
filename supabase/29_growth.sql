-- ============================================================
--  Tadbirly — 29: growth features
--
--    1. Saved events            saved_posts (bookmarks, private to you)
--    2. Reminders for saved     "Deadline tomorrow" / "Tomorrow: <event>"
--                               for bookmarked events you haven't applied to
--    3. Interests + onboarding  profiles.interests, profiles.onboarded,
--                               profiles.locale
--    4. Richer events           posts.language, is_free, fee, is_online,
--                               lat/lng (map), questions (custom form)
--                               applications.answers
--    5. Views + organizer stats post_views, record_post_view(),
--                               organizer_event_stats()
--    6. Reviews                 event_reviews + organizer_rating()
--    7. QR check-in             applications.checkin_code + check_in_by_code()
--    8. Team matching           teams.skills_needed
--
--  Run AFTER 25 (reminders). Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Saved events
-- ------------------------------------------------------------
create table if not exists public.saved_posts (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.saved_posts enable row level security;
drop policy if exists "saved read own"   on public.saved_posts;
drop policy if exists "saved insert own" on public.saved_posts;
drop policy if exists "saved delete own" on public.saved_posts;
create policy "saved read own"   on public.saved_posts for select using (auth.uid() = user_id);
create policy "saved insert own" on public.saved_posts for insert with check (auth.uid() = user_id);
create policy "saved delete own" on public.saved_posts for delete using (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 3. Interests, onboarding, language
-- ------------------------------------------------------------
alter table public.profiles add column if not exists interests text[] not null default '{}';
alter table public.profiles add column if not exists onboarded boolean not null default false;
alter table public.profiles add column if not exists locale text;            -- en | uz | ru
-- Everyone who already uses the app has effectively onboarded.
update public.profiles set onboarded = true
 where onboarded = false and created_at < now() - interval '1 hour';


-- ------------------------------------------------------------
-- 4. Richer events + custom application questions
-- ------------------------------------------------------------
alter table public.posts add column if not exists language  text;           -- uz | ru | en | mixed
alter table public.posts add column if not exists is_free   boolean not null default true;
alter table public.posts add column if not exists fee       text;           -- free text, e.g. "50 000 UZS"
alter table public.posts add column if not exists is_online boolean not null default false;
alter table public.posts add column if not exists lat double precision;
alter table public.posts add column if not exists lng double precision;
-- [{ "q": "Why do you want to join?", "required": true }, …] — at most 5.
alter table public.posts add column if not exists questions jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists views integer not null default 0;

alter table public.applications add column if not exists answers jsonb;     -- ["answer 1", "answer 2", …]


-- ------------------------------------------------------------
-- 5. Views (one per person per event per day) + organizer stats
-- ------------------------------------------------------------
create table if not exists public.post_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null default (now() at time zone 'Asia/Tashkent')::date,
  primary key (post_id, user_id, day)
);
alter table public.post_views enable row level security;   -- no policies: functions only

create or replace function public.record_post_view(p uuid)
returns void language plpgsql security definer set search_path = public as $$
declare fresh boolean;
begin
  if auth.uid() is null then return; end if;
  -- The organizer opening their own event isn't a view.
  if exists (select 1 from public.posts where id = p and author_id = auth.uid()) then return; end if;
  insert into public.post_views (post_id, user_id) values (p, auth.uid())
  on conflict do nothing returning true into fresh;
  if fresh then update public.posts set views = views + 1 where id = p; end if;
end $$;


-- ------------------------------------------------------------
-- 6. Reviews — only from accepted participants, once the event day has come
-- ------------------------------------------------------------
create table if not exists public.event_reviews (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (char_length(coalesce(comment, '')) <= 1000),
  created_at  timestamptz not null default now(),
  unique (post_id, reviewer_id)
);
alter table public.event_reviews enable row level security;
drop policy if exists "reviews read"   on public.event_reviews;
drop policy if exists "reviews insert" on public.event_reviews;
drop policy if exists "reviews update" on public.event_reviews;
drop policy if exists "reviews delete" on public.event_reviews;
create policy "reviews read" on public.event_reviews for select using (true);
create policy "reviews insert" on public.event_reviews for insert with check (
  auth.uid() = reviewer_id
  and exists (
    select 1 from public.applications a
      join public.posts p on p.id = a.post_id
     where a.post_id = event_reviews.post_id
       and a.applicant_id = auth.uid()
       and a.status = 'accepted'
       and (p.status = 'completed'
            or p.event_date <= (now() at time zone 'Asia/Tashkent')::date)
  )
);
create policy "reviews update" on public.event_reviews for update using (auth.uid() = reviewer_id);
create policy "reviews delete" on public.event_reviews for delete using (auth.uid() = reviewer_id);

-- Average across all of an organizer's events.
create or replace function public.organizer_rating(target uuid)
returns table (rating numeric, reviews bigint, events bigint, participants bigint)
language sql stable security definer set search_path = public as $$
  select (select round(avg(r.rating)::numeric, 1) from public.event_reviews r
            join public.posts p on p.id = r.post_id where p.author_id = target),
         (select count(*) from public.event_reviews r
            join public.posts p on p.id = r.post_id where p.author_id = target),
         (select count(*) from public.posts p where p.author_id = target),
         (select count(*) from public.applications a
            join public.posts p on p.id = a.post_id
           where p.author_id = target and a.status = 'accepted');
$$;


-- One row per event of the calling organizer.
create or replace function public.organizer_event_stats()
returns table (
  post_id uuid, title text, event_date date, status text, views integer,
  applied bigint, accepted bigint, checked_in bigint, saves bigint,
  rating numeric, reviews bigint
) language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.event_date, p.status, p.views,
         (select count(*) from public.applications a where a.post_id = p.id),
         (select count(*) from public.applications a where a.post_id = p.id and a.status = 'accepted'),
         (select count(*) from public.applications a where a.post_id = p.id and a.checked_in),
         (select count(*) from public.saved_posts s where s.post_id = p.id),
         (select round(avg(r.rating)::numeric, 1) from public.event_reviews r where r.post_id = p.id),
         (select count(*) from public.event_reviews r where r.post_id = p.id)
    from public.posts p
   where p.author_id = auth.uid()
   order by p.created_at desc;
$$;


-- ------------------------------------------------------------
-- 7. QR check-in — the participant shows a code, the organizer scans it
-- ------------------------------------------------------------
alter table public.applications add column if not exists checkin_code uuid not null default gen_random_uuid();
create unique index if not exists applications_checkin_code_key on public.applications (checkin_code);

-- Returns {ok, name, already} or {ok:false, error}. Only the event's
-- organizer can check someone in, and only accepted participants.
create or replace function public.check_in_by_code(p_post uuid, p_code uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not exists (select 1 from public.posts where id = p_post and author_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Only the organizer of this event can check people in.');
  end if;
  select ap.id, ap.status, ap.checked_in, pr.full_name into a
    from public.applications ap join public.profiles pr on pr.id = ap.applicant_id
   where ap.post_id = p_post and ap.checkin_code = p_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This code is not a ticket for this event.');
  end if;
  if a.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'error', coalesce(a.full_name, 'This person') || ' is not accepted to this event.');
  end if;
  if a.checked_in then
    return jsonb_build_object('ok', true, 'already', true, 'name', a.full_name);
  end if;
  update public.applications set checked_in = true where id = a.id;
  return jsonb_build_object('ok', true, 'already', false, 'name', a.full_name);
end $$;


-- ------------------------------------------------------------
-- 8. Team matching
-- ------------------------------------------------------------
alter table public.teams add column if not exists skills_needed text[] not null default '{}';


-- ------------------------------------------------------------
-- 2. Reminders for saved events (uses event_reminders_sent from 25)
-- ------------------------------------------------------------
create or replace function public.send_saved_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  now_tk   timestamp := p_now at time zone 'Asia/Tashkent';
  today_tk date      := (p_now at time zone 'Asia/Tashkent')::date;
  r        record;
  fresh    boolean;
  sent     integer := 0;
begin
  -- Only in the daytime, so nobody is woken up by a bookmark.
  if now_tk::time < time '09:00' or now_tk::time >= time '21:00' then return 0; end if;
  for r in
    select s.post_id, s.user_id, d.kind, d.title, d.body
      from public.saved_posts s
      join public.posts p on p.id = s.post_id
      cross join lateral (
        select 'saved_deadline' as kind,
               'Applications close tomorrow' as title,
               p.title || ' · apply today so you don''t miss it' as body
         where p.deadline = today_tk + 1
        union all
        select 'saved_eve', 'Tomorrow: ' || p.title,
               concat_ws(' · ', 'Starts ' || to_char(p.start_time, 'HH24:MI'), nullif(btrim(p.location), ''))
         where p.event_date = today_tk + 1
      ) d
     where p.status = 'open'
       and coalesce(to_jsonb(p) ->> 'moderation', 'approved') <> 'removed'
       -- Applied already? The accepted-student reminders in 25 cover that.
       and not exists (select 1 from public.applications a where a.post_id = p.id and a.applicant_id = s.user_id)
       and not exists (select 1 from public.event_reminders_sent x
                        where x.post_id = s.post_id and x.user_id = s.user_id and x.kind = d.kind)
  loop
    begin
      insert into public.event_reminders_sent (post_id, user_id, kind)
      values (r.post_id, r.user_id, r.kind)
      on conflict do nothing returning true into fresh;
      if fresh then
        perform public.push_notification(r.user_id, 'reminder', r.title,
          coalesce(nullif(r.body, ''), 'Tap to see the details.'), '/post/' || r.post_id);
        sent := sent + 1;
      end if;
    exception when others then
      raise warning 'send_saved_reminders: % for post % / user %: %', r.kind, r.post_id, r.user_id, sqlerrm;
    end;
  end loop;
  return sent;
end $$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'tadbirly-saved-reminders') then
      perform cron.unschedule('tadbirly-saved-reminders');
    end if;
    perform cron.schedule('tadbirly-saved-reminders', '*/30 * * * *', 'select public.send_saved_reminders()');
  end if;
end $do$;


-- ------------------------------------------------------------
-- Who may call what
-- ------------------------------------------------------------
revoke execute on function public.send_saved_reminders(timestamptz) from public, anon, authenticated;
revoke execute on function public.record_post_view(uuid)        from public, anon;
revoke execute on function public.organizer_event_stats()       from public, anon;
revoke execute on function public.check_in_by_code(uuid, uuid)  from public, anon;
revoke execute on function public.organizer_rating(uuid)        from public, anon;
grant  execute on function public.record_post_view(uuid)        to authenticated;
grant  execute on function public.organizer_event_stats()       to authenticated;
grant  execute on function public.check_in_by_code(uuid, uuid)  to authenticated;
grant  execute on function public.organizer_rating(uuid)        to authenticated;

select 'Tadbirly 29 installed' as result,
       exists (select 1 from pg_extension where extname = 'pg_cron') as saved_reminders_scheduled;
