-- ============================================================
--  Tadbirly — 32: organizer-run teams & tournaments
--
--  Students apply to a team event with the normal one-button Apply. The
--  organizer then forms the teams from the accepted players, picks a format
--  (team vs team · group stage · playoff · hybrid), enters scores, and gives
--  medals to the top three teams.
--
--  The schedule itself is generated in the app (lib/tournament.js, unit
--  tested) and stored here in one call (save_schedule). Advancing winners,
--  filling the hybrid playoff from the group tables, finishing, and awarding
--  happen here.
--
--  The old student-built teams (teams / team_members / team_applications)
--  are left exactly as they are.
--
--  Safe to run more than once. Run after 31_digest_friends.sql.
-- ============================================================
begin;

-- ---------- posts: tournament settings ----------
alter table public.posts add column if not exists team_size integer;
alter table public.posts add column if not exists format text not null default 'none';
alter table public.posts add column if not exists group_count integer;
alter table public.posts add column if not exists advance_per_group integer;
alter table public.posts add column if not exists tournament_stage text not null default 'setup';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_team_size_range') then
    alter table public.posts add constraint posts_team_size_range
      check (team_size is null or team_size between 2 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_format_valid') then
    alter table public.posts add constraint posts_format_valid
      check (format in ('none', 'versus', 'groups', 'playoff', 'hybrid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_group_count_range') then
    alter table public.posts add constraint posts_group_count_range
      check (group_count is null or group_count between 1 and 16);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_advance_range') then
    alter table public.posts add constraint posts_advance_range
      check (advance_per_group is null or advance_per_group between 1 and 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_tournament_stage_valid') then
    alter table public.posts add constraint posts_tournament_stage_valid
      check (tournament_stage in ('setup', 'teams', 'running', 'finished'));
  end if;
end $do$;

-- A table called "matches" that isn't ours would make everything below
-- misbehave quietly ("create table if not exists" skips it). Stop instead.
do $do$
begin
  if to_regclass('public.matches') is not null
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'matches' and column_name = 'next_slot') then
    raise exception 'public.matches already exists with a different shape; rename it before running 32_tournaments.sql';
  end if;
end $do$;

-- ---------- teams (one per event, made by the organizer) ----------
create table if not exists public.event_teams (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  seed integer,
  group_no integer,
  created_at timestamptz not null default now(),
  unique (id, post_id)
);
create index if not exists event_teams_post_idx on public.event_teams (post_id);

-- A player is on at most one team per event (the primary key), and the team
-- must belong to that same event (the composite foreign key).
create table if not exists public.event_team_members (
  post_id uuid not null references public.posts(id) on delete cascade,
  team_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (team_id, post_id) references public.event_teams (id, post_id) on delete cascade
);
create index if not exists event_team_members_team_idx on public.event_team_members (team_id);
create index if not exists event_team_members_user_idx on public.event_team_members (user_id);

-- ---------- matches ----------
-- src_a / src_b: where a hybrid playoff slot comes from ('G1#2' = group 1,
-- 2nd place); the team is filled in when the group stage ends.
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  stage text not null check (stage in ('group', 'playoff')),
  group_no integer,
  round integer not null,
  slot integer not null,
  team_a uuid references public.event_teams(id) on delete set null,
  team_b uuid references public.event_teams(id) on delete set null,
  src_a text,
  src_b text,
  score_a integer,
  score_b integer,
  winner uuid references public.event_teams(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'done')),
  next_match_id uuid references public.matches(id) on delete set null,
  next_slot text check (next_slot in ('a', 'b')),
  created_at timestamptz not null default now()
);
create index if not exists matches_post_idx on public.matches (post_id);

-- ---------- Row security: everyone signed in can read what belongs to an
-- event they can see; only that event's organizer writes. ----------
alter table public.event_teams enable row level security;
alter table public.event_team_members enable row level security;
alter table public.matches enable row level security;

