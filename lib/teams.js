import { supabase } from './supabase';
import { requireRows, noPermission } from './events';

const NOT_SIGNED_IN = () => ({ error: { message: 'Not signed in' } });

// getUser() is a network call: on a blip it resolves with user: null instead
// of throwing, so every caller must check before using the id.
async function myId() {
  const { data: auth } = await supabase.auth.getUser();
  return auth?.user?.id ?? null;
}

export async function createTeam({ name, competition, description, spots }) {
  const uid = await myId();
  if (!uid) return NOT_SIGNED_IN();
  const { data: team, error } = await supabase
    .from('teams')
    .insert({ owner_id: uid, name, competition: competition || null, description: description || null, spots: spots ? parseInt(spots, 10) : null })
    .select()
    .single();
  if (error) return { error };
  // owner is an accepted member
  await supabase.from('team_members').insert({ team_id: team.id, user_id: uid, status: 'accepted' });
  return { team };
}

// A participant asks to join an open team.
export async function requestJoin(teamId) {
  const uid = await myId();
  if (!uid) return NOT_SIGNED_IN();

  // One row per person per team, so look at the old one first: the database
  // no longer lets a member flip their own row back to 'requested'.
  const { data: existing, error: readErr } = await supabase
    .from('team_members')
    .select('id, status')
    .eq('team_id', teamId)
    .eq('user_id', uid)
    .maybeSingle();
  if (readErr) return { error: readErr };
  if (existing?.status === 'accepted') return { error: { message: "You're already in this team." } };
  if (existing?.status === 'requested') {
    return { error: { message: 'You already asked to join — the owner will answer from their Portal → Teams.' } };
  }
  if (existing?.status === 'invited') {
    return { error: { message: "You're already invited — accept it in Portal → Teams." } };
  }
  if (existing) {
    // 'declined' earlier: clear the old answer so a fresh request can be made.
    const { error: delErr } = await supabase.from('team_members').delete().eq('id', existing.id);
    if (delErr) return { error: delErr };
  }

  const res = await supabase.from('team_members').insert({ team_id: teamId, user_id: uid, status: 'requested' });
  if (res.error?.code === '23505') {
    return { ...res, error: { ...res.error, message: 'You already asked to join this team.' } };
  }
  return res;
}

// A team owner invites someone.
export async function inviteToTeam(teamId, userId) {
  return supabase.from('team_members').insert({ team_id: teamId, user_id: userId, status: 'invited' });
}

// Accept / decline an invite or a join request.
export async function respondTeam(memberRowId, accept) {
  return requireRows(
    supabase.from('team_members').update({ status: accept ? 'accepted' : 'declined' }).eq('id', memberRowId),
  );
}

// Teams I own, with how many accepted members each has.
export async function myTeamsWithSize() {
  const uid = await myId();
  if (!uid) return [];
  const { data: teams } = await supabase.from('teams').select('id, name, competition').eq('owner_id', uid);
  const list = teams ?? [];
  if (!list.length) return [];
  const { data: members } = await supabase
    .from('team_members')
    .select('team_id, status')
    .in('team_id', list.map((t) => t.id))
    .eq('status', 'accepted');
  const counts = {};
  (members ?? []).forEach((m) => { counts[m.team_id] = (counts[m.team_id] ?? 0) + 1; });
  return list.map((t) => ({ ...t, size: counts[t.id] ?? 0 }));
}

// Apply to an event as a whole team (team owner only).
export async function applyAsTeam(postId, teamId, message) {
  const uid = await myId();
  if (!uid) return NOT_SIGNED_IN();
  return supabase.from('team_applications').insert({
    post_id: postId, team_id: teamId, applied_by: uid, message: message?.trim() || null,
  });
}

// Organizer accepts a team — every accepted member becomes an accepted participant.
export async function acceptTeamApplication(appId) {
  return supabase.rpc('accept_team_application', { app_id: appId });
}

export async function rejectTeamApplication(appId) {
  return requireRows(supabase.from('team_applications').update({ status: 'rejected' }).eq('id', appId));
}

// ---- Organizer moderation of teams ----

// Teams waiting for an organizer to approve them.
export async function pendingTeams() {
  const { data } = await supabase
    .from('teams')
    .select('id, name, competition, description, spots, created_at, owner:profiles!teams_owner_id_fkey(id, full_name, university)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data ?? [];
}

// Two ways a status change can silently not happen: RLS matches no rows,
// or the protect_team_status trigger quietly keeps the old status for
// anyone who isn't an organizer. Read the row back and check it really moved.
async function setTeamStatus(teamId, patch) {
  const { data, error } = await supabase.from('teams').update(patch).eq('id', teamId).select('id, status');
  if (error) return { data: null, error };
  if (!data?.length || data[0].status !== patch.status) return { data: null, error: noPermission() };
  return { data, error: null };
}

export async function approveTeam(teamId) {
  const uid = await myId();
  return setTeamStatus(teamId, { status: 'approved', approved_by: uid, approved_at: new Date().toISOString() });
}

export async function rejectTeam(teamId) {
  return setTeamStatus(teamId, { status: 'rejected' });
}

export async function deleteTeam(teamId) {
  return requireRows(supabase.from('teams').delete().eq('id', teamId));
}

export async function teamRoster(teamId) {
  const { data } = await supabase.rpc('team_roster_admin', { t: teamId });
  return data ?? [];
}

export const TEAM_STATUS = {
  pending: { label: '⏳ Waiting for approval', color: '#c9a227' },
  approved: { label: '✅ Approved', color: '#2d5a3d' },
  rejected: { label: '❌ Not approved', color: '#c0392b' },
};
