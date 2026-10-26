-- 30_opportunities.sql — student suggestions for the event feed.
--
-- Any signed-in student can suggest an opportunity they saw (title + link or
-- pasted text + optional date). Admins review them in the app (/admin/review):
-- "Create event" posts it through the normal create form, then marks the
-- suggestion approved and the student gets "Your suggestion is live 🎉".
--
-- Safe to run more than once. Needs 16 (push_notification) and 27 (is_admin);
-- without them the suggestions still work, just without notifications.

begin;

-- ---------- table ----------
create table if not exists public.opportunity_submissions (
  id           uuid primary key default gen_random_uuid(),
  submitted_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title        text not null,
  url          text,
  details      text,
  event_date   date,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz
);

-- Constraints added one by one, so an older copy of the table gets them too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'opportunity_submissions_status_check') then
    alter table public.opportunity_submissions
      add constraint opportunity_submissions_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'opportunity_submissions_title_len') then
    alter table public.opportunity_submissions
      add constraint opportunity_submissions_title_len check (char_length(btrim(title)) between 3 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'opportunity_submissions_url_len') then
    alter table public.opportunity_submissions
      add constraint opportunity_submissions_url_len check (url is null or char_length(url) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'opportunity_submissions_url_http') then
    alter table public.opportunity_submissions
      add constraint opportunity_submissions_url_http check (url is null or url ~* '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'opportunity_submissions_details_len') then
    alter table public.opportunity_submissions
      add constraint opportunity_submissions_details_len check (details is null or char_length(details) <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'opportunity_submissions_has_info') then
    alter table public.opportunity_submissions
      add constraint opportunity_submissions_has_info check (nullif(btrim(coalesce(url, '')), '') is not null
                                                          or nullif(btrim(coalesce(details, '')), '') is not null);
  end if;
end $$;

create index if not exists opportunity_submissions_user_idx
  on public.opportunity_submissions (submitted_by, created_at desc);
create index if not exists opportunity_submissions_pending_idx
  on public.opportunity_submissions (created_at) where status = 'pending';

-- ---------- access ----------
alter table public.opportunity_submissions enable row level security;

revoke all on public.opportunity_submissions from public, anon;
revoke all on public.opportunity_submissions from authenticated;
grant select, insert on public.opportunity_submissions to authenticated;
grant update (status, reviewed_by, reviewed_at) on public.opportunity_submissions to authenticated;

-- Insert: only as yourself, and only as a fresh pending suggestion.
drop policy if exists "submissions insert own" on public.opportunity_submissions;
create policy "submissions insert own" on public.opportunity_submissions
  for insert to authenticated
  with check (submitted_by = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null);

-- Read: your own; admins read all.
drop policy if exists "submissions select own" on public.opportunity_submissions;
create policy "submissions select own" on public.opportunity_submissions
  for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());

-- Update: admins only (the app uses mark_submission_reviewed below).
drop policy if exists "submissions admin update" on public.opportunity_submissions;
create policy "submissions admin update" on public.opportunity_submissions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 5 suggestions per day per student ----------
create or replace function public.prepare_opportunity_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.created_at := now();
    new.title      := btrim(new.title);
    new.url        := nullif(btrim(coalesce(new.url, '')), '');
    new.details    := nullif(btrim(coalesce(new.details, '')), '');
    -- Serialise one student's inserts so parallel requests can't slip past the cap.
    perform pg_advisory_xact_lock(hashtext('opportunity_submissions:' || new.submitted_by::text));
    if (select count(*) from public.opportunity_submissions s
         where s.submitted_by = new.submitted_by
           and s.created_at > now() - interval '24 hours') >= 5 then
      raise exception 'daily_limit: You can suggest up to 5 opportunities a day.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.prepare_opportunity_submission() from public, anon, authenticated;

drop trigger if exists prepare_opportunity_submission on public.opportunity_submissions;
create trigger prepare_opportunity_submission
  before insert on public.opportunity_submissions
  for each row execute function public.prepare_opportunity_submission();

-- Every admin gets a notification. Never blocks the suggestion itself.
create or replace function public.notify_admins_of_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  adm record;
begin
  begin
    if to_regprocedure('public.push_notification(uuid, text, text, text, text)') is null then
      return null;
    end if;
    for adm in
      select p.id from public.profiles p
       where p.is_admin = true and p.id is distinct from new.submitted_by
    loop
      perform public.push_notification(adm.id, 'submission',
        '💡 New opportunity suggestion', left(new.title, 120), '/admin/review');
    end loop;
  exception when others then
    raise warning 'notify_admins_of_submission: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.notify_admins_of_submission() from public, anon, authenticated;

drop trigger if exists notify_admins_of_submission on public.opportunity_submissions;
create trigger notify_admins_of_submission
  after insert on public.opportunity_submissions
  for each row execute function public.notify_admins_of_submission();

-- ---------- review (admins) ----------
-- Approve after creating the event yourself (p_post_id = the new post), or
-- reject. Approving tells the student their suggestion is live.
create or replace function public.mark_submission_reviewed(p_id uuid, p_status text, p_post_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  sub public.opportunity_submissions;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Status must be approved or rejected' using errcode = '22023';
  end if;
  if p_status = 'approved'
     and (p_post_id is null or not exists (select 1 from public.posts where id = p_post_id)) then
    raise exception 'Create the event first' using errcode = '22023';
  end if;

  update public.opportunity_submissions
     set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status = 'pending'
  returning * into sub;
  if not found then
    raise exception 'This suggestion was already reviewed' using errcode = 'P0002';
  end if;

  if p_status = 'approved' then
    begin
      if to_regprocedure('public.push_notification(uuid, text, text, text, text)') is not null then
        perform public.push_notification(sub.submitted_by, 'submission',
          'Your suggestion is live 🎉', left(sub.title, 120), '/post/' || p_post_id::text);
      end if;
    exception when others then
      raise warning 'mark_submission_reviewed notify: %', sqlerrm;
    end;
  end if;
end $$;
revoke execute on function public.mark_submission_reviewed(uuid, text, uuid) from public, anon;
grant  execute on function public.mark_submission_reviewed(uuid, text, uuid) to authenticated;

commit;
