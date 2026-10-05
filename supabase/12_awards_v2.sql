-- ============================================================
--  Tadbirly — awards v2: winner places, honourable mentions,
--  participation, comments; reliability weighted by award kind.
--  Run once in Supabase SQL Editor.
-- ============================================================

-- Award kind + place (for winners)
alter table public.awards add column if not exists kind text not null default 'medal';
  -- winner | medal | mention | participation
alter table public.awards add column if not exists place integer;
  -- 1 | 2 | 3 when kind = 'winner'

-- The simple "+5 per award" bump from script 09 is replaced by the
-- weighted recompute below (03's trigger already calls it on every change).
drop trigger if exists on_award_bump on public.awards;
drop function if exists public.bump_reliability();

-- Reliability = 75 + weighted verified awards, capped at 100.
create or replace function public.recompute_reliability(uid uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles
  set reliability = least(100, 75 + (
    select coalesce(sum(case a.kind
                          when 'winner' then 10
                          when 'participation' then 3
                          else 5 end), 0)
    from public.awards a
    where a.recipient_id = uid and a.verified = true
  ))
  where id = uid;
$$;

-- Bring everyone's score in line with the new weights
select public.recompute_reliability(id) from public.profiles;
