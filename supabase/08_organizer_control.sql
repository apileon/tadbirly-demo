-- ============================================================
--  Tadbirly — Organizer access control (anti-spam)
--  Goal: only accounts YOU approve can be organizers and post
--  events. Everyone else is a participant and cannot post.
--  Run this once in Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Freeze the trust fields so a user can't promote themselves.
--    A normal end-user request always carries a JWT, so auth.uid()
--    is set → we force role/verified_student back to their old
--    values. When YOU edit a row from the Dashboard or SQL Editor
--    (service role), auth.uid() is NULL → the change is allowed.
-- ------------------------------------------------------------
create or replace function public.freeze_trust_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.role := old.role;
    new.verified_student := old.verified_student;
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_trust_fields on public.profiles;
create trigger freeze_trust_fields
  before update on public.profiles
  for each row execute function public.freeze_trust_fields();

-- ------------------------------------------------------------
-- 2) Only organizers may create posts (events/requests).
--    Even a direct API call from a participant is now rejected.
-- ------------------------------------------------------------
drop policy if exists "posts insert" on public.posts;
create policy "posts insert" on public.posts
  for insert with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'organizer'
    )
  );

-- ============================================================
--  HOW TO MAKE SOMEONE AN ORGANIZER
--  Option A — Dashboard: Table Editor → profiles → find the
--  person's row → set  role = organizer  → Save.
--
--  Option B — SQL (grant by email, replace the address):
--
--    update public.profiles set role = 'organizer'
--    where id = (select id from auth.users
--                where email = 'club@school.uz');
--
--  To revoke, set role back to 'participant' the same way.
-- ============================================================
