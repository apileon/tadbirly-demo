import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow } from '../../lib/theme';
import { Button, Avatar, EmptyState, SectionHeader, Tag } from '../../components/ui';
import { openDirectChat } from '../../lib/social';
import { acceptTeamApplication, rejectTeamApplication } from '../../lib/teams';
import { requireRows } from '../../lib/events';
import { t } from '../../lib/i18n';

export default function Applicants() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [rows, setRows] = useState([]);
  const [teamApps, setTeamApps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('posts').select('*').eq('id', postId).single();
    setPost(p);
    // Organizer-only screen. A participant opening the link used to see their
    // own application here — with an Accept button.
    if (!p || p.author_id !== uid) { setLoading(false); return; }
    const { data: ta } = await supabase
      .from('team_applications')
      .select('*, team:teams(id, name, competition)')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    setTeamApps(ta ?? []);
    const { data } = await supabase
      .from('applications')
      .select('*, applicant:profiles!applications_applicant_id_fkey(id, full_name, university, reliability, verified_student)')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, [postId, uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function decide(app, status) {
    // Optimistic update
    setRows((prev) => prev.map((r) => (r.id === app.id ? { ...r, status } : r)));
    // requireRows: a blocked update changes nothing but reports no error.
    const { error } = await requireRows(supabase.from('applications').update({ status }).eq('id', app.id));
    if (error) {
      notify(t('Could not update'), error.message);
      load();
    }
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="calendar-outline" title={t('Event not found.')} />;
  if (post.author_id !== uid) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('Only the organizer of this event can open this page.')}
          action={t('Open the event')}
          onAction={() => router.replace(`/post/${postId}`)}
        />
      </View>
    );
  }

  const total = rows.length + teamApps.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.head}>
        <View style={styles.inner}>
          <Text style={styles.title}>{post?.title ?? t('Applicants')}</Text>
          <Text style={styles.sub}>
            {total === 1
              ? t('{a} individual · {b} team application', { a: rows.length, b: teamApps.length })
              : t('{a} individual · {b} team applications', { a: rows.length, b: teamApps.length })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title={t('Accepted')} icon="people-outline" variant="ghost" size="sm" style={{ flex: 1 }} onPress={() => router.push(`/accepted/${postId}`)} />
            <Button title={t('Medals')} icon="medal-outline" variant="ghost" size="sm" style={{ flex: 1 }} onPress={() => router.push(`/badge/${postId}`)} />
          </View>
          <Button title={t('End event and send feedback')} icon="flag-outline" variant="primary" size="sm" style={{ marginTop: 8 }} onPress={() => router.push(`/end/${postId}`)} />
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          teamApps.length > 0 ? (
            <View>
              <SectionHeader title={t('Team applications')} style={{ marginTop: 4 }} />
              {teamApps.map((ta) => (
                <TeamAppCard key={ta.id} app={ta} postId={postId} onChanged={load} />
              ))}
              <SectionHeader title={t('Individual applications')} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={post?.team_mode === 'team' && teamApps.length === 0
              ? t('No team applications yet. This event accepts teams only.')
              : t('No applications yet.')}
          />
        }
        renderItem={({ item }) => {
          const a = item.applicant ?? {};
          return (
            <View style={styles.card}>
              <TouchableOpacity style={styles.rowTop} onPress={() => a.id && router.push(`/user/${a.id}`)}>
                <Avatar name={a.full_name} id={a.id} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{a.full_name ?? t('Applicant')}</Text>
                    {a.verified_student ? <Ionicons name="checkmark-circle" size={15} color={colors.brand} accessibilityLabel={t('Verified')} /> : null}
                  </View>
                  <View style={styles.metaRow}>
                    {a.university ? <Text style={styles.meta} numberOfLines={1}>{a.university}</Text> : null}
                    <Ionicons name="shield-checkmark" size={12} color={colors.brand} />
                    <Text style={styles.meta}>{a.reliability ?? 75}%</Text>
                  </View>
                </View>
                <StatusPill status={item.status} />
                <Ionicons name="chevron-forward" size={17} color={colors.faint} />
              </TouchableOpacity>

              <Answers questions={post.questions} answers={item.answers} />

              {item.status === 'pending' ? (
                <View style={styles.actions}>
                  <Button title={t('Accept')} icon="checkmark" variant="primary" size="sm" style={styles.actionBtn} onPress={() => decide(item, 'accepted')} />
                  <Button title={t('Reject')} variant="ghost" size="sm" style={styles.actionBtn} onPress={() => decide(item, 'rejected')} />
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button
                    title={t('Message')}
                    icon="chatbubbles-outline"
                    variant="ghost"
                    size="sm"
                    style={styles.actionBtn}
                    onPress={async () => {
                      try { const cid = await openDirectChat(a.id); router.push(`/chat/${cid}`); }
                      catch (e) { notify(t('Could not open chat'), e.message); }
                    }}
                  />
                  {item.status === 'rejected' ? (
                    <Button title={t('Accept instead')} icon="checkmark-circle-outline" variant="primary" size="sm" style={styles.actionBtn} onPress={() => decide(item, 'accepted')} />
                  ) : (
                    <Button title={t('Undo accept')} icon="arrow-undo-outline" variant="ghost" size="sm" style={styles.actionBtn} onPress={() => decide(item, 'pending')} />
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

function TeamAppCard({ app, postId, onChanged }) {
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!open && members.length === 0) {
      const { data } = await supabase.rpc('team_roster_for_event', { t: app.team_id, p: postId });
      setMembers(data ?? []);
    }
    setOpen((v) => !v);
  }

  async function decide(accept) {
    setBusy(true);
    const { error } = accept ? await acceptTeamApplication(app.id) : await rejectTeamApplication(app.id);
    setBusy(false);
    if (error) notify(t('Could not update'), error.message);
    else {
      notify(accept ? t('Team accepted') : t('Team rejected'),
        accept ? t('Every member is now an accepted participant and can use the event chat.') : '');
      onChanged();
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.teamIcon}><Ionicons name="people-outline" size={22} color={colors.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{app.team?.name ?? t('Team')}</Text>
          <Text style={styles.meta} numberOfLines={1}>{app.team?.competition ?? t('Team application')}</Text>
        </View>
        <StatusPill status={app.status} />
      </View>
      {app.message ? <Text style={styles.teamMsg}>“{app.message}”</Text> : null}

      <TouchableOpacity onPress={toggle} style={styles.toggle}>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.brand} />
        <Text style={styles.linkish}>{open ? t('Hide members') : t('See members and profiles')}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 8 }}>
          {members.length === 0 ? (
            <Text style={styles.meta}>{t('No accepted members in this team yet.')}</Text>
          ) : members.map((m) => (
            <TouchableOpacity key={m.id} style={styles.memberRow} onPress={() => router.push(`/user/${m.id}`)}>
              <Avatar name={m.full_name} id={m.id} size={34} />
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.memberName} numberOfLines={1}>{m.full_name}</Text>
                  {m.verified_student ? <Ionicons name="checkmark-circle" size={14} color={colors.brand} accessibilityLabel={t('Verified')} /> : null}
                </View>
                <View style={styles.metaRow}>
                  {m.university || m.major ? (
                    <Text style={styles.meta} numberOfLines={1}>{[m.university, m.major].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                  <Ionicons name="shield-checkmark" size={12} color={colors.brand} />
                  <Text style={styles.meta}>{m.reliability ?? 75}%</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.faint} accessibilityLabel={t('View')} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {app.status === 'pending' ? (
        <View style={styles.actions}>
          <Button title={t('Accept team')} icon="checkmark" variant="primary" size="sm" style={styles.actionBtn} loading={busy} onPress={() => decide(true)} />
          <Button title={t('Reject')} variant="ghost" size="sm" style={styles.actionBtn} onPress={() => decide(false)} />
        </View>
      ) : app.status === 'rejected' ? (
        <Button title={t('Accept instead')} icon="checkmark-circle-outline" variant="primary" size="sm" style={{ marginTop: 12 }} loading={busy} onPress={() => decide(true)} />
      ) : null}
    </View>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { label: t('Pending'), icon: 'time-outline', c: colors.warn, b: colors.warnSoft },
    accepted: { label: t('Accepted'), icon: 'checkmark-circle', c: colors.accent, b: colors.accentSoft },
    rejected: { label: t('Rejected'), icon: 'close-circle', c: colors.danger, b: colors.dangerSoft },
  };
  const s = map[status] ?? map.pending;
  return <Tag label={s.label} icon={s.icon} color={s.c} soft={s.b} />;
}

// The applicant's answers to the organizer's questions (supabase/29).
function Answers({ questions, answers }) {
  const qs = Array.isArray(questions) ? questions : [];
  const as = Array.isArray(answers) ? answers : [];
  const pairs = qs.map((q, i) => ({ q: q?.q, a: as[i] })).filter((p) => p.q && p.a);
  if (!pairs.length) return null;
  return (
    <View style={styles.answers}>
      {pairs.map((p, i) => (
        <View key={i} style={i ? { marginTop: 10 } : null}>
          <Text style={styles.answerQ}>{p.q}</Text>
          <Text style={styles.answerA}>{p.a}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  answers: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, marginTop: 12 },
  answerQ: { ...type.caption },
  answerA: { fontSize: 14, color: colors.ink, marginTop: 3, lineHeight: 20 },
  head: { backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  inner: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  title: { ...type.h2 },
  sub: { ...type.small, marginTop: 2 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 14, marginBottom: 12, ...shadow.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  teamIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  name: { ...type.title, fontSize: 15.5, flexShrink: 1 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1 },
  teamMsg: { fontSize: 13.5, color: colors.body, fontStyle: 'italic', marginTop: 10, lineHeight: 19 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-start' },
  linkish: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.line },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.ink, flexShrink: 1 },
});
