-- ============================================================
--  Tadbirly — Social (news + comments + likes) and Team events
--  Run once in Supabase SQL Editor.
-- ============================================================

-- ========== NEWS ==========
create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.news_posts enable row level security;

drop policy if exists "news read" on public.news_posts;
create policy "news read" on public.news_posts for select using (true);

-- Only organizers may publish news.
drop policy if exists "news insert" on public.news_posts;
create policy "news insert" on public.news_posts for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'organizer')
);

drop policy if exists "news update" on public.news_posts;
create policy "news update" on public.news_posts for update using (author_id = auth.uid());

drop policy if exists "news delete" on public.news_posts;
create policy "news delete" on public.news_posts for delete using (author_id = auth.uid());

-- Comments (anyone signed in)
create table if not exists public.news_comments (
  id uuid primary key default gen_random_uuid(),
  news_id uuid not null references public.news_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.news_comments enable row level security;

drop policy if exists "ncomment read" on public.news_comments;
create policy "ncomment read" on public.news_comments for select using (true);

drop policy if exists "ncomment insert" on public.news_comments;
create policy "ncomment insert" on public.news_comments for insert with check (author_id = auth.uid());

-- You can delete your own comment; the news author can moderate any comment on their post.
drop policy if exists "ncomment delete" on public.news_comments;
create policy "ncomment delete" on public.news_comments for delete using (
  author_id = auth.uid()
  or exists (select 1 from public.news_posts n where n.id = news_id and n.author_id = auth.uid())
);

-- Likes
create table if not exists public.news_likes (
  news_id uuid not null references public.news_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (news_id, user_id)
);
alter table public.news_likes enable row level security;

drop policy if exists "nlike read" on public.news_likes;
create policy "nlike read" on public.news_likes for select using (true);

drop policy if exists "nlike insert" on public.news_likes;
create policy "nlike insert" on public.news_likes for insert with check (user_id = auth.uid());

drop policy if exists "nlike delete" on public.news_likes;
create policy "nlike delete" on public.news_likes for delete using (user_id = auth.uid());

-- Public image bucket for news photos
insert into storage.buckets (id, name, public)
values ('news', 'news', true)
on conflict (id) do nothing;

drop policy if exists "news img read" on storage.objects;
create policy "news img read" on storage.objects
  for select using (bucket_id = 'news');

drop policy if exists "news img insert" on storage.objects;
create policy "news img insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'news'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'organizer')
  );

drop policy if exists "news img delete" on storage.objects;
create policy "news img delete" on storage.objects
  for delete to authenticated using (bucket_id = 'news' and owner = auth.uid());

-- ========== TEAM EVENTS ==========
-- Does this event want solo applicants or teams?
alter table public.posts add column if not exists team_mode text not null default 'solo'; -- solo | team
alter table public.posts add column if not exists team_min integer;

create or replace function public.is_team_owner(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = t and owner_id = auth.uid());
$$;

create or replace function public.is_event_organizer(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where id = p and author_id = auth.uid());
$$;

-- A whole team applying to an event
create table if not exists public.team_applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  applied_by uuid not null references public.profiles(id) on delete cascade,
  message text,
  status text not null default 'pending',  -- pending | accepted | rejected
  created_at timestamptz not null default now(),
  unique (post_id, team_id)
);
alter table public.team_applications enable row level security;

drop policy if exists "tapp read" on public.team_applications;
create policy "tapp read" on public.team_applications for select using (
  public.is_event_organizer(post_id)
  or public.is_team_owner(team_id)
  or public.is_team_member(team_id)
);

drop policy if exists "tapp insert" on public.team_applications;
create policy "tapp insert" on public.team_applications for insert with check (
  applied_by = auth.uid() and public.is_team_owner(team_id)
);

drop policy if exists "tapp update" on public.team_applications;
create policy "tapp update" on public.team_applications for update using (
  public.is_event_organizer(post_id) or public.is_team_owner(team_id)
);

drop policy if exists "tapp delete" on public.team_applications;
create policy "tapp delete" on public.team_applications for delete using (
  public.is_team_owner(team_id)
);

-- The organizer (or a team member) may read a team's accepted roster.
create or replace function public.team_roster_for_event(t uuid, p uuid)
returns table (id uuid, full_name text, university text, major text, reliability integer, verified_student boolean)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.university, pr.major, pr.reliability, pr.verified_student
  from public.team_members tm
  join public.profiles pr on pr.id = tm.user_id
  where tm.team_id = t
    and tm.status = 'accepted'
    and (public.is_event_organizer(p) or public.is_team_member(t) or public.is_team_owner(t))
  order by pr.full_name;
$$;

-- Accepting a team accepts every member individually, so the event chat,
-- roster and awards keep working exactly as they do for solo applicants.
create or replace function public.accept_team_application(app_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.team_applications;
begin
  select * into a from public.team_applications where id = app_id;
  if a.id is null then raise exception 'Application not found'; end if;
  if not public.is_event_organizer(a.post_id) then
    raise exception 'Only the event organizer can accept a team';
  end if;

  update public.team_applications set status = 'accepted' where id = app_id;

  insert into public.applications (post_id, applicant_id, status)
  select a.post_id, tm.user_id, 'accepted'
  from public.team_members tm
  where tm.team_id = a.team_id and tm.status = 'accepted'
  on conflict (post_id, applicant_id) do update set status = 'accepted';
end $$;
