-- ============================================================
--  Tadbirly — notifications + profile pictures
--  Run once in Supabase SQL Editor.
-- ============================================================

-- ---------- PROFILE PICTURES ----------
alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar read" on storage.objects;
create policy "avatar read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatar insert" on storage.objects;
create policy "avatar insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

drop policy if exists "avatar delete" on storage.objects;
create policy "avatar delete" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and owner = auth.uid());

-- ---------- NOTIFICATIONS ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- You only ever see, mark or delete your own. Rows are written by the
-- triggers below (security definer), never directly by a client.
drop policy if exists "notif read" on public.notifications;
create policy "notif read" on public.notifications for select using (user_id = auth.uid());

drop policy if exists "notif update" on public.notifications;
create policy "notif update" on public.notifications for update using (user_id = auth.uid());

drop policy if exists "notif delete" on public.notifications;
create policy "notif delete" on public.notifications for delete using (user_id = auth.uid());

create or replace function public.push_notification(uid uuid, ntype text, ntitle text, nbody text, nlink text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link)
  select uid, ntype, ntitle, nbody, nlink where uid is not null;
$$;

-- Friend requests and acceptances
create or replace function public.notify_connection()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if TG_OP = 'INSERT' then
    select full_name into who from public.profiles where id = new.requester_id;
    perform public.push_notification(new.target_id, 'friend_request',
      coalesce(who, 'Someone') || ' wants to be your friend',
      'Tap to open Portal → Network and accept.', '/(tabs)/portal');
  elsif TG_OP = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    select full_name into who from public.profiles where id = new.target_id;
    perform public.push_notification(new.requester_id, 'friend_accepted',
      coalesce(who, 'Someone') || ' accepted your friend request',
      'You can message each other now.', '/(tabs)/portal');
  end if;
  return null;
end $$;
drop trigger if exists trg_notify_connection on public.connections;
create trigger trg_notify_connection after insert or update on public.connections
  for each row execute function public.notify_connection();

-- Event applications (both directions)
create or replace function public.notify_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev record; who text;
begin
  select id, title, author_id into ev from public.posts where id = new.post_id;
  if ev.id is null then return null; end if;

  if TG_OP = 'INSERT' then
    select full_name into who from public.profiles where id = new.applicant_id;
    perform public.push_notification(ev.author_id, 'new_application',
      'New application for ' || ev.title,
      coalesce(who, 'Someone') || ' applied. Tap to review.', '/applicants/' || ev.id);
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.push_notification(new.applicant_id, 'accepted',
        'You got accepted to ' || ev.title,
        'Tap to open the event and its group chat.', '/post/' || ev.id);
    elsif new.status = 'rejected' then
      perform public.push_notification(new.applicant_id, 'rejected',
        'Update on ' || ev.title,
        'You were not selected this time.', '/post/' || ev.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_notify_application on public.applications;
create trigger trg_notify_application after insert or update on public.applications
  for each row execute function public.notify_application();

-- Team invites and join requests
create or replace function public.notify_team_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; who text;
begin
  select id, name, owner_id into t from public.teams where id = new.team_id;
  if t.id is null then return null; end if;

  if TG_OP = 'INSERT' then
    if new.status = 'invited' then
      perform public.push_notification(new.user_id, 'team_invite',
        'You were invited to ' || t.name,
        'Tap to open Portal → Teams and accept.', '/(tabs)/portal');
    elsif new.status = 'requested' then
      select full_name into who from public.profiles where id = new.user_id;
      perform public.push_notification(t.owner_id, 'team_request',
        coalesce(who, 'Someone') || ' wants to join ' || t.name,
        'Tap to open Portal → Teams.', '/(tabs)/portal');
    end if;
  elsif TG_OP = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    select full_name into who from public.profiles where id = new.user_id;
    if old.status = 'invited' then
      -- they accepted an invite → tell the team owner
      perform public.push_notification(t.owner_id, 'team_joined',
        coalesce(who, 'Someone') || ' joined ' || t.name, '', '/team/' || t.id);
    elsif old.status = 'requested' then
      -- the owner approved their request → tell the member
      perform public.push_notification(new.user_id, 'team_joined',
        'You joined ' || t.name, 'Your request to join was accepted.', '/team/' || t.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_notify_team_member on public.team_members;
create trigger trg_notify_team_member after insert or update on public.team_members
  for each row execute function public.notify_team_member();

-- Awards / points
create or replace function public.notify_award()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  select title into ev from public.posts where id = new.post_id;
  perform public.push_notification(new.recipient_id, 'award',
    'You received an award at ' || coalesce(ev, 'an event'),
    coalesce(nullif(new.note, ''), 'Tap to see it.') || '  (+' || coalesce(new.points, 0) || ' pts)',
    '/post/' || new.post_id);
  return null;
end $$;
drop trigger if exists trg_notify_award on public.awards;
create trigger trg_notify_award after insert on public.awards
  for each row execute function public.notify_award();

-- Team approved / rejected by an organizer
create or replace function public.notify_team_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.push_notification(new.owner_id, 'team_approved',
        'Your team "' || new.name || '" was approved',
        'It can now apply to events.', '/team/' || new.id);
    elsif new.status = 'rejected' then
      perform public.push_notification(new.owner_id, 'team_rejected',
        'Your team "' || new.name || '" was not approved', '', '/team/' || new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_notify_team_status on public.teams;
create trigger trg_notify_team_status after update on public.teams
  for each row execute function public.notify_team_status();

-- Team applications to an event
create or replace function public.notify_team_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev record; tm text;
begin
  select id, title, author_id into ev from public.posts where id = new.post_id;
  select name into tm from public.teams where id = new.team_id;
  if ev.id is null then return null; end if;

  if TG_OP = 'INSERT' then
    perform public.push_notification(ev.author_id, 'team_application',
      'Team "' || coalesce(tm, '') || '" applied to ' || ev.title,
      'Tap to review the team and its members.', '/applicants/' || ev.id);
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.push_notification(new.applied_by, 'team_accepted',
        'Your team was accepted to ' || ev.title,
        'Everyone in the team is in.', '/post/' || ev.id);
    elsif new.status = 'rejected' then
      perform public.push_notification(new.applied_by, 'team_rejected',
        'Your team was not selected for ' || ev.title, '', '/post/' || ev.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_notify_team_application on public.team_applications;
create trigger trg_notify_team_application after insert or update on public.team_applications
  for each row execute function public.notify_team_application();
