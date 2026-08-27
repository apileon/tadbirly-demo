-- ============================================================
--  Tadbirly — Supabase schema
--  Run this in Supabase Studio > SQL Editor (once).
--  It creates tables, relationships, and Row Level Security
--  so users can only touch data they're allowed to.
-- ============================================================

-- ---------- PROFILES ----------
-- One row per auth user. Created automatically on sign up (trigger below).
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role text not null default 'participant',      -- participant | organizer | renter
  city text default 'Tashkent',
  university text,
  faculty text,
  major text,
  academic_year text,
  languages text[],
  skills text[],
  reliability integer not null default 100,       -- 0-100, grows with verified attendance
  is_pro boolean not null default false,
  verified_student boolean not null default false,
  posts_this_month integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- POSTS ----------  (events, requests, internships, MUN)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                              -- event | request | internship | mun
  title text not null,
  description text,
  category text,                                   -- e.g. Hackathon, Volunteering
  city text default 'Tashkent',
  location text,
  event_date date,
  deadline date,
  spots integer,
  looking_for text,
  status text not null default 'open',             -- open | closed | completed
  boosted boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- APPLICATIONS ----------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending',          -- pending | accepted | rejected
  checked_in boolean not null default false,
  created_at timestamptz not null default now(),
  unique (post_id, applicant_id)
);

-- ---------- CHATS + MESSAGES ----------  (chat opens after applying)
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, participant_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- VENUES ----------
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text,                                       -- Auditorium | Conference hall | Open air | ...
  city text default 'Tashkent',
  area_m2 integer,
  capacity integer,
  price_per_day integer,                           -- in so'm; 0 = free
  amenities text[],
  verified boolean not null default false,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.venue_bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  event_date date,
  status text not null default 'pending',          -- pending | approved | declined
  created_at timestamptz not null default now()
);

-- ============================================================
--  Auto-create a profile row whenever a new auth user signs up
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'New user'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
--  Row Level Security
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.posts          enable row level security;
alter table public.applications   enable row level security;
alter table public.chats          enable row level security;
alter table public.messages       enable row level security;
alter table public.venues         enable row level security;
alter table public.venue_bookings enable row level security;

-- Profiles: everyone can read (public directory); you edit only your own.
create policy "profiles read"   on public.profiles for select using (true);
create policy "profiles update" on public.profiles for update using (auth.uid() = id);

-- Posts: anyone can read; author manages their own.
create policy "posts read"   on public.posts for select using (true);
create policy "posts insert" on public.posts for insert with check (auth.uid() = author_id);
create policy "posts update" on public.posts for update using (auth.uid() = author_id);
create policy "posts delete" on public.posts for delete using (auth.uid() = author_id);

-- Applications: applicant and post author can see; applicant creates; author can update status.
create policy "apps read" on public.applications for select using (
  auth.uid() = applicant_id
  or auth.uid() = (select author_id from public.posts p where p.id = post_id)
);
create policy "apps insert" on public.applications for insert with check (auth.uid() = applicant_id);
create policy "apps update" on public.applications for update using (
  auth.uid() = applicant_id
  or auth.uid() = (select author_id from public.posts p where p.id = post_id)
);

-- Chats: only the two members can see/create.
create policy "chats read"   on public.chats for select using (
  auth.uid() = participant_id or auth.uid() = organizer_id
);
create policy "chats insert" on public.chats for insert with check (
  auth.uid() = participant_id or auth.uid() = organizer_id
);

-- Messages: only members of the parent chat.
create policy "messages read" on public.messages for select using (
  exists (select 1 from public.chats c
          where c.id = chat_id
            and (c.participant_id = auth.uid() or c.organizer_id = auth.uid()))
);
create policy "messages insert" on public.messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from public.chats c
              where c.id = chat_id
                and (c.participant_id = auth.uid() or c.organizer_id = auth.uid()))
);

-- Venues: public read; owner manages.
create policy "venues read"   on public.venues for select using (true);
create policy "venues insert" on public.venues for insert with check (auth.uid() = owner_id);
create policy "venues update" on public.venues for update using (auth.uid() = owner_id);

-- Venue bookings: requester and venue owner.
create policy "vbook read" on public.venue_bookings for select using (
  auth.uid() = requester_id
  or auth.uid() = (select owner_id from public.venues v where v.id = venue_id)
);
create policy "vbook insert" on public.venue_bookings for insert with check (auth.uid() = requester_id);
create policy "vbook update" on public.venue_bookings for update using (
  auth.uid() = (select owner_id from public.venues v where v.id = venue_id)
);

-- Enable realtime for chat (Supabase: also toggle Replication for these tables in the dashboard).
alter publication supabase_realtime add table public.messages;
