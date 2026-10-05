import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { notify, confirmAsync } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Card, Button } from '../../components/ui';
import { inviteToTeam, approveTeam, rejectTeam, deleteTeam, respondTeam, TEAM_STATUS } from '../../lib/teams';
import { useReportSheet } from '../../lib/moderation';

export default function TeamDetail() {
  const { id } = useLocalSearchParams();
  const { session, profile } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const iAmOrg = profile?.role === 'organizer';
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [connections, setConnections] = useState([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const safety = useReportSheet();

  const load = useCallback(async () => {
    const { data: t } = await supabase.from('teams').select('*').eq('id', id).single();
    setTeam(t);
    if (iAmOrg && t && t.owner_id !== uid) {
      // Organizers aren't in the team, so row security hides its member rows
      // and they saw "Members (0)" while deciding whether to approve it.
      // team_roster_admin returns the accepted roster to any organizer;
      // reshape it like team_members rows so the list below stays the same.
      const { data: roster } = await supabase.rpc('team_roster_admin', { t: id });
      setMembers((roster ?? []).map((r) => ({
        id: r.id,
        user_id: r.id,
        status: 'accepted',
        user: { id: r.id, full_name: r.full_name, university: r.university },
      })));
    } else {
      const { data: m } = await supabase
        .from('team_members')
        .select('*, user:profiles!team_members_user_id_fkey(id, full_name, university)')
        .eq('team_id', id);
      setMembers(m ?? []);
    }
    if (t?.owner_id === uid) {
      const { data: conns } = await supabase
        .from('connections')
        .select('requester:profiles!connections_requester_id_fkey(id, full_name), target:profiles!connections_target_id_fkey(id, full_name), requester_id, target_id')
        .or(`requester_id.eq.${uid},target_id.eq.${uid}`).eq('status', 'accepted');
      setConnections((conns ?? []).map((c) => (c.requester_id === uid ? c.target : c.requester)).filter(Boolean));
    }
    setLoading(false);
  }, [id, uid, iAmOrg]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function search(text) {
    setQ(text);
    if (text.trim().length < 2) return setFound([]);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, university')
      .ilike('full_name', `%${text.trim()}%`)
      .neq('id', uid)
      .limit(20);
    setFound(data ?? []);
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!team) return <Text style={styles.empty}>Team not found.</Text>;

  const isOwner = team.owner_id === uid;
  const memberIds = new Set(members.map((m) => m.user_id));
  const accepted = members.filter((m) => m.status === 'accepted');
  const pending = members.filter((m) => m.status === 'invited');
  const myRow = members.find((m) => m.user_id === uid);
  // Row security shows the roster only to the owner and accepted members
  // (organizers get it from team_roster_admin above). Anyone else — e.g.
  // someone who was just invited — sees only their own row, so a count
  // would wrongly read 0.
  const seesRoster = isOwner || iAmOrg || myRow?.status === 'accepted';

  async function confirmDelete() {
    const ok = await confirmAsync(
      'Delete this team?',
      `“${team.name}” will be removed for everyone, along with its members and any applications it made to events. This cannot be undone.`,
      'Delete',
    );
    if (!ok) return;
    const { error } = await deleteTeam(id);
    if (error) return notify('Could not delete', error.message);
    notify('Team deleted', `“${team.name}” is gone.`);
    // dismissTo pops back to the tabs already underneath instead of stacking
    // a second tab navigator on top (router.replace did). Organizers manage
    // teams from Portal → Teams; participants from the Teams tab.
    router.dismissTo(iAmOrg ? '/portal?tab=teams' : '/team-builder');
  }

  async function leaveTeam() {
    const ok = await confirmAsync('Leave this team?', `You'll be removed from “${team.name}”.`, 'Leave');
    if (!ok) return;
    const { error } = await supabase.from('team_members').delete().eq('team_id', id).eq('user_id', uid);
    if (error) return notify('Could not leave', error.message);
    notify('You left the team', '');
    router.dismissTo('/team-builder');
  }

  async function answerInvite(accept) {
    setAnswering(true);
    const { error } = await respondTeam(myRow.id, accept);
    setAnswering(false);
    if (error) return notify('Could not answer the invite', error.message);
    notify(accept ? `You joined ${team.name} 🧩` : 'Invite declined', '');
    load();
  }

  async function invite(userId, name) {
    const { error } = await inviteToTeam(id, userId);
    // Only a duplicate row means "already invited"; anything else (network,
    // permissions) is shown as it is instead of being mislabelled.
    if (error && error.code !== '23505') return notify('Could not invite', error.message);
    notify(error ? 'Already invited' : 'Invite sent 🧩',
      error ? `${name ?? 'This person'} has already been invited or is a member.` : `${name ?? 'They'} will see it in their Portal → Teams.`);
    setQ(''); setFound([]);
    load();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.name}>🧩 {team.name}</Text>
      <Text style={styles.meta}>{team.competition ?? 'Competition'}{team.spots ? ` · ${team.spots} spots` : ''}</Text>

      {(() => {
        const s = TEAM_STATUS[team.status ?? 'pending'] ?? TEAM_STATUS.pending;
        return <Text style={[styles.statusBadge, { color: s.color, borderColor: s.color }]}>{s.label}</Text>;
      })()}
      {team.status !== 'approved' && isOwner && (
        <Text style={styles.statusHelp}>
          {team.status === 'rejected'
            ? 'An organizer did not approve this team. Create a new team, or contact an organizer and ask them to take another look.'
            : 'An organizer needs to approve your team before it can apply to events. Invite your members first.'}
        </Text>
      )}

      {iAmOrg && team.status !== 'approved' && (
        <View style={styles.row}>
          <Button title="✅ Approve team" variant="green" style={{ flex: 1 }}
            onPress={async () => { const { error } = await approveTeam(id); if (error) notify('Could not approve', error.message); else { notify('Team approved ✅', 'They can now apply to events.'); load(); } }} />
          <Button title="Reject" variant="ghost" style={{ flex: 1 }}
            onPress={async () => { const { error } = await rejectTeam(id); if (error) notify('Could not reject', error.message); else load(); }} />
        </View>
      )}

      {team.description ? <Text style={styles.desc}>{team.description}</Text> : null}

      {myRow?.status === 'invited' && (
        <Card style={{ marginTop: 16 }}>
          <Text style={styles.mName}>You're invited to join this team</Text>
          <View style={[styles.row, { marginTop: 10 }]}>
            <Button title="Accept" variant="green" style={{ flex: 1 }} loading={answering} onPress={() => answerInvite(true)} />
            <Button title="Decline" variant="ghost" style={{ flex: 1 }} disabled={answering} onPress={() => answerInvite(false)} />
          </View>
        </Card>
      )}
      {myRow?.status === 'requested' && (
        <Text style={[styles.statusHelp, { marginTop: 12 }]}>⏳ You asked to join — waiting for the owner's answer.</Text>
      )}

      <Text style={styles.section}>{seesRoster ? `Members (${accepted.length})` : 'Members'}</Text>
      {!seesRoster && <Text style={styles.dim}>You'll see who's in the team once you've joined it.</Text>}
      {accepted.map((m) => (
        <Card key={m.id} onPress={() => m.user_id && router.push(`/user/${m.user_id}`)}>
          <Text style={styles.mName}>{m.user?.full_name}{m.user_id === team.owner_id ? ' · owner' : ''}</Text>
          <Text style={styles.mMeta}>{m.user?.university ?? ''}</Text>
        </Card>
      ))}

      {isOwner && pending.length > 0 && (
        <>
          <Text style={styles.section}>Invited — waiting for reply</Text>
          {pending.map((m) => (
            <Card key={m.id}>
              <Text style={styles.mName}>{m.user?.full_name}</Text>
              <Text style={styles.mMeta}>⏳ Invite pending</Text>
            </Card>
          ))}
        </>
      )}

      {isOwner && (
        <>
          <Text style={styles.section}>Invite people</Text>
          <TextInput
            style={styles.input}
            value={q}
            onChangeText={search}
            placeholder="Search anyone by name…"
            placeholderTextColor={colors.muted}
          />
          {found.filter((f) => !memberIds.has(f.id)).map((f) => (
            <Card key={f.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mName}>{f.full_name}</Text>
                  <Text style={styles.mMeta}>{f.university ?? ''}</Text>
                </View>
                <Button title="Invite" variant="green" onPress={() => invite(f.id, f.full_name)} />
              </View>
            </Card>
          ))}

          {q.trim().length < 2 && (
            <>
              <Text style={styles.subsection}>From your network</Text>
              {connections.filter((c) => !memberIds.has(c.id)).length === 0 ? (
                <Text style={styles.dim}>No friends to invite yet — search by name above, or add friends in Social → Find people.</Text>
              ) : (
                connections.filter((c) => !memberIds.has(c.id)).map((c) => (
                  <Card key={c.id}>
                    <View style={styles.row}>
                      <Text style={[styles.mName, { flex: 1 }]}>{c.full_name}</Text>
                      <Button title="Invite" variant="green" onPress={() => invite(c.id, c.full_name)} />
                    </View>
                  </Card>
                ))
              )}
            </>
          )}
        </>
      )}

      {isOwner || iAmOrg ? (
        <>
          <Button title="🗑️ Delete team" variant="danger" style={{ marginTop: 30 }} onPress={confirmDelete} />
          <Text style={styles.dangerNote}>
            {isOwner ? 'Members will lose access immediately.' : 'As an organizer you can remove any team.'}
          </Text>
        </>
      ) : accepted.some((m) => m.user_id === uid) ? (
        <Button title="Leave team" variant="ghost" style={{ marginTop: 30 }} onPress={leaveTeam} />
      ) : null}

      {!isOwner && (
        <TouchableOpacity
          style={styles.reportLink}
          onPress={() => {
            const owner = members.find((m) => m.user_id === team.owner_id)?.user?.full_name;
            safety.open({ type: 'team', id: team.id, userId: team.owner_id, name: owner ?? 'the team owner' });
          }}
        >
          <Text style={styles.reportText}>⚑ Report team or block its owner</Text>
        </TouchableOpacity>
      )}
      {safety.sheet}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  desc: { fontSize: 14, color: colors.ink, marginTop: 10, lineHeight: 21 },
  section: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 20, marginBottom: 10 },
  subsection: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink, marginBottom: 12 },
  mName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  mMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  dim: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  dangerNote: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  statusBadge: { alignSelf: 'flex-start', fontSize: 12.5, fontWeight: '800', borderWidth: 1.5, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, marginTop: 10, overflow: 'hidden' },
  statusHelp: { fontSize: 12.5, color: colors.muted, marginTop: 8, lineHeight: 18 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
  reportLink: { alignItems: 'center', marginTop: 22, paddingVertical: 8 },
  reportText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
});