do $do$
declare tbl text;
begin
  foreach tbl in array array['event_teams', 'event_team_members', 'matches'] loop
    execute format('drop policy if exists "%1$s read" on public.%1$I', tbl);
    execute format('drop policy if exists "%1$s write" on public.%1$I', tbl);
    -- The subquery runs under posts' own row security, so a removed event's
    -- teams are hidden exactly like the event.
    execute format($p$create policy "%1$s read" on public.%1$I for select to authenticated
                     using (exists (select 1 from public.posts p where p.id = post_id))$p$, tbl);
    execute format($p$create policy "%1$s write" on public.%1$I for all to authenticated
                     using (public.is_event_organizer(post_id))
                     with check (public.is_event_organizer(post_id))$p$, tbl);
    execute format('revoke all on public.%I from anon', tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
  end loop;
end $do$;

-- ---------- The stage only moves through the functions below ----------
-- Clients can't set tournament_stage themselves, and once matches exist the
-- format can't be changed from the Edit event form (it would no longer
-- match the stored bracket). The functions below lift this for their own
-- transaction with set_config('tadbirly.tournament', 'on', true).
create or replace function public.protect_tournament_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('tadbirly.tournament', true), '') = 'on' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    new.tournament_stage := 'setup';
    return new;
  end if;
  new.tournament_stage := old.tournament_stage;
  if old.tournament_stage in ('running', 'finished') then
    new.format := old.format;
    new.group_count := old.group_count;
    new.advance_per_group := old.advance_per_group;
  end if;
  return new;
end $$;

drop trigger if exists protect_tournament_fields on public.posts;
create trigger protect_tournament_fields
  before insert or update on public.posts
  for each row execute function public.protect_tournament_fields();

