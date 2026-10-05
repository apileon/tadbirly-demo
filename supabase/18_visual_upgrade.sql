-- ============================================================
--  Tadbirly — visual upgrade
--  • event cover photos
--  • profile cover banners
--  • read receipts in direct messages
--  Run once in Supabase SQL Editor.
-- ============================================================

-- ---------- EVENT COVERS ----------
alter table public.posts add column if not exists cover_url text;

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists "cover read" on storage.objects;
create policy "cover read" on storage.objects
  for select using (bucket_id = 'covers');

drop policy if exists "cover insert" on storage.objects;
create policy "cover insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'covers'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'organizer')
  );

drop policy if exists "cover delete" on storage.objects;
create policy "cover delete" on storage.objects
  for delete to authenticated using (bucket_id = 'covers' and owner = auth.uid());

-- ---------- PROFILE BANNER ----------
-- (stored in the existing public "avatars" bucket)
alter table public.profiles add column if not exists cover_url text;

-- ---------- READ RECEIPTS ----------
alter table public.messages add column if not exists read_at timestamptz;

-- Called when you open a chat: marks the other person's messages as read.
-- NOTE: superseded by 21_dm_push_and_badges.sql, which also clears the chat's
-- push notification. If you ever re-run this file, re-run 21 afterwards.
create or replace function public.mark_chat_read(c uuid)
returns void language sql security definer set search_path = public as $$
  update public.messages m
  set read_at = now()
  where m.chat_id = c
    and m.sender_id <> auth.uid()
    and m.read_at is null
    and exists (
      select 1 from public.chats ch
      where ch.id = c and (ch.participant_id = auth.uid() or ch.organizer_id = auth.uid())
    );
$$;
