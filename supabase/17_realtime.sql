-- ============================================================
--  Tadbirly — live delivery for messages and notifications
--  Safe to re-run.
-- ============================================================

-- Make sure the publication exists before adding to it.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'event_messages') then
    alter publication supabase_realtime add table public.event_messages;
  end if;
end $$;

-- Realtime sends the full old row on DELETE only with full replica identity;
-- needed so a deleted message disappears for the other person instantly.
alter table public.messages replica identity full;
alter table public.event_messages replica identity full;
