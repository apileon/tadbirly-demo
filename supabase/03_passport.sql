-- ============================================================
--  Tadbirly — Student Passport, badges & event-based reliability
--  Run in Supabase SQL Editor AFTER schema.sql and 02_moderation.sql.
-- ============================================================

-- Bio field for the passport
alter table public.profiles add column if not exists bio text;

-- Reliability is earned through verified events. Start everyone at 75.
alter table public.profiles alter column reliability set default 75;

-- ---------- BADGES ----------  (one medal design per event, made by the organizer)
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,                 -- e.g. "Model UN 2026 — Chair"
  emoji text default '🏅',
  description text,
  created_at timestamptz not null default now(),
  unique (post_id)
);

-- ---------- AWARDS ----------  (a badge given to a participant, with a note)
create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  badge_id uuid not null references public.badges(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  awarded_by uuid not null references public.profiles(id) on delete cascade,
  note text,                          -- e.g. "Ruled a Model UN with 3k participants"
  verified boolean not null default true,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  unique (badge_id, recipient_id)
);

alter table public.badges enable row level security;
alter table public.awards enable row level security;

-- Badges: public read; only the event's organizer manages
create policy "badges read"   on public.badges for select using (true);
create policy "badges insert" on public.badges for insert with check (auth.uid() = organizer_id);
create policy "badges update" on public.badges for update using (auth.uid() = organizer_id);

-- Awards: public read (they are profile achievements); organizer awards; recipient can pin
create policy "awards read"   on public.awards for select using (true);
create policy "awards insert" on public.awards for insert with check (auth.uid() = awarded_by);
create policy "awards update" on public.awards for update using (
  auth.uid() = recipient_id or auth.uid() = awarded_by
);
create policy "awards delete" on public.awards for delete using (auth.uid() = awarded_by);

-- ---------- Pin limit: at most 5 pinned per participant ----------
create or replace function public.enforce_pin_limit()
returns trigger language plpgsql as $$
begin
  if new.pinned then
    if (select count(*) from public.awards
        where recipient_id = new.recipient_id and pinned = true and id <> new.id) >= 5 then
      raise exception 'PIN_LIMIT: You can pin at most 5 events';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_pin_limit on public.awards;
create trigger trg_pin_limit before insert or update on public.awards
  for each row execute procedure public.enforce_pin_limit();

-- ---------- Reliability, decided by verified events ----------
create or replace function public.recompute_reliability(uid uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles
  set reliability = least(100, 75 + 5 * (
    select count(*) from public.awards a where a.recipient_id = uid and a.verified = true
  ))
  where id = uid;
$$;

create or replace function public.awards_reliability_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_reliability(coalesce(new.recipient_id, old.recipient_id));
  return null;
end; $$;
drop trigger if exists trg_awards_reliability on public.awards;
create trigger trg_awards_reliability after insert or update or delete on public.awards
  for each row execute procedure public.awards_reliability_trigger();

-- Normalize existing test users to the event-based score now
select public.recompute_reliability(id) from public.profiles;
