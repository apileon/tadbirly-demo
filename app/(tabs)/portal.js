import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { notify, confirmAsync } from '../../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, CATEGORIES } from '../../lib/theme';
import { Card, Button, Avatar } from '../../components/ui';
import { respondConnect, sendConnect } from '../../lib/social';
import { respondTeam, pendingTeams, approveTeam, rejectTeam, deleteTeam, teamRoster } from '../../lib/teams';
import { useBadges, requestsCount, teamsCount, eventsCount } from '../../lib/badges';
import Dot from '../../components/Dot';

const SEGMENTS = ['events', 'networking', 'teams'];

export default function Portal() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const isOrg = profile?.role === 'organizer';
  const { badges } = useBadges();

  // Notifications open a specific segment ('/portal?tab=networking'). The
  // param picks it on first open, and again whenever a new link arrives —
  // tabs stay mounted, so the initial useState value alone would miss that.
  const { tab: tabParam } = useLocalSearchParams();
  const linked = SEGMENTS.includes(tabParam) ? tabParam : null;
  const [tab, setTab] = useState(linked ?? 'events');
  useEffect(() => { if (linked) setTab(linked); }, [linked]);

  // Tapping a segment moves the param along with it. Otherwise, after you
  // switch away by hand, a link to the segment in the param would change
  // nothing and be ignored. (On web the URL then also matches the screen.)
  function choose(next) {
    setTab(next);
    if (tabParam !== next) router.setParams({ tab: next });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.h1}>Portal</Text>
        <View style={styles.seg}>
          <SegBtn label="🎪 Events" on={tab === 'events'} onPress={() => choose('events')} n={eventsCount(badges)} />
          <SegBtn label="🤝 Requests" on={tab === 'networking'} onPress={() => choose('networking')} n={requestsCount(badges)} />
          <SegBtn label="🧩 Teams" on={tab === 'teams'} onPress={() => choose('teams')} n={teamsCount(badges)} />
        </View>
      </View>
      {/* All three stay mounted so switching is instant — no reload, no flicker. */}
      <View style={{ flex: 1, display: tab === 'events' ? 'flex' : 'none' }}>
        <EventsDivision session={session} isOrg={isOrg} />
      </View>
      <View style={{ flex: 1, display: tab === 'networking' ? 'flex' : 'none' }}>
        <NetworkingDivision session={session} />
      </View>
      <View style={{ flex: 1, display: tab === 'teams' ? 'flex' : 'none' }}>
        {isOrg ? <TeamApprovalDivision /> : <TeamsDivision session={session} />}
      </View>
    </SafeAreaView>
  );
}

