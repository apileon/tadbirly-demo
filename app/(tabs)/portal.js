import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify, confirmAsync } from '../../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, CATEGORIES } from '../../lib/theme';
import { Card, Button, Avatar, EmptyState, SectionHeader, Tag } from '../../components/ui';
import { respondConnect, sendConnect } from '../../lib/social';
import { respondTeam, pendingTeams, approveTeam, rejectTeam, deleteTeam, teamRoster } from '../../lib/teams';
import { useBadges, requestsCount, teamsCount, eventsCount } from '../../lib/badges';
import Dot from '../../components/Dot';
import { t } from '../../lib/i18n';

const SEGMENTS = ['events', 'networking', 'teams'];

// Applications are fetched without the post's category, so the icon follows the coarse kind.
const KIND_ICONS = { event: 'calendar-outline', internship: 'briefcase-outline', mun: 'globe-outline' };

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
        <Text style={styles.heading}>{t('Portal')}</Text>
        <View style={styles.seg}>
          <SegBtn icon="calendar-outline" label={t('Events')} on={tab === 'events'} onPress={() => choose('events')} n={eventsCount(badges)} />
          <SegBtn icon="person-add-outline" label={t('Requests')} on={tab === 'networking'} onPress={() => choose('networking')} n={requestsCount(badges)} />
          <SegBtn icon="people-outline" label={t('Teams')} on={tab === 'teams'} onPress={() => choose('teams')} n={teamsCount(badges)} />
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
      keyExtractor={(team) => team.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Text style={styles.legend}>
          {t('Teams need your approval before they can apply to events. Check the members, then approve or reject.')}
        </Text>
      }
      ListEmptyComponent={<EmptyState icon="people-outline" title={t('No teams waiting for approval right now.')} />}
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
      const ok = await confirmAsync(t('Delete this team?'), t('"{name}" will be removed completely for everyone.', { name: team.name }), t('Delete'));
      if (!ok) return;
    }
    setBusy(true);
    const { error } = kind === 'approve' ? await approveTeam(team.id)
      : kind === 'reject' ? await rejectTeam(team.id)
      : await deleteTeam(team.id);
    setBusy(false);
    if (error) return notify(t('Could not update'), error.message);
    notify(
      kind === 'approve' ? t('Team approved') : kind === 'reject' ? t('Team rejected') : t('Team deleted'),
      kind === 'approve' ? t('"{name}" can now apply to events.', { name: team.name }) : '',
    );
    onChanged();
  }

  const owner = team.owner?.full_name ?? t('someone');
  return (
    <Card>
      <View style={styles.rowTop}>
        <View style={styles.teamIcon}>
          <Ionicons name="people-outline" size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{team.name}</Text>
          <Text style={styles.meta}>
            {team.competition ?? t('Competition')} · {t('created by {name}', { name: owner })}
            {team.owner?.university ? ` · ${team.owner.university}` : ''}
          </Text>
        </View>
      </View>
      {team.description ? <Text style={styles.bio}>“{team.description}”</Text> : null}

      <TouchableOpacity onPress={showMembers} style={styles.toggle}>
        <Ionicons name={members ? 'chevron-down' : 'chevron-forward'} size={15} color={colors.brand} />
        <Text style={styles.link}>{members ? t('Hide members') : t('See members')}</Text>
      </TouchableOpacity>
      {members && (
        <View style={{ marginTop: 6 }}>
          {members.length === 0 ? (
            <Text style={styles.meta}>{t('This team has no accepted members yet.')}</Text>
          ) : members.map((m) => (
            <TouchableOpacity key={m.id} onPress={() => router.push(`/user/${m.id}`)} style={styles.memberRow}>
              <Avatar uri={m.avatar_url} name={m.full_name} id={m.id} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.full_name}</Text>
                <View style={styles.metaRow}>
                  {m.university ? <Text style={styles.meta}>{m.university} · </Text> : null}
                  <Reliability value={m.reliability} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <Button title={t('Approve')} icon="checkmark" variant="primary" style={{ flex: 1 }} loading={busy} onPress={() => act('approve')} />
        <Button title={t('Reject')} variant="ghost" style={{ flex: 1 }} onPress={() => act('reject')} />
      </View>
      <Button title={t('Delete team')} icon="trash-outline" variant="danger" size="sm" style={{ marginTop: 8 }} onPress={() => act('delete')} />
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
    const ids = (myTeams ?? []).map((tm) => tm.id);
    const tmap = {}; (myTeams ?? []).forEach((tm) => { tmap[tm.id] = tm.name; });
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
    if (error) notify(t('Could not update'), error.message);
    else refreshBadges(); // your own answer writes no notification for you
    load();
  }

  const empty = invites.length === 0 && requests.length === 0;
  return (
    <FlatList
      data={requests}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View>
          {invites.length > 0 && <SectionHeader title={t('Team invites for you')} style={{ marginTop: 4 }} />}
          {invites.map((i) => (
            <Card key={i.id}>
              <TouchableOpacity style={styles.rowTop} onPress={() => i.team?.id && router.push(`/team/${i.team.id}`)}>
                <View style={styles.teamIcon}>
                  <Ionicons name="people-outline" size={20} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{i.team?.name}</Text>
                  <Text style={styles.meta}>{i.team?.competition ?? t('Competition')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.faint} accessibilityLabel={t('View team')} />
              </TouchableOpacity>
              <View style={styles.actions}>
                <Button title={t('Accept')} variant="primary" style={{ flex: 1 }} onPress={() => respond(i.id, true)} />
                <Button title={t('Decline')} variant="ghost" style={{ flex: 1 }} onPress={() => respond(i.id, false)} />
              </View>
            </Card>
          ))}
          {requests.length > 0 && <SectionHeader title={t('Requests to join your teams')} style={invites.length ? null : { marginTop: 4 }} />}
        </View>
      }
      ListEmptyComponent={empty ? (
        <EmptyState
          icon="people-outline"
          title={t('No team invites or requests yet')}
          text={t('When someone invites you to their team, it shows up here.')}
        />
      ) : null}
      renderItem={({ item }) => (
        <Card>
          <Text style={styles.event}>{item.teamName ?? t('Your team')}</Text>
          <View style={styles.rowTop}>
            <Avatar name={item.user?.full_name} id={item.user_id} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.user?.full_name}</Text>
              {item.user?.university ? <Text style={styles.meta}>{item.user.university}</Text> : null}
            </View>
          </View>
          <View style={styles.actions}>
            <Button title={t('Accept')} variant="primary" style={{ flex: 1 }} onPress={() => respond(item.id, true)} />
            <Button title={t('Decline')} variant="ghost" style={{ flex: 1 }} onPress={() => respond(item.id, false)} />
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
      notify(t('Could not update'), error ? error.message : t("You don't have permission to do that."));
      return;
    }
    refreshBadges(); // your own decision writes no notification for you
  }

  if (isOrg) {
    return (
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title={t('No applications yet')}
            text={t("Post an event and they'll appear here.")}
          />
        }
        renderItem={({ item }) => {
          const a = item.applicant ?? {};
          return (
            <Card>
              <Text style={styles.event}>{titles[item.post_id] ?? t('Event')}</Text>
              <View style={styles.rowTop}>
                <Avatar uri={a.avatar_url} name={a.full_name} id={a.id} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { flexShrink: 1 }]}>{a.full_name ?? t('Applicant')}</Text>
                    {a.verified_student ? (
                      <Ionicons name="checkmark-circle" size={15} color={colors.brand} accessibilityLabel={t('Verified student')} />
                    ) : null}
                  </View>
                  {a.university || a.major ? (
                    <Text style={styles.meta}>{a.university ?? ''}{a.major ? `${a.university ? ' · ' : ''}${a.major}` : ''}</Text>
                  ) : null}
                  <View style={[styles.metaRow, { marginTop: 3 }]}>
                    <Reliability value={a.reliability} />
                  </View>
                </View>
                <StatusPill status={item.status} />
              </View>
              {a.bio ? <Text style={styles.bio}>“{a.bio}”</Text> : null}
              {item.status === 'pending' && (
                <View style={styles.actions}>
                  <Button title={t('Accept')} variant="primary" style={{ flex: 1 }} onPress={() => decide(item, 'accepted')} />
                  <Button title={t('Reject')} variant="ghost" style={{ flex: 1 }} onPress={() => decide(item, 'rejected')} />
                </View>
              )}
              <TouchableOpacity
                style={styles.connectBtn}
                onPress={async () => {
                  const { error } = await sendConnect(a.id);
                  // Say what actually happened ("You are already friends",
                  // "You can't send a request to this person", offline…) —
                  // every failure used to read "Already sent".
                  if (error) notify(t('Could not send request'), error.message);
                  else notify(
                    t('Invite sent'),
                    a.full_name
                      ? t('{name} can accept you from their Portal.', { name: a.full_name })
                      : t('They can accept you from their Portal.'),
                  );
                }}
              >
                <Ionicons name="person-add-outline" size={15} color={colors.brand} />
                <Text style={styles.link}>{t('Connect')}</Text>
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
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <EmptyState
          icon="document-text-outline"
          title={t('No applications yet')}
          text={t('Apply from the Feed and it appears here.')}
        />
      }
      renderItem={({ item }) => {
        const p = item.post ?? {};
        const cat = CATEGORIES[p.kind] ?? CATEGORIES.event;
        const where = p.location ?? p.city;
        return (
          <Card onPress={() => p.id && router.push(`/post/${p.id}`)}>
            <View style={[styles.rowTop, { alignItems: 'flex-start' }]}>
              <View style={[styles.teamIcon, { backgroundColor: cat.soft }]}>
                <Ionicons name={KIND_ICONS[p.kind] ?? KIND_ICONS.event} size={18} color={cat.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{p.title ?? t('Post')}</Text>
                {where || p.event_date ? (
                  <Text style={styles.meta} numberOfLines={1}>{where}{p.event_date ? `${where ? ' · ' : ''}${p.event_date}` : ''}</Text>
                ) : null}
              </View>
              <StatusPill status={item.status} />
            </View>
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
    if (error) { notify(t('Could not respond'), error.message); load(); return; }
    refreshBadges(); // your own answer writes no notification for you
    if (accept) notify(t('Friends'), t('You can now message each other from Social, in Chats.'));
  }

  return (
    <FlatList
      data={incoming}
      keyExtractor={(c) => c.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        incoming.length > 0
          ? (
            <Text style={styles.legend}>
              {incoming.length === 1 ? t('1 person wants to connect with you') : t('{n} people want to connect with you', { n: incoming.length })}
            </Text>
          )
          : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="person-add-outline"
          title={t('No friend requests right now')}
          text={t("When someone adds you, they'll appear here to accept or decline. Your conversations are in Social, under Chats.")}
        />
      }
      renderItem={({ item }) => {
        const p = item.requester ?? {};
        return (
          <Card>
            <TouchableOpacity style={styles.rowTop} onPress={() => p.id && router.push(`/user/${p.id}`)}>
              <Avatar uri={p.avatar_url} name={p.full_name} id={p.id} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.full_name ?? t('Someone')}</Text>
                {p.university || p.major ? (
                  <Text style={styles.meta}>{p.university ?? ''}{p.major ? `${p.university ? ' · ' : ''}${p.major}` : ''}</Text>
                ) : null}
                <View style={[styles.metaRow, { marginTop: 3 }]}>
                  <Reliability value={p.reliability} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.faint} accessibilityLabel={t('View profile')} />
            </TouchableOpacity>
            <View style={styles.actions}>
              <Button title={t('Accept')} variant="primary" style={{ flex: 1 }} onPress={() => respond(item, true)} />
              <Button title={t('Decline')} variant="ghost" style={{ flex: 1 }} onPress={() => respond(item, false)} />
            </View>
          </Card>
        );
      }}
    />
  );
}

function SegBtn({ icon, label, on, onPress, n = 0 }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.segBtn, on && styles.segBtnOn]}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!on }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Ionicons name={icon} size={15} color={on ? colors.onBrand : colors.muted} />
        <Text style={[styles.segText, on && { color: colors.onBrand }]} numberOfLines={1}>{label}</Text>
        <Dot n={n} plain />
      </View>
    </TouchableOpacity>
  );
}

function Reliability({ value }) {
  return (
    <>
      <Ionicons name="shield-checkmark-outline" size={12} color={colors.brand} />
      <Text style={styles.meta}> {t('{n}% reliable', { n: value ?? 75 })}</Text>
    </>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { label: t('Pending'), icon: 'time-outline', c: colors.warn, b: colors.warnSoft },
    accepted: { label: t('Accepted'), icon: 'checkmark-circle', c: colors.brand, b: colors.brandSoft },
    rejected: { label: t('Not selected'), icon: 'close-circle-outline', c: colors.danger, b: colors.dangerSoft },
  };
  const s = map[status] ?? map.pending;
  return <Tag label={s.label} icon={s.icon} color={s.c} soft={s.b} />;
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, width: '100%', maxWidth: 680, alignSelf: 'center' },
  heading: { ...type.h1 },
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 4, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  segBtn: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.brand },
  segText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  legend: { ...type.small, textAlign: 'center', marginBottom: 12 },
  event: { ...type.caption, color: colors.brand, textTransform: 'uppercase', marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...type.title, fontSize: 15 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  bio: { fontSize: 13, color: colors.body, marginTop: 10, fontStyle: 'italic', lineHeight: 19 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
  link: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.ink },
});
