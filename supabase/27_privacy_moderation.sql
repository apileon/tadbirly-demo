-- ============================================================
--  Tadbirly — 27: App Store / Google Play — moderation, terms,
--  contact privacy, account-deletion helper
--
--  Run AFTER 23, 24 and 25. All-or-nothing (one transaction) and
--  safe to re-run. Every part checks what your live database
--  actually has, so a file you never ran (e.g. 12_results) can't
--  make this one fail.
--
--  PART A  Reports: what was reported, why, and whether it's handled
--  PART B  Admins: profiles.is_admin (only you can set it) + a push
--          to every admin the moment something is reported
--  PART C  Terms: profiles.terms_accepted_at, stamped at sign-up
--  PART D  Contact privacy: public.contact_details(target)
--  PART E  Account deletion: list a user's uploaded files (service role only)
--
--  AFTER RUNNING — make yourself the moderator (Supabase → SQL editor):
--     update public.profiles set is_admin = true
--      where id = (select id from auth.users where email = 'YOUR_EMAIL');
--
--  Handling reports (Apple expects action within 24 hours):
--     select r.created_at, r.target_type, r.target_id, r.reason, r.details,
--            rep.full_name as reporter, bad.full_name as reported_user, r.id
--       from public.reports r
--       left join public.profiles rep on rep.id = r.reporter_id
--       left join public.profiles bad on bad.id = r.reported_user_id
--      where r.status = 'open' order by r.created_at;
--   Remove an event:      update public.posts set moderation = 'removed' where id = '<target_id>';
--   Remove other content: delete from public.news_posts / news_comments /
--                         messages / event_messages where id = '<target_id>';
--   Eject a user:         Supabase → Authentication → Users → delete (or ban) them.
--   Close the report:     update public.reports set status = 'resolved',
--                           resolved_at = now(), admin_note = '...' where id = '<id>';
-- ============================================================

begin;

-- ============================================================
-- PART A — REPORTS
-- ============================================================

-- 02_moderation normally created this. If it never ran, create it the same way.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;

-- What was reported. target_type: user | event | news | comment | message |
-- event_message | team | chat. target_id is that row's id (all uuids).
alter table public.reports add column if not exists target_type text;
alter table public.reports add column if not exists target_id   uuid;
alter table public.reports add column if not exists details     text;
alter table public.reports add column if not exists status      text not null default 'open';  -- open | resolved | dismissed
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists resolved_by uuid;
alter table public.reports add column if not exists admin_note  text;

-- Old reports (filed from the event page) were about an event or a user.
update public.reports
   set target_type = case when post_id is not null then 'event' else 'user' end,
       target_id   = coalesce(post_id, reported_user_id)
 where target_type is null and (post_id is not null or reported_user_id is not null);