/* ========= TEAM APPROVAL (organizers) ========= */
function TeamApprovalDivision() {
  const router = useRouter();
  const [teams, setTeams] = useState([]);
  const { refreshBadges } = useBadges();

  const load = useCallback(async () => { setTeams(await pendingTeams()); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Your own decision writes no notification for you, so nothing else would
  // clear the Teams dot until you navigate away.
  const changed = useCallback(() => { load(); refreshBadges(); }, [load, refreshBadges]);

  return (
    <FlatList
      data={teams}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={
        <Text style={styles.legend}>
          Teams need your approval before they can apply to events. Check the members, then approve or reject.
        </Text>
      }
      ListEmptyComponent={<Text style={styles.empty}>No teams waiting for approval right now.</Text>}
      renderItem={({ item }) => <PendingTeamCard team={item} onChanged={changed} router={router} />}
    />
  );
}

function PendingTeamCard({ team, onChanged, router }) {
  const [members, setMembers] = useState(null);
  const [busy, setBusy] = useState(false);

  async function showMembers() {
    if (members) return setMembers(null);
    setMembers(await teamRoster(team.id));
  }

  async function act(kind) {
    if (kind === 'delete') {
      const ok = await confirmAsync('Delete this team?', `“${team.name}” will be removed completely for everyone.`, 'Delete');
      if (!ok) return;
    }
    setBusy(true);
    const { error } = kind === 'approve' ? await approveTeam(team.id)
      : kind === 'reject' ? await rejectTeam(team.id)
      : await deleteTeam(team.id);
    setBusy(false);
    if (error) return notify('Could not update', error.message);
    notify(
      kind === 'approve' ? 'Team approved ✅' : kind === 'reject' ? 'Team rejected' : 'Team deleted',
      kind === 'approve' ? `“${team.name}” can now apply to events.` : '',
    );
    onChanged();
  }

  return (
    <Card>
      <Text style={styles.name}>🧩 {team.name}</Text>
      <Text style={styles.meta}>
        {team.competition ?? 'Competition'} · created by {team.owner?.full_name ?? 'someone'}
        {team.owner?.university ? ` · ${team.owner.university}` : ''}
      </Text>
      {team.description ? <Text style={styles.bio}>“{team.description}”</Text> : null}

      <TouchableOpacity onPress={showMembers} style={{ marginTop: 10 }}>
        <Text style={styles.connect}>{members ? '▾ Hide members' : '▸ See members'}</Text>
      </TouchableOpacity>
      {members && (
        <View style={{ marginTop: 6 }}>
          {members.length === 0 ? (
            <Text style={styles.meta}>This team has no accepted members yet.</Text>
          ) : members.map((m) => (
            <TouchableOpacity key={m.id} onPress={() => router.push(`/user/${m.id}`)} style={styles.memberRow}>
              <Text style={styles.memberName}>{m.full_name}</Text>
              <Text style={styles.meta}>{m.university ?? ''} · ⭐ {m.reliability ?? 75}% · view →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <Button title="Approve" variant="green" style={{ flex: 1 }} loading={busy} onPress={() => act('approve')} />
        <Button title="Reject" variant="ghost" style={{ flex: 1 }} onPress={() => act('reject')} />
      </View>
      <Button title="🗑️ Delete team" variant="danger" style={{ marginTop: 8 }} onPress={() => act('delete')} />
    </Card>
  );
}

/* ================= TEAMS ================= */
function TeamsDivision({ session }) {
  const router = useRouter();
  const uid = session?.user?.id;
  const [invites, setInvites] = useState([]);
  const [requests, setRequests] = useState([]);
  const { refreshBadges } = useBadges();

  const load = useCallback(async () => {
    if (!uid) return;
    // Invites to me
    const { data: inv } = await supabase
      .from('team_members')
      .select('*, team:teams(id, name, competition)')
      .eq('user_id', uid).eq('status', 'invited');
    setInvites(inv ?? []);
    // Join requests to teams I own
    const { data: myTeams } = await supabase.from('teams').select('id, name').eq('owner_id', uid);
    const ids = (myTeams ?? []).map((t) => t.id);
    const tmap = {}; (myTeams ?? []).forEach((t) => { tmap[t.id] = t.name; });
    if (ids.length) {
      const { data: reqs } = await supabase
        .from('team_members')
        .select('*, user:profiles!team_members_user_id_fkey(full_name, university)')
        .in('team_id', ids).eq('status', 'requested');
      setRequests((reqs ?? []).map((r) => ({ ...r, teamName: tmap[r.team_id] })));
    } else setRequests([]);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function respond(rowId, accept) {
    const { error } = await respondTeam(rowId, accept);
    // Used to be ignored: a refused accept looked exactly like a successful one.
    if (error) notify('Could not update', error.message);
    else refreshBadges(); // your own answer writes no notification for you
    load();
  }

  const empty = invites.length === 0 && requests.length === 0;
  return (
    <FlatList
      data={requests}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={
        <View>
          {invites.length > 0 && <Text style={styles.section}>Team invites for you</Text>}
          {invites.map((i) => (
            <Card key={i.id}>
              <TouchableOpacity onPress={() => i.team?.id && router.push(`/team/${i.team.id}`)}>
                <Text style={styles.name}>🧩 {i.team?.name}</Text>
                <Text style={styles.meta}>{i.team?.competition ?? 'Competition'} · view team →</Text>
              </TouchableOpacity>
              <View style={styles.actions}>
                <Button title="Accept" variant="green" style={{ flex: 1 }} onPress={() => respond(i.id, true)} />
                <Button title="Decline" variant="ghost" style={{ flex: 1 }} onPress={() => respond(i.id, false)} />
              </View>
            </Card>
          ))}
          {requests.length > 0 && <Text style={styles.section}>Requests to join your teams</Text>}
        </View>
      }
      ListEmptyComponent={empty ? <Text style={styles.empty}>No team invites or requests yet. When someone invites you to their team, it shows up here.</Text> : null}
      renderItem={({ item }) => (
        <Card>
          <Text style={styles.event}>{item.teamName ?? 'Your team'}</Text>
          <Text style={styles.name}>{item.user?.full_name}</Text>
          <Text style={styles.meta}>{item.user?.university ?? ''}</Text>
          <View style={styles.actions}>
            <Button title="Accept" variant="green" style={{ flex: 1 }} onPress={() => respond(item.id, true)} />
            <Button title="Decline" variant="ghost" style={{ flex: 1 }} onPress={() => respond(item.id, false)} />
          </View>
        </Card>
      )}
    />
  );
}

/* ================= EVENTS ================= */
function EventsDivision({ session, isOrg }) {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [titles, setTitles] = useState({});
  const { refreshBadges } = useBadges();

  const load = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    if (isOrg) {
      const { data: posts } = await supabase.from('posts').select('id, title').eq('author_id', uid);
      const ids = (posts ?? []).map((p) => p.id);
      const tmap = {}; (posts ?? []).forEach((p) => { tmap[p.id] = p.title; });
      setTitles(tmap);
      if (!ids.length) return setRows([]);
      const { data } = await supabase
        .from('applications')
        .select('*, applicant:profiles!applications_applicant_id_fkey(id, full_name, university, major, reliability, verified_student, bio, avatar_url)')
        .in('post_id', ids).order('created_at', { ascending: false });
      setRows(data ?? []);
    } else {
      const { data } = await supabase
        .from('applications')
        .select('*, post:posts(id, title, kind, location, city, event_date)')
        .eq('applicant_id', uid).order('created_at', { ascending: false });
      setRows(data ?? []);
    }
  }, [session, isOrg]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function decide(app, status) {
    const showStatus = (s) => setRows((prev) => prev.map((r) => (r.id === app.id ? { ...r, status: s } : r)));
    showStatus(status); // instant
    // .select() returns the rows actually changed. Row security SKIPS rows you
    // may not update (only the event's organizer may) rather than raising an
    // error, so without it a refused decision looked like it had worked.
    const { data, error } = await supabase.from('applications').update({ status }).eq('id', app.id).select('id');
    if (error || !data?.length) {
      showStatus(app.status);
      notify('Could not update', error ? error.message : "You don't have permission to do that.");
      return;
    }
    refreshBadges(); // your own decision writes no notification for you
  }

  if (isOrg) {
    return (
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No applications yet. Post an event and they'll appear here.</Text>}
        renderItem={({ item }) => {
          const a = item.applicant ?? {};
          return (
            <Card>
              <Text style={styles.event}>{titles[item.post_id] ?? 'Event'}</Text>
              <View style={styles.rowTop}>
                <Avatar uri={a.avatar_url} name={a.full_name} id={a.id} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{a.full_name ?? 'Applicant'}</Text>
                  <Text style={styles.meta}>{a.university ?? ''}{a.major ? ` · ${a.major}` : ''}</Text>
                  <Text style={styles.meta}>⭐ {a.reliability ?? 75}%{a.verified_student ? ' · ✔ Verified' : ''}</Text>
                </View>
                <StatusPill status={item.status} />
              </View>
              {a.bio ? <Text style={styles.bio}>“{a.bio}”</Text> : null}
              {item.status === 'pending' && (
                <View style={styles.actions}>
                  <Button title="Accept" variant="green" style={{ flex: 1 }} onPress={() => decide(item, 'accepted')} />
                  <Button title="Reject" variant="ghost" style={{ flex: 1 }} onPress={() => decide(item, 'rejected')} />
                </View>
              )}
              <TouchableOpacity
                onPress={async () => {
                  const { error } = await sendConnect(a.id);
                  // Say what actually happened ("You are already friends",
                  // "You can't send a request to this person", offline…) —
                  // every failure used to read "Already sent".
                  if (error) notify('Could not send request', error.message);
                  else notify('Invite sent 🤝', `${a.full_name ?? 'They'} can accept you from their Portal.`);
                }}
              >
                <Text style={styles.connect}>🤝 Connect</Text>
              </TouchableOpacity>
            </Card>
          );
        }}
      />
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={<Text style={styles.legend}>🟡 Pending · 🟢 Accepted · 🔴 Not selected</Text>}
      ListEmptyComponent={<Text style={styles.empty}>Nothing yet — apply from the Feed and it appears here.</Text>}
      renderItem={({ item }) => {
        const p = item.post ?? {};
        const cat = CATEGORIES[p.kind] ?? CATEGORIES.event;
        return (
          <Card onPress={() => p.id && router.push(`/post/${p.id}`)}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{cat.emoji} {p.title ?? 'Post'}</Text>
              <StatusPill status={item.status} />
            </View>
            <Text style={styles.meta}>{p.location ?? p.city}{p.event_date ? ` · ${p.event_date}` : ''}</Text>
          </Card>
        );
      }}
    />
  );
}

/* ================= NETWORKING =================
   Just the decisions: who wants to connect with you.
   Conversations live in Social → Chats.                        */
function NetworkingDivision({ session }) {
  const router = useRouter();
  const uid = session?.user?.id;
  const [incoming, setIncoming] = useState([]);
  const { refreshBadges } = useBadges();

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase
      .from('connections')
      .select('*, requester:profiles!connections_requester_id_fkey(id, full_name, university, major, reliability, avatar_url)')
      .eq('target_id', uid).eq('status', 'pending')
      .order('created_at', { ascending: false });
    setIncoming(data ?? []);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function respond(conn, accept) {
    setIncoming((prev) => prev.filter((c) => c.id !== conn.id)); // instant
    const { error } = await respondConnect(conn, accept);
    if (error) { notify('Could not respond', error.message); load(); return; }
    refreshBadges(); // your own answer writes no notification for you
    if (accept) notify('Friends 🤝', 'You can now message each other from Social → Chats.');
  }

  return (
    <FlatList
      data={incoming}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={
        incoming.length > 0
          ? <Text style={styles.legend}>{incoming.length} {incoming.length === 1 ? 'person wants' : 'people want'} to connect with you</Text>
          : null
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          No friend requests right now.{'\n\n'}
          When someone adds you, they'll appear here to accept or decline. Your conversations are in Social → Chats.
        </Text>
      }
      renderItem={({ item }) => {
        const p = item.requester ?? {};
        return (
          <Card>
            <TouchableOpacity style={styles.rowTop} onPress={() => p.id && router.push(`/user/${p.id}`)}>
              <Avatar uri={p.avatar_url} name={p.full_name} id={p.id} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.full_name ?? 'Someone'}</Text>
                <Text style={styles.meta}>{p.university ?? ''}{p.major ? ` · ${p.major}` : ''}</Text>
                <Text style={styles.meta}>⭐ {p.reliability ?? 75}% · view profile →</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.actions}>
              <Button title="Accept" variant="green" style={{ flex: 1 }} onPress={() => respond(item, true)} />
              <Button title="Decline" variant="ghost" style={{ flex: 1 }} onPress={() => respond(item, false)} />
            </View>
          </Card>
        );
      }}
    />
  );
}

function SegBtn({ label, on, onPress, n = 0 }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.segBtn, on && styles.segBtnOn]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Text style={[styles.segText, on && { color: '#fff' }]}>{label}</Text>
        <Dot n={n} plain />
      </View>
    </TouchableOpacity>
  );
}
function StatusPill({ status }) {
  const map = {
    pending: { t: '🟡 Pending', c: colors.warn, b: colors.warnSoft },
    accepted: { t: '🟢 Accepted', c: colors.brand, b: colors.brandSoft },
    rejected: { t: '🔴 Not selected', c: colors.danger, b: '#f6dcd8' },
  };
  const s = map[status] ?? map.pending;
  return <Text style={[styles.pill, { color: s.c, backgroundColor: s.b }]}>{s.t}</Text>;
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8 },
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  seg: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.pill, padding: 4, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.brand },
  segText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  legend: { fontSize: 12, color: colors.muted, textAlign: 'center', marginBottom: 12 },
  section: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 6, marginBottom: 10 },
  event: { fontSize: 12, fontWeight: '700', color: colors.brand, marginBottom: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 18 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink, flex: 1 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  bio: { fontSize: 13, color: colors.ink, marginTop: 10, fontStyle: 'italic' },
  streak: { fontSize: 13, color: '#c9772a', fontWeight: '700', marginTop: 3 },
  chatCta: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  connect: { fontSize: 13, color: colors.brand, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  memberRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  pill: { fontSize: 11, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
});
