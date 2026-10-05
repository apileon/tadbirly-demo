-- ============================================================
--  Tadbirly — let either member delete a DM chat
--  (messages inside are removed automatically via cascade).
--  Run once in Supabase SQL Editor.
-- ============================================================
drop policy if exists "chats delete" on public.chats;
create policy "chats delete" on public.chats
  for delete using (auth.uid() = participant_id or auth.uid() = organizer_id);