-- Checked for new rows only (NOT VALID), so no old row can make this fail.
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reports_target_type_check'
                    and conrelid = 'public.reports'::regclass) then
    alter table public.reports add constraint reports_target_type_check
      check (target_type is null or target_type in
             ('user', 'event', 'news', 'comment', 'message', 'event_message', 'team', 'chat'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reports_status_check'
                    and conrelid = 'public.reports'::regclass) then
    alter table public.reports add constraint reports_status_check
      check (status in ('open', 'resolved', 'dismissed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reports_text_length_check'
                    and conrelid = 'public.reports'::regclass) then
    alter table public.reports add constraint reports_text_length_check
      check (char_length(coalesce(reason, '')) <= 200
             and char_length(coalesce(details, '')) <= 2000) not valid;
  end if;
end $do$;

create index if not exists reports_open_idx on public.reports (status, created_at);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);

-- ============================================================
-- PART B — ADMINS
-- ============================================================

alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- Reports: you can file one and see your own (02); admins see and update all.
drop policy if exists "reports admin read" on public.reports;
create policy "reports admin read" on public.reports
  for select to authenticated using (public.is_admin());

drop policy if exists "reports admin update" on public.reports;
create policy "reports admin update" on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- A filed report always starts "open" (a client can't file it as already
-- handled), and one person can't flood the admins' phones.
create or replace function public.prepare_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.status      := 'open';
    new.resolved_at := null;
    new.resolved_by := null;
    new.admin_note  := null;
    new.created_at  := now();
    if (select count(*) from public.reports r
         where r.reporter_id = new.reporter_id
           and r.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'Too many reports in a short time. Please try again later.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists prepare_report on public.reports;
create trigger prepare_report
  before insert on public.reports
  for each row execute function public.prepare_report();

-- Every admin gets a push the moment something is reported. Never blocks
-- the report itself: if the push fails, the report is still saved.
create or replace function public.notify_admins_of_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  adm   record;
  who   text;
  title text;
  msg   text;
begin
  begin
    if to_regprocedure('public.push_notification(uuid, text, text, text, text)') is null then
      return null;
    end if;

    select full_name into who from public.profiles where id = new.reported_user_id;
    title := '⚑ New report: ' || coalesce(nullif(new.reason, ''), 'no reason');
    msg   := coalesce(new.target_type, 'content')
             || case when who is not null then ' by ' || who else '' end
             || coalesce(' — ' || left(nullif(new.details, ''), 100), '')
             || '. Please review within 24h.';

    for adm in
      select p.id from public.profiles p
       where p.is_admin = true and p.id is distinct from new.reporter_id
    loop
      perform public.push_notification(adm.id, 'report', title, msg, '/legal');
    end loop;
  exception when others then
    raise warning 'notify_admins_of_report: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_admins_of_report on public.reports;
create trigger notify_admins_of_report
  after insert on public.reports
  for each row execute function public.notify_admins_of_report();

revoke execute on function public.prepare_report()          from public, anon, authenticated;
revoke execute on function public.notify_admins_of_report() from public, anon, authenticated;

-- ============================================================
-- PART C — TERMS ACCEPTANCE
-- ============================================================

alter table public.profiles add column if not exists terms_accepted_at timestamptz;

-- The sign-up form sends terms_accepted in the account's metadata (it has no
-- session yet when email confirmation is on). When the profile row is
-- created for the new account, stamp it with the server's clock. Wrapped so
-- that nothing here can ever make a sign-up fail.
create or replace function public.stamp_terms_on_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare meta jsonb;
begin
  begin
    if new.terms_accepted_at is null then
      select u.raw_user_meta_data into meta from auth.users u where u.id = new.id;
      if meta is not null
         and (lower(coalesce(meta->>'terms_accepted', '')) = 'true'
              or meta ? 'terms_accepted_at') then
        new.terms_accepted_at := now();
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists stamp_terms_on_profile on public.profiles;
create trigger stamp_terms_on_profile
  before insert on public.profiles
  for each row execute function public.stamp_terms_on_profile();

revoke execute on function public.stamp_terms_on_profile() from public, anon, authenticated;

-- ---------- Trust fields, now including is_admin and terms ----------
-- Re-created from the live definition (23, B1) with two additions:
--   • is_admin can never be changed through the app — only from the dashboard
--   • terms_accepted_at: you can record your own acceptance once (stamped
--     with the server's clock); after that it never changes
-- Built from the columns your database really has, so a missing column
-- can't break every profile save.
do $do$
declare
  self_lines text := '';
  c text;
begin
  foreach c in array array['reliability', 'is_pro', 'posts_this_month', 'streak_count'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'profiles' and column_name = c) then
      self_lines := self_lines || format('      new.%1$I := old.%1$I;', c) || E'\n';
    end if;
  end loop;

  execute format($fn$
create or replace function public.freeze_trust_fields()
returns trigger language plpgsql as $body$
begin
  if auth.uid() is not null then
    new.role             := old.role;
    new.verified_student := old.verified_student;
    new.is_admin         := old.is_admin;
    if auth.uid() = new.id then
%s
      if old.terms_accepted_at is not null then
        new.terms_accepted_at := old.terms_accepted_at;
      elsif new.terms_accepted_at is not null then
        new.terms_accepted_at := now();
      end if;
    else
      new.terms_accepted_at := old.terms_accepted_at;
    end if;
  end if;
  return new;
end $body$;
$fn$, self_lines);
end $do$;

drop trigger if exists freeze_trust_fields on public.profiles;
create trigger freeze_trust_fields
  before update on public.profiles
  for each row execute function public.freeze_trust_fields();

-- ============================================================
-- PART D — CONTACT PRIVACY
-- ============================================================
-- A student's phone / Telegram / LinkedIn are shown only to:
--   • themselves
--   • accepted friends
--   • organizers of events the student applied to (alone, or in a team)
-- and an organizer's contacts are shown to people who applied to their
-- events. Never between two people where one has blocked the other.
-- Returns no row at all when the viewer isn't allowed.
create or replace function public.contact_details(target uuid)
returns table (phone text, telegram text, linkedin text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  ok boolean := false;
begin
  if me is null or target is null then return; end if;

  if me = target then
    ok := true;
  else
    if to_regclass('public.blocks') is not null and exists (
         select 1 from public.blocks b
          where (b.blocker_id = me and b.blocked_id = target)
             or (b.blocker_id = target and b.blocked_id = me)) then
      return;
    end if;

    -- accepted friends
    if to_regclass('public.connections') is not null and exists (
         select 1 from public.connections c
          where c.status = 'accepted'
            and ((c.requester_id = me and c.target_id = target)
              or (c.requester_id = target and c.target_id = me))) then
      ok := true;
    end if;

    -- one of them applied to an event the other organizes
    if not ok and exists (
         select 1 from public.applications a
           join public.posts p on p.id = a.post_id
          where (a.applicant_id = target and p.author_id = me)
             or (a.applicant_id = me and p.author_id = target)) then
      ok := true;
    end if;

    -- a team one of them is in applied to an event the other organizes
    -- (accepted teams also get one application row per member, but a team
    -- that is still pending only exists here)
    if not ok and to_regclass('public.team_applications') is not null
       and to_regclass('public.team_members') is not null and exists (
         select 1 from public.team_applications ta
           join public.posts p on p.id = ta.post_id
           join public.team_members tm on tm.team_id = ta.team_id and tm.status = 'accepted'
          where (tm.user_id = target and p.author_id = me)
             or (tm.user_id = me and p.author_id = target)) then
      ok := true;
    end if;
    if not ok and to_regclass('public.team_applications') is not null and exists (
         select 1 from public.team_applications ta
           join public.posts p on p.id = ta.post_id
          where (ta.applied_by = target and p.author_id = me)
             or (ta.applied_by = me and p.author_id = target)) then
      ok := true;
    end if;
  end if;

  if not ok then return; end if;

  return query
    select pr.phone, pr.telegram, pr.linkedin
      from public.profiles pr
     where pr.id = target;
end $$;

revoke execute on function public.contact_details(uuid) from public, anon;
grant  execute on function public.contact_details(uuid) to authenticated;

-- NOTE: the phone / telegram / linkedin COLUMNS are still readable by any
-- signed-in user straight from the profiles table, because the app loads
-- whole profile rows with select('*') (lib/auth.js, app/passport.js). Once
-- those callers list their columns, close it with:
--   revoke select on public.profiles from anon, authenticated;
--   grant select (<every column except phone, telegram, linkedin>)
--     on public.profiles to authenticated;

-- ============================================================
-- PART E — ACCOUNT DELETION: the files a user uploaded
-- ============================================================
-- Used by the delete-account edge function (service role only) to remove
-- someone's photos from Storage before their account is deleted. Files are
-- named randomly, so the owner column is the only way to find them.
create or replace function public.storage_objects_owned_by(uid uuid)
returns table (bucket_id text, name text)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if uid is null or to_regclass('storage.objects') is null then return; end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    return query execute
      'select o.bucket_id::text, o.name::text from storage.objects o
        where o.bucket_id in (''avatars'', ''covers'', ''news'')
          and (o.owner = $1 or o.owner_id = $1::text)'
      using uid;
  else
    return query execute
      'select o.bucket_id::text, o.name::text from storage.objects o
        where o.bucket_id in (''avatars'', ''covers'', ''news'') and o.owner = $1'
      using uid;
  end if;
end $$;

revoke execute on function public.storage_objects_owned_by(uuid) from public, anon, authenticated;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.storage_objects_owned_by(uuid) to service_role';
  end if;
end $do$;

commit;
