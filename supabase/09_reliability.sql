-- ============================================================
--  Tadbirly — make the reliability score real
--  Run once in Supabase SQL Editor.
-- ============================================================

-- 1) New users start at 75 (leaves room to grow), not 100.
alter table public.profiles alter column reliability set default 75;

-- 2) Reset existing accounts to the baseline — none have earned
--    history yet, so everyone starts fair.
update public.profiles set reliability = 75;

-- 3) Grow the score with verified attendance: each medal an
--    organizer awards raises that student's reliability by 5
--    (capped at 100). Runs with elevated rights so it can update
--    the recipient's row past normal row-level security.
create or replace function public.bump_reliability()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles
     set reliability = least(100, reliability + 5)
   where id = new.recipient_id;
  return new;
end;
$$;

drop trigger if exists on_award_bump on public.awards;
create trigger on_award_bump
  after insert on public.awards
  for each row execute function public.bump_reliability();
