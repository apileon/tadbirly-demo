import { supabase } from './supabase';
import { t } from './i18n';

// Send a friend request. If a previous request was declined, this revives it
// rather than blocking the two people from ever connecting again.
export async function sendConnect(targetId) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user?.id;
  if (!me) return { error: { message: t('Not signed in') } };
  if (me === targetId) return { error: { message: "You can't connect with yourself" } };

  const { data: existing } = await supabase
    .from('connections')
    .select('id, status, requester_id, target_id')
    .or(`and(requester_id.eq.${me},target_id.eq.${targetId}),and(requester_id.eq.${targetId},target_id.eq.${me})`)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    if (row.status === 'accepted') return { error: { message: t('You are already friends') } };
    if (row.status === 'pending') {
      return {
        error: {
          message: row.requester_id === me
            ? t('You already sent them a request')
            : t('They already sent you a request: check Portal → Requests'),
        },
      };
    }
    // Previously declined: reopen it, pointing the request at them this time.
    const { error } = await supabase
      .from('connections')
      .update({ status: 'pending', requester_id: me, target_id: targetId })
      .eq('id', row.id);
    return { error };
  }

  return supabase.from('connections').insert({ requester_id: me, target_id: targetId });
}

// Accept or decline a connection request. On accept, open a networking chat.
export async function respondConnect(conn, accept) {
  const status = accept ? 'accepted' : 'declined';
  const { error } = await supabase.from('connections').update({ status }).eq('id', conn.id);
  if (error) return { error };
  if (accept) {
    // Create a networking chat (no event) if one doesn't exist yet
    const a = conn.requester_id, b = conn.target_id;
    const { data: existing } = await supabase
      .from('chats')
      .select('id')
      .is('post_id', null)
      .or(`and(organizer_id.eq.${a},participant_id.eq.${b}),and(organizer_id.eq.${b},participant_id.eq.${a})`)
      .limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from('chats').insert({ post_id: null, organizer_id: a, participant_id: b });
    }
  }
  return {};
}

// Count of verified events two users attended together (the streak).
export function sharedStreak(myPostIds, theirPostIds) {
  const set = new Set(myPostIds);
  return theirPostIds.filter((id) => set.has(id)).length;
}

// Find or create a direct (no-event) chat with another user; returns its id.
// Throws on failure (callers wrap it in try/catch).
export async function openDirectChat(otherId) {
  const { data: auth } = await supabase.auth.getUser();
  // getUser() is a network call: on a blip it resolves with user: null
  // instead of throwing, so check before touching the id.
  const me = auth?.user?.id;
  if (!me) throw new Error('Not signed in');
  const { data: existing } = await supabase
    .from('chats')
    .select('id')
    .is('post_id', null)
    .or(`and(organizer_id.eq.${me},participant_id.eq.${otherId}),and(organizer_id.eq.${otherId},participant_id.eq.${me})`)
    .limit(1);
  if (existing && existing.length > 0) return existing[0].id;
  const { data: created, error } = await supabase
    .from('chats')
    .insert({ post_id: null, organizer_id: me, participant_id: otherId })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

// How am I connected to this person, and who asked whom?
// Returns null, or { status, incoming, row }.
//   status   : pending | accepted | declined
//   incoming : true when THEY requested ME (so I can accept or decline)
export async function connectionStatus(otherId) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user?.id;
  if (!me) return null;
  const { data } = await supabase
    .from('connections')
    .select('id, status, requester_id, target_id')
    .or(`and(requester_id.eq.${me},target_id.eq.${otherId}),and(requester_id.eq.${otherId},target_id.eq.${me})`)
    .limit(1);
  if (!data || data.length === 0) return null;
  const row = data[0];
  return { status: row.status, incoming: row.target_id === me, row };
}