-- ---------- helpers (internal) ----------
create or replace function public._tournament_guard(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_post is null or not public.is_event_organizer(p_post) then
    raise exception 'Only the organizer of this event can do that' using errcode = '42501';
  end if;
  perform set_config('tadbirly.tournament', 'on', true);
end $$;

-- Group tables: 3 points a win, 1 a draw; then goal difference, goals
-- scored, seed. lib/tournament.js computeStandings() uses the same order.
create or replace function public.group_standings(p_post uuid)
returns table (team_id uuid, group_no integer, played integer, won integer, drawn integer,
               lost integer, gf integer, ga integer, pts integer, rank integer)
language sql stable security definer set search_path = public as $$
  with t as (
    select id, group_no, seed from public.event_teams
    where post_id = p_post and group_no is not null
  ),
  res as (
    select team_a as team, score_a as f, score_b as a from public.matches
    where post_id = p_post and stage = 'group' and status = 'done' and team_a is not null and team_b is not null
    union all
    select team_b, score_b, score_a from public.matches
    where post_id = p_post and stage = 'group' and status = 'done' and team_a is not null and team_b is not null
  ),
  agg as (
    select t.id, t.group_no, t.seed,
           count(r.team)::int as played,
           (count(*) filter (where r.f > r.a))::int as won,
           (count(*) filter (where r.f = r.a))::int as drawn,
           (count(*) filter (where r.f < r.a))::int as lost,
           coalesce(sum(r.f), 0)::int as gf,
           coalesce(sum(r.a), 0)::int as ga
    from t left join res r on r.team = t.id
    group by t.id, t.group_no, t.seed
  )
  select id, group_no, played, won, drawn, lost, gf, ga, 3 * won + drawn,
         (row_number() over (partition by group_no
                             order by 3 * won + drawn desc, gf - ga desc, gf desc, seed asc nulls last, id))::int
  from agg;
$$;

-- Hybrid: once every group match is done, put the qualified teams into the
-- playoff slots ('G1#2' → 2nd in group 1). Until then those slots are empty.
create or replace function public._fill_playoff(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_all boolean;
begin
  v_all := not exists (select 1 from public.matches
                       where post_id = p_post and stage = 'group' and status <> 'done');
  update public.matches m set
    team_a = case when m.src_a is null then m.team_a
                  when v_all then (select s.team_id from public.group_standings(p_post) s
                                   where 'G' || s.group_no || '#' || s.rank = m.src_a) end,
    team_b = case when m.src_b is null then m.team_b
                  when v_all then (select s.team_id from public.group_standings(p_post) s
                                   where 'G' || s.group_no || '#' || s.rank = m.src_b) end
  where m.post_id = p_post and m.stage = 'playoff' and m.status <> 'done'
    and (m.src_a is not null or m.src_b is not null);
end $$;

-- Places 1–3: playoff → final winner, final loser, both semi-final losers.
-- Group stage only → the table (group rank, then points, difference, goals).
create or replace function public._tournament_places(p_post uuid)
returns table (team_id uuid, place integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_format text;
  f record;
begin
  select format into v_format from public.posts where id = p_post;
  if v_format = 'groups' then
    return query
      select x.team_id, x.rn::int from (
        select s.team_id, row_number() over (order by s.rank, s.pts desc, s.gf - s.ga desc, s.gf desc, t.seed nulls last, t.id) as rn
        from public.group_standings(p_post) s join public.event_teams t on t.id = s.team_id
      ) x where x.rn <= 3;
    return;
  end if;
  select * into f from public.matches
  where post_id = p_post and stage = 'playoff' and next_match_id is null
  limit 1;
  if f.id is null or f.status <> 'done' or f.winner is null then return; end if;
  team_id := f.winner; place := 1; return next;
  team_id := case when f.winner = f.team_a then f.team_b else f.team_a end; place := 2;
  if team_id is not null then return next; end if;
  return query
    select case when m.winner = m.team_a then m.team_b else m.team_a end, 3
    from public.matches m
    where m.next_match_id = f.id and m.status = 'done' and m.winner is not null
      and (case when m.winner = m.team_a then m.team_b else m.team_a end) is not null;
end $$;

-- ---------- form_teams: random, balanced teams from the accepted players ----------
create or replace function public.form_teams(p_post uuid, p_size integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_stage text;
  v_title text;
  v_n integer;
  v_k integer;
  v_names text[];
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  i integer;
  r record;
begin
  perform public._tournament_guard(p_post);
  if p_size is null or p_size < 2 or p_size > 20 then
    raise exception 'Players per team must be between 2 and 20';
  end if;
  select tournament_stage, title into v_stage, v_title from public.posts where id = p_post for update;
  if v_stage not in ('setup', 'teams') then
    raise exception 'The matches have started. Start over to change the teams.';
  end if;
  select count(distinct applicant_id) into v_n
  from public.applications where post_id = p_post and status = 'accepted';
  if v_n < 2 then
    raise exception 'Accept at least 2 players first';
  end if;
  v_k := greatest(2, ceil(v_n::numeric / p_size)::integer);

  select array_agg(n order by random()) into v_names
  from unnest(array['Falcons', 'Lions', 'Tigers', 'Wolves', 'Eagles', 'Sharks', 'Panthers', 'Bears',
                    'Hawks', 'Foxes', 'Rhinos', 'Cobras', 'Dragons', 'Bisons', 'Leopards', 'Owls',
                    'Jaguars', 'Stallions', 'Ravens', 'Comets', 'Rockets', 'Titans', 'Vipers', 'Lynx']) as n;

  delete from public.matches where post_id = p_post;
  delete from public.event_teams where post_id = p_post;   -- members go with them
  for i in 1..v_k loop
    insert into public.event_teams (post_id, name, seed)
    values (p_post, case when i <= array_length(v_names, 1) then v_names[i] else 'Team ' || i end, i)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Shuffle, then deal like cards: sizes differ by at most one.
  insert into public.event_team_members (post_id, team_id, user_id)
  select p_post, v_ids[((s.rn - 1) % v_k) + 1], s.applicant_id
  from (
    select d.applicant_id, row_number() over (order by random()) as rn
    from (select distinct applicant_id from public.applications
          where post_id = p_post and status = 'accepted') d
  ) s;

  update public.posts set team_size = p_size, team_mode = 'team', tournament_stage = 'teams' where id = p_post;

  -- Each player hears about it once per event (not again on every reshuffle;
  -- the event page always shows their current team, and "matches are out"
  -- below tells everyone their final team).
  for r in
    select m.user_id, t.name from public.event_team_members m
    join public.event_teams t on t.id = m.team_id where m.post_id = p_post
  loop
    begin
      if not exists (select 1 from public.notifications n
                     where n.user_id = r.user_id and n.type = 'event_team' and n.link = '/post/' || p_post) then
        perform public.push_notification(r.user_id, 'event_team',
          'You''re on ' || r.name || ' for ' || coalesce(v_title, 'an event'),
          'Tap to see your teammates.', '/post/' || p_post);
      end if;
    exception when others then null;   -- a notification problem never blocks the teams
    end;
  end loop;
  return v_k;
end $$;

-- ---------- move a player (p_team null = take them off every team) ----------
create or replace function public.move_player(p_post uuid, p_user uuid, p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._tournament_guard(p_post);
  if p_team is null then
    delete from public.event_team_members where post_id = p_post and user_id = p_user;
    return;
  end if;
  if not exists (select 1 from public.event_teams where id = p_team and post_id = p_post) then
    raise exception 'That team is not part of this event';
  end if;
  if not exists (select 1 from public.applications
                 where post_id = p_post and applicant_id = p_user and status = 'accepted') then
    raise exception 'Only accepted players can be on a team';
  end if;
  insert into public.event_team_members (post_id, team_id, user_id)
  values (p_post, p_team, p_user)
  on conflict (post_id, user_id) do update set team_id = excluded.team_id;
end $$;

create or replace function public.rename_team(p_team uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_post uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  select post_id into v_post from public.event_teams where id = p_team;
  perform public._tournament_guard(v_post);
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Team name must be 1 to 40 characters';
  end if;
  update public.event_teams set name = v_name where id = p_team;
end $$;

-- ---------- save_schedule: store what lib/tournament.js generated ----------
--  p_groups:  [{ "team_id": uuid, "group_no": int }]
--  p_matches: [{ "key", "stage", "group_no", "round", "slot", "team_a", "team_b",
--                "src_a", "src_b", "next_key", "next_slot" }]
create or replace function public.save_schedule(p_post uuid, p_format text, p_group_count integer,
                                                p_advance integer, p_groups jsonb, p_matches jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_stage text;
  v_title text;
  v_map jsonb := '{}'::jsonb;
  v_id uuid;
  v_next uuid;
  v_count integer := 0;
  e jsonb;
  r record;
begin
  perform public._tournament_guard(p_post);
  select tournament_stage, title into v_stage, v_title from public.posts where id = p_post for update;
  if v_stage = 'setup' then raise exception 'Form the teams first'; end if;
  if v_stage <> 'teams' then raise exception 'The matches already exist. Start over to make new ones.'; end if;
  if p_format is null or p_format not in ('versus', 'groups', 'playoff', 'hybrid') then
    raise exception 'Pick a format.';
  end if;
  if jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches) not between 1 and 1000 then
    raise exception 'The schedule is empty';
  end if;
  if p_groups is not null and jsonb_typeof(p_groups) <> 'array' then
    raise exception 'Invalid groups';
  end if;

  delete from public.matches where post_id = p_post;
  update public.event_teams set group_no = null where post_id = p_post;

  for e in select value from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    update public.event_teams set group_no = (e->>'group_no')::integer
    where id = (e->>'team_id')::uuid and post_id = p_post;
    if not found then raise exception 'A team in the schedule is not part of this event'; end if;
  end loop;

  for e in select value from jsonb_array_elements(p_matches) loop
    if coalesce(e->>'key', '') = '' or v_map ? (e->>'key') then
      raise exception 'Invalid schedule (match keys)';
    end if;
    if coalesce(e->>'stage', '') not in ('group', 'playoff') then
      raise exception 'Invalid schedule (stage)';
    end if;
    if (e->>'team_a') is not null and not exists (select 1 from public.event_teams where id = (e->>'team_a')::uuid and post_id = p_post)
       or (e->>'team_b') is not null and not exists (select 1 from public.event_teams where id = (e->>'team_b')::uuid and post_id = p_post) then
      raise exception 'A team in the schedule is not part of this event';
    end if;
    insert into public.matches (post_id, stage, group_no, round, slot, team_a, team_b, src_a, src_b)
    values (p_post, e->>'stage', (e->>'group_no')::integer, coalesce((e->>'round')::integer, 1),
            coalesce((e->>'slot')::integer, 1), (e->>'team_a')::uuid, (e->>'team_b')::uuid,
            left(e->>'src_a', 12), left(e->>'src_b', 12))
    returning id into v_id;
    v_map := v_map || jsonb_build_object(e->>'key', v_id);
    v_count := v_count + 1;
  end loop;

  for e in select value from jsonb_array_elements(p_matches) loop
    if (e->>'next_key') is not null then
      v_next := (v_map->>(e->>'next_key'))::uuid;
      if v_next is null or coalesce(e->>'next_slot', '') not in ('a', 'b') then
        raise exception 'Invalid schedule (bracket links)';
      end if;
      update public.matches set next_match_id = v_next, next_slot = e->>'next_slot'
      where id = (v_map->>(e->>'key'))::uuid;
    end if;
  end loop;

  -- Teams nobody plays for (emptied by moves) are dropped.
  delete from public.event_teams t
  where t.post_id = p_post
    and not exists (select 1 from public.event_team_members m where m.team_id = t.id)
    and not exists (select 1 from public.matches m where m.team_a = t.id or m.team_b = t.id);

  update public.posts set
    format = p_format,
    group_count = case when p_format in ('groups', 'hybrid') then p_group_count end,
    advance_per_group = case when p_format = 'hybrid' then p_advance end,
    tournament_stage = 'running'
  where id = p_post;

  for r in
    select m.user_id, t.name from public.event_team_members m
    join public.event_teams t on t.id = m.team_id where m.post_id = p_post
  loop
    begin
      perform public.push_notification(r.user_id, 'event_matches',
        'Matches are out for ' || coalesce(v_title, 'your event'),
        'You play for ' || r.name || '. Tap to see the schedule.', '/tournament/' || p_post);
    exception when others then null;
    end;
  end loop;
  return v_count;
end $$;

-- ---------- finished? ----------
create or replace function public._tournament_refresh_stage(p_post uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_format text; v_done boolean; v_stage text;
begin
  select format into v_format from public.posts where id = p_post;
  if v_format = 'groups' then
    v_done := exists (select 1 from public.matches where post_id = p_post)
              and not exists (select 1 from public.matches where post_id = p_post and status <> 'done');
  else
    v_done := exists (select 1 from public.matches
                      where post_id = p_post and stage = 'playoff' and next_match_id is null and status = 'done');
  end if;
  v_stage := case when v_done then 'finished' else 'running' end;
  update public.posts set tournament_stage = v_stage where id = p_post;
  return v_stage;
end $$;

-- ---------- report_score ----------
-- Draws are fine in the group stage. A playoff match needs a winner: a
-- level score needs p_winner (penalties, tie-break). Changing a result that
-- already sent a team on is allowed while that next match isn't played.
create or replace function public.report_score(p_match uuid, p_a integer, p_b integer, p_winner uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  nx public.matches%rowtype;
  v_stage text;
  v_format text;
  w uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then raise exception 'Match not found'; end if;
  perform public._tournament_guard(m.post_id);
  select tournament_stage, format into v_stage, v_format from public.posts where id = m.post_id for update;
  if v_stage not in ('running', 'finished') then raise exception 'The matches have not started yet'; end if;
  if m.team_a is null or m.team_b is null then raise exception 'Both teams are not known yet'; end if;
  if p_a is null or p_b is null or p_a < 0 or p_b < 0 or p_a > 999 or p_b > 999 then
    raise exception 'Scores must be between 0 and 999';
  end if;

  if p_a > p_b then w := m.team_a;
  elsif p_b > p_a then w := m.team_b;
  elsif m.stage = 'group' then w := null;
  elsif p_winner is not null and p_winner in (m.team_a, m.team_b) then w := p_winner;
  else raise exception 'A playoff match needs a winner';
  end if;

  if m.stage = 'group' and exists (select 1 from public.matches
                                   where post_id = m.post_id and stage = 'playoff' and status = 'done') then
    raise exception 'The playoff has started, so group results are locked';
  end if;

  if m.next_match_id is not null and (m.status <> 'done' or m.winner is distinct from w) then
    select * into nx from public.matches where id = m.next_match_id for update;
    if nx.status = 'done' then
      raise exception 'The next match was already played, so this result is locked';
    end if;
    if m.next_slot = 'a' then
      update public.matches set team_a = w where id = nx.id;
    else
      update public.matches set team_b = w where id = nx.id;
    end if;
  end if;

  update public.matches set score_a = p_a, score_b = p_b, winner = w, status = 'done' where id = p_match;

  if m.stage = 'group' and v_format = 'hybrid' then
    perform public._fill_playoff(m.post_id);
  end if;
  return public._tournament_refresh_stage(m.post_id);
end $$;

-- Undo a result (typo, wrong match). Same lock as editing.
create or replace function public.clear_score(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  nx public.matches%rowtype;
  v_format text;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then raise exception 'Match not found'; end if;
  perform public._tournament_guard(m.post_id);
  select format into v_format from public.posts where id = m.post_id for update;
  if m.status <> 'done' then return (select tournament_stage from public.posts where id = m.post_id); end if;
  if m.stage = 'group' and exists (select 1 from public.matches
                                   where post_id = m.post_id and stage = 'playoff' and status = 'done') then
    raise exception 'The playoff has started, so group results are locked';
  end if;
  if m.next_match_id is not null then
    select * into nx from public.matches where id = m.next_match_id for update;
    if nx.status = 'done' then
      raise exception 'The next match was already played, so this result is locked';
    end if;
    if m.next_slot = 'a' then
      update public.matches set team_a = null where id = nx.id;
    else
      update public.matches set team_b = null where id = nx.id;
    end if;
  end if;
  update public.matches set score_a = null, score_b = null, winner = null, status = 'scheduled' where id = p_match;
  if m.stage = 'group' and v_format = 'hybrid' then
    perform public._fill_playoff(m.post_id);
  end if;
  return public._tournament_refresh_stage(m.post_id);
end $$;

-- Back to the teams (all matches deleted; teams and given medals stay).
create or replace function public.reset_tournament(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._tournament_guard(p_post);
  delete from public.matches where post_id = p_post;
  update public.event_teams set group_no = null where post_id = p_post;
  update public.posts set tournament_stage =
    case when exists (select 1 from public.event_teams where post_id = p_post) then 'teams' else 'setup' end
  where id = p_post;
end $$;

-- ---------- medals for the top three teams ----------
-- Every member of the 1st / 2nd / 3rd team gets a "winner" award (100 / 75 /
-- 50 points) on the event's medal, created if the organizer hasn't made one.
-- Players who already have an award for this event are skipped, so running
-- it twice changes nothing. The award trigger (16_notifications_avatars.sql)
-- notifies each winner.
create or replace function public.award_top_teams(p_post uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_badge uuid;
  v_count integer := 0;
  v_n integer;
  r record;
begin
  perform public._tournament_guard(p_post);
  if (select tournament_stage from public.posts where id = p_post) <> 'finished' then
    raise exception 'Finish the matches first';
  end if;

  insert into public.badges (post_id, organizer_id, name, emoji, description)
  select p.id, p.author_id, left(coalesce(nullif(btrim(p.title), ''), 'Tournament'), 80), '🏆', null
  from public.posts p where p.id = p_post
  on conflict (post_id) do nothing;
  select id into v_badge from public.badges where post_id = p_post;

  for r in
    select pl.place, t.name, m.user_id
    from public._tournament_places(p_post) pl
    join public.event_teams t on t.id = pl.team_id
    join public.event_team_members m on m.team_id = t.id
    order by pl.place
  loop
    insert into public.awards (badge_id, post_id, recipient_id, awarded_by, kind, place, points, note)
    select v_badge, p_post, r.user_id, auth.uid(), 'winner', r.place,
           case r.place when 1 then 100 when 2 then 75 else 50 end, r.name
    where not exists (select 1 from public.awards a where a.post_id = p_post and a.recipient_id = r.user_id)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end $$;

-- ---------- who may call what ----------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.protect_tournament_fields()',
    'public._tournament_guard(uuid)',
    'public.group_standings(uuid)',
    'public._fill_playoff(uuid)',
    'public._tournament_places(uuid)',
    'public._tournament_refresh_stage(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.form_teams(uuid, integer)',
    'public.move_player(uuid, uuid, uuid)',
    'public.rename_team(uuid, text)',
    'public.save_schedule(uuid, text, integer, integer, jsonb, jsonb)',
    'public.report_score(uuid, integer, integer, uuid)',
    'public.clear_score(uuid)',
    'public.reset_tournament(uuid)',
    'public.award_top_teams(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $do$;

commit;
