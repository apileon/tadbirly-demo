-- Minimal stand-in for the parts of the live Supabase database that
-- 32_tournaments.sql relies on. Local tests only — never run on the live DB.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's defaults: new tables and functions are granted to the API roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key,
  full_name text,
  avatar_url text,
  skills text[],
  is_admin boolean not null default false
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'event',
  title text not null,
  description text,
  category text,
  event_date date,
  start_time time,
  status text not null default 'open',
  moderation text not null default 'approved',
  team_mode text not null default 'solo',
  team_min integer
);
alter table public.posts enable row level security;
create policy "posts read" on public.posts for select using (moderation <> 'removed' or auth.uid() = author_id);
create policy "posts insert" on public.posts for insert with check (auth.uid() = author_id);
create policy "posts update" on public.posts for update using (auth.uid() = author_id);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  checked_in boolean not null default false,
  accepted_at timestamptz,
  checkin_code text,
  answers jsonb,
  created_at timestamptz not null default now(),
  unique (post_id, applicant_id)
);
alter table public.applications enable row level security;
create policy "apps read" on public.applications for select using (
  applicant_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
create policy "apps update" on public.applications for update using (
  exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  emoji text default '🏅',
  description text,
  created_at timestamptz not null default now(),
  unique (post_id)
);
alter table public.badges enable row level security;
create policy "badges read" on public.badges for select using (true);

create table public.awards (
  id uuid primary key default gen_random_uuid(),
  badge_id uuid not null references public.badges(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  awarded_by uuid not null references public.profiles(id) on delete cascade,
  note text,
  verified boolean not null default true,
  pinned boolean not null default false,
  kind text not null default 'medal',
  place integer,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (badge_id, recipient_id)
);
alter table public.awards enable row level security;
create policy "awards read" on public.awards for select using (true);
create policy "awards insert" on public.awards for insert with check (
  awarded_by = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

create or replace function public.check_award_points() returns trigger language plpgsql as $$
begin
  if new.points is not null and (new.points < 0 or new.points > 100) then
    raise exception 'Points must be between 0 and 100';
  end if;
  return new;
end $$;
create trigger check_award_points before insert or update of points on public.awards
  for each row execute function public.check_award_points();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "notif read own" on public.notifications for select using (user_id = auth.uid());

create or replace function public.push_notification(uid uuid, ntype text, ntitle text, nbody text, nlink text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link)
  select uid, ntype, ntitle, nbody, nlink where uid is not null;
$$;
revoke all on function public.push_notification(uuid, text, text, text, text) from public, anon, authenticated;

-- Award → notification, like 16_notifications_avatars.sql.
create or replace function public.notify_award() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_notification(new.recipient_id, 'award', 'You received an award', '', '/post/' || new.post_id);
  return null;
end $$;
create trigger trg_notify_award after insert on public.awards for each row execute function public.notify_award();

create or replace function public.is_event_organizer(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where id = p and author_id = auth.uid());
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable as $$ select false $$;

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
