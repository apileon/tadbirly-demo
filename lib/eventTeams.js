// Organizer-run teams & matches (supabase/32_tournaments.sql). The maths lives
// in lib/tournament.js; this file only talks to the database.
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from './supabase';
import { t } from './i18n';
import { generateSchedule, nextMatchFor, lastMatchFor } from './tournament';

// Server messages are English sentences that also exist in the dictionaries,
// so they show in the user's language.
function wrap(res) {
  if (res?.error) return { data: null, error: { ...res.error, message: t(res.error.message) } };
  return { data: res?.data ?? null, error: null };
}

export const isTeamEvent = (post) => post?.team_mode === 'team' || (post?.format && post.format !== 'none');

// Teams (with members) and matches for one event. `missing`: the database
// doesn't have 32_tournaments.sql yet.
export async function loadTournament(postId) {
  const [teamsRes, membersRes, matchesRes] = await Promise.all([
    supabase.from('event_teams').select('id, name, seed, group_no').eq('post_id', postId).order('seed'),
    supabase
      .from('event_team_members')
      .select('team_id, user_id, user:profiles!event_team_members_user_id_fkey(id, full_name, avatar_url)')
      .eq('post_id', postId),
    supabase
      .from('matches')
      .select('id, stage, group_no, round, slot, team_a, team_b, src_a, src_b, score_a, score_b, winner, status, next_match_id, next_slot')
      .eq('post_id', postId)
      .order('round').order('slot'),
  ]);
  const missing = [teamsRes, membersRes, matchesRes].some((r) => r.error && (r.error.code === '42P01' || r.error.code === 'PGRST205'));
  const byTeam = {};
  (membersRes.data ?? []).forEach((m) => {
    (byTeam[m.team_id] = byTeam[m.team_id] ?? []).push(m.user ?? { id: m.user_id });
  });
  const teams = (teamsRes.data ?? []).map((tm) => ({
    ...tm,
    members: (byTeam[tm.id] ?? []).sort((a, b) => String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''))),
  }));
  return { teams, matches: matchesRes.data ?? [], missing };
}

// Accepted applicants (organizer only: row security hides the rest).
export async function acceptedPlayers(postId) {
  const { data } = await supabase
    .from('applications')
    .select('applicant:profiles!applications_applicant_id_fkey(id, full_name, avatar_url)')
    .eq('post_id', postId)
    .eq('status', 'accepted');
  return (data ?? []).map((a) => a.applicant).filter(Boolean);
}

export const formTeams = async (postId, size) => wrap(await supabase.rpc('form_teams', { p_post: postId, p_size: size }));
export const movePlayer = async (postId, userId, teamId) => wrap(await supabase.rpc('move_player', { p_post: postId, p_user: userId, p_team: teamId }));
export const renameTeam = async (teamId, name) => wrap(await supabase.rpc('rename_team', { p_team: teamId, p_name: name }));
export const reportScore = async (matchId, a, b, winner) => wrap(await supabase.rpc('report_score', { p_match: matchId, p_a: a, p_b: b, p_winner: winner ?? null }));
export const clearScore = async (matchId) => wrap(await supabase.rpc('clear_score', { p_match: matchId }));
export const resetTournament = async (postId) => wrap(await supabase.rpc('reset_tournament', { p_post: postId }));
export const awardTopTeams = async (postId) => wrap(await supabase.rpc('award_top_teams', { p_post: postId }));

// Generates the schedule here and stores it in one call.
export async function startTournament(postId, teams, { format, groupCount, advance }) {
  let schedule;
  try {
    schedule = generateSchedule({ teams, format, groupCount, advance });
  } catch (e) {
    return { data: null, error: { message: t(e.message, e.vars ?? undefined) } };
  }
  const g = format === 'groups' || format === 'hybrid' ? Number(groupCount) : null;
  const k = format === 'hybrid' ? Number(advance) : null;
  return wrap(await supabase.rpc('save_schedule', {
    p_post: postId, p_format: format, p_group_count: g, p_advance: k,
    p_groups: schedule.groups, p_matches: schedule.matches,
  }));
}

// For the event page: the signed-in student's team, teammates and matches.
export function useMyTeam(postId, uid, enabled) {
  const [state, setState] = useState(null);
  const load = useCallback(async () => {
    if (!enabled || !postId || !uid) { setState(null); return; }
    const { teams, matches, missing } = await loadTournament(postId);
    if (missing) { setState(null); return; }
    const team = teams.find((tm) => tm.members.some((m) => m.id === uid)) ?? null;
    const names = Object.fromEntries(teams.map((tm) => [tm.id, tm.name]));
    setState({
      team,
      names,
      hasMatches: matches.length > 0,
      next: team ? nextMatchFor(team.id, matches) : null,
      last: team ? lastMatchFor(team.id, matches) : null,
    });
  }, [postId, uid, enabled]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return state;
}
