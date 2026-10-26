import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify, confirmAsync } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow, column } from '../../lib/theme';
import { Button, Avatar, EmptyState, SectionHeader, Tag, TextField } from '../../components/ui';
import { inviteToTeam, approveTeam, rejectTeam, deleteTeam, respondTeam } from '../../lib/teams';
import { useReportSheet } from '../../lib/moderation';
import { t } from '../../lib/i18n';

// Display for teams.status (lib/teams TEAM_STATUS carries emoji labels).
const STATUS_META = {
  pending: { label: 'Waiting for approval', icon: 'time-outline', color: colors.warn, soft: colors.warnSoft },
  approved: { label: 'Approved', icon: 'checkmark-circle', color: colors.accent, soft: colors.accentSoft },
  rejected: { label: 'Not approved', icon: 'close-circle', color: colors.danger, soft: colors.dangerSoft },
};

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
    const { data: tm } = await supabase.from('teams').select('*').eq('id', id).single();
    setTeam(tm);
    if (iAmOrg && tm && tm.owner_id !== uid) {
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
    if (tm?.owner_id === uid) {
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
  if (!team) return <EmptyState icon="people-outline" title={t('Team not found.')} />;

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
  const status = STATUS_META[team.status ?? 'pending'] ?? STATUS_META.pending;
  const invitable = connections.filter((c) => !memberIds.has(c.id));

  async function confirmDelete() {
    const ok = await confirmAsync(
      t('Delete this team?'),
      t('“{name}” will be removed for everyone, along with its members and any applications it made to events. This cannot be undone.', { name: team.name }),
      t('Delete'),
    );
    if (!ok) return;
    const { error } = await deleteTeam(id);
    if (error) return notify(t('Could not delete'), error.message);
    notify(t('Team deleted'), t('“{name}” is gone.', { name: team.name }));
    // dismissTo pops back to the tabs already underneath instead of stacking
    // a second tab navigator on top (router.replace did). Organizers manage
    // teams from Portal → Teams; participants from the Teams tab.
    router.dismissTo(iAmOrg ? '/portal?tab=teams' : '/team-builder');
  }

  async function leaveTeam() {
    const ok = await confirmAsync(t('Leave this team?'), t('You\'ll be removed from “{name}”.', { name: team.name }), t('Leave'));
    if (!ok) return;
    const { error } = await supabase.from('team_members').delete().eq('team_id', id).eq('user_id', uid);
    if (error) return notify(t('Could not leave'), error.message);
    notify(t('You left the team'), '');
    router.dismissTo('/team-builder');
  }

  async function answerInvite(accept) {
    setAnswering(true);
    const { error } = await respondTeam(myRow.id, accept);
    setAnswering(false);
    if (error) return notify(t('Could not answer the invite'), error.message);
    notify(accept ? t('You joined {name}', { name: team.name }) : t('Invite declined'), '');
    load();
  }

  async function invite(userId, name) {
    const { error } = await inviteToTeam(id, userId);
    // Only a duplicate row means "already invited"; anything else (network,
    // permissions) is shown as it is instead of being mislabelled.
    if (error && error.code !== '23505') return notify(t('Could not invite'), error.message);
    if (error) {
      notify(t('Already invited'), name
        ? t('{name} has already been invited or is a member.', { name })
        : t('This person has already been invited or is a member.'));
    } else {
      notify(t('Invite sent'), name
        ? t('{name} will see it in their Portal → Teams.', { name })
        : t('They will see it in their Portal → Teams.'));
    }
    setQ(''); setFound([]);
    load();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.teamIcon}><Ionicons name="people" size={22} color={colors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{team.name}</Text>
            <Text style={styles.meta}>
              {team.spots
                ? t('{competition} · {n} spots', { competition: team.competition ?? t('Competition'), n: team.spots })
                : team.competition ?? t('Competition')}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 12 }}>
          <Tag label={t(status.label)} icon={status.icon} color={status.color} soft={status.soft} />
        </View>
        {team.status !== 'approved' && isOwner && (
          <Text style={styles.statusHelp}>
            {team.status === 'rejected'
              ? t('An organizer did not approve this team. Create a new team, or contact an organizer and ask them to take another look.')
              : t('An organizer needs to approve your team before it can apply to events. Invite your members first.')}
          </Text>
        )}

        {iAmOrg && team.status !== 'approved' && (
          <View style={[styles.row, { marginTop: 14 }]}>
            <Button title={t('Approve team')} icon="checkmark-circle-outline" variant="primary" style={{ flex: 1 }}
              onPress={async () => { const { error } = await approveTeam(id); if (error) notify(t('Could not approve'), error.message); else { notify(t('Team approved'), t('They can now apply to events.')); load(); } }} />
            <Button title={t('Reject')} variant="ghost" style={{ flex: 1 }}
              onPress={async () => { const { error } = await rejectTeam(id); if (error) notify(t('Could not reject'), error.message); else load(); }} />
          </View>
        )}

        {team.description ? <Text style={styles.desc}>{team.description}</Text> : null}
      </View>

      {myRow?.status === 'invited' && (
        <View style={[styles.card, styles.inviteCard]}>
          <View style={styles.inviteHead}>
            <Ionicons name="mail-open-outline" size={18} color={colors.brand} />
            <Text style={styles.mName}>{t("You're invited to join this team")}</Text>
          </View>
          <View style={[styles.row, { marginTop: 12 }]}>
            <Button title={t('Accept')} icon="checkmark" variant="primary" size="sm" style={{ flex: 1 }} loading={answering} onPress={() => answerInvite(true)} />
            <Button title={t('Decline')} variant="ghost" size="sm" style={{ flex: 1 }} disabled={answering} onPress={() => answerInvite(false)} />
          </View>
        </View>
      )}
      {myRow?.status === 'requested' && (
        <View style={styles.notice}>
          <Ionicons name="time-outline" size={16} color={colors.warn} />
          <Text style={styles.noticeText}>{t("You asked to join. Waiting for the owner's answer.")}</Text>
        </View>
      )}

      <SectionHeader title={seesRoster ? t('Members ({n})', { n: accepted.length }) : t('Members')} />
      {!seesRoster && <Text style={styles.dim}>{t("You'll see who's in the team once you've joined it.")}</Text>}
      {accepted.length > 0 && (
        <View style={styles.group}>
          {accepted.map((m, i) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.personRow, i === accepted.length - 1 && { borderBottomWidth: 0 }]}
              activeOpacity={0.7}
              onPress={() => m.user_id && router.push(`/user/${m.user_id}`)}
            >
              <Avatar name={m.user?.full_name} id={m.user_id} size={38} />
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.mName} numberOfLines={1}>{m.user?.full_name}</Text>
                  {m.user_id === team.owner_id ? <Tag label={t('Owner')} color={colors.brand} soft={colors.brandSoft} /> : null}
                </View>
                {m.user?.university ? <Text style={styles.mMeta} numberOfLines={1}>{m.user.university}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.faint} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isOwner && pending.length > 0 && (
        <>
          <SectionHeader title={t('Invited, waiting for reply')} />
          <View style={styles.group}>
            {pending.map((m, i) => (
              <View key={m.id} style={[styles.personRow, i === pending.length - 1 && { borderBottomWidth: 0 }]}>
                <Avatar name={m.user?.full_name} id={m.user_id} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.mName} numberOfLines={1}>{m.user?.full_name}</Text>
                  <View style={styles.nameRow}>
                    <Ionicons name="time-outline" size={12} color={colors.muted} />
                    <Text style={styles.mMeta}>{t('Invite pending')}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      {isOwner && (
        <>
          <SectionHeader title={t('Invite people')} />
          <TextField
            icon="search-outline"
            value={q}
            onChangeText={search}
            placeholder={t('Search anyone by name…')}
            style={{ marginTop: 0, marginBottom: 12 }}
          />
          {found.filter((f) => !memberIds.has(f.id)).length > 0 && (
            <View style={styles.group}>
              {found.filter((f) => !memberIds.has(f.id)).map((f, i, arr) => (
                <View key={f.id} style={[styles.personRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                  <Avatar name={f.full_name} id={f.id} size={38} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mName} numberOfLines={1}>{f.full_name}</Text>
                    {f.university ? <Text style={styles.mMeta} numberOfLines={1}>{f.university}</Text> : null}
                  </View>
                  <Button title={t('Invite')} icon="person-add-outline" variant="soft" size="sm" onPress={() => invite(f.id, f.full_name)} />
                </View>
              ))}
            </View>
          )}

          {q.trim().length < 2 && (
            <>
              <SectionHeader title={t('From your network')} />
              {invitable.length === 0 ? (
                <Text style={styles.dim}>{t('No friends to invite yet. Search by name above, or add friends in Social → Find people.')}</Text>
              ) : (
                <View style={styles.group}>
                  {invitable.map((c, i) => (
                    <View key={c.id} style={[styles.personRow, i === invitable.length - 1 && { borderBottomWidth: 0 }]}>
                      <Avatar name={c.full_name} id={c.id} size={38} />
                      <Text style={[styles.mName, { flex: 1 }]} numberOfLines={1}>{c.full_name}</Text>
                      <Button title={t('Invite')} icon="person-add-outline" variant="soft" size="sm" onPress={() => invite(c.id, c.full_name)} />
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}

      {isOwner || iAmOrg ? (
        <>
          <Button title={t('Delete team')} icon="trash-outline" variant="danger" style={{ marginTop: 30 }} onPress={confirmDelete} />
          <Text style={styles.dangerNote}>
            {isOwner ? t('Members will lose access immediately.') : t('As an organizer you can remove any team.')}
          </Text>
        </>
      ) : accepted.some((m) => m.user_id === uid) ? (
        <Button title={t('Leave team')} icon="exit-outline" variant="ghost" style={{ marginTop: 30 }} onPress={leaveTeam} />
      ) : null}

      {!isOwner && (
        <TouchableOpacity
          style={styles.reportLink}
          onPress={() => {
            const owner = members.find((m) => m.user_id === team.owner_id)?.user?.full_name;
            safety.open({ type: 'team', id: team.id, userId: team.owner_id, name: owner ?? t('the team owner') });
          }}
        >
          <Ionicons name="flag-outline" size={13} color={colors.muted} />
          <Text style={styles.reportText}>{t('Report team or block its owner')}</Text>
        </TouchableOpacity>
      )}
      {safety.sheet}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, ...column },
  hero: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 16, ...shadow.sm,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamIcon: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  name: { ...type.h2 },
  meta: { ...type.small, marginTop: 2 },
  desc: { ...type.body, marginTop: 12 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 14, ...shadow.sm,
  },
  inviteCard: { marginTop: 14, borderColor: colors.brand },
  inviteHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: 12,
  },
  noticeText: { flex: 1, fontSize: 13, color: colors.body, lineHeight: 18 },
  group: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  personRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  mName: { fontSize: 15, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  mMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  dim: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  dangerNote: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  statusHelp: { fontSize: 12.5, color: colors.muted, marginTop: 8, lineHeight: 18 },
  reportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 22, paddingVertical: 8 },
  reportText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
});
