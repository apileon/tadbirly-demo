import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { notify } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Card, Button } from '../../components/ui';
import { openDirectChat } from '../../lib/social';
import { acceptTeamApplication, rejectTeamApplication } from '../../lib/teams';
import { requireRows } from '../../lib/events';

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
    const { data: p } = await supabase.from('posts').select('title, team_mode, team_min, author_id').eq('id', postId).single();
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
      notify('Could not update', error.message);
      load();
    }
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <Text style={styles.empty}>Event not found.</Text>;
  if (post.author_id !== uid) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={styles.empty}>Only the organizer of this event can open this page.</Text>
        <Button title="Open the event" variant="ghost" style={{ marginTop: 14 }} onPress={() => router.replace(`/post/${postId}`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.head}>
        <Text style={styles.title}>{post?.title ?? 'Applicants'}</Text>
        <Text style={styles.sub}>
          {rows.length} individual · {teamApps.length} team application{rows.length + teamApps.length === 1 ? '' : 's'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Button title="👥 Accepted" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/accepted/${postId}`)} />
          <Button title="🏅 Medals" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/badge/${postId}`)} />
        </View>
        <Button title="🏁 End event & send feedback" variant="dark" style={{ marginTop: 8 }} onPress={() => router.push(`/end/${postId}`)} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          teamApps.length > 0 ? (
            <View>
              <Text style={styles.section}>🧩 Team applications</Text>
              {teamApps.map((ta) => (
                <TeamAppCard key={ta.id} app={ta} postId={postId} onChanged={load} />
              ))}
              <Text style={styles.section}>👤 Individual applications</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {post?.team_mode === 'team' && teamApps.length === 0
              ? 'No team applications yet. This event accepts teams only.'
              : 'No applications yet.'}
          </Text>
        }
        renderItem={({ item }) => {
          const a = item.applicant ?? {};
          return (
            <Card>
              <TouchableOpacity style={styles.rowTop} onPress={() => a.id && router.push(`/user/${a.id}`)}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(a.full_name ?? '?')[0]}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{a.full_name ?? 'Applicant'}</Text>
                  <Text style={styles.meta}>
                    {a.university ? `${a.university} · ` : ''}⭐ {a.reliability ?? 75}%
                    {a.verified_student ? ' · ✔ Verified' : ''} · view profile →
                  </Text>
                </View>
                <StatusPill status={item.status} />
              </TouchableOpacity>

              {item.status === 'pending' ? (
                <View style={styles.actions}>
                  <Button title="Accept" variant="green" style={styles.actionBtn} onPress={() => decide(item, 'accepted')} />
                  <Button title="Reject" variant="ghost" style={styles.actionBtn} onPress={() => decide(item, 'rejected')} />
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button
                    title="💬 Message"
                    variant="ghost"
                    style={styles.actionBtn}
                    onPress={async () => {
                      try { const cid = await openDirectChat(a.id); router.push(`/chat/${cid}`); }
                      catch (e) { notify('Could not open chat', e.message); }
                    }}
                  />
                  {item.status === 'rejected' ? (
                    <Button title="✅ Accept instead" variant="green" style={styles.actionBtn} onPress={() => decide(item, 'accepted')} />
                  ) : (
                    <Button title="↩ Undo accept" variant="ghost" style={styles.actionBtn} onPress={() => decide(item, 'pending')} />
                  )}
                </View>
              )}
            </Card>
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
    if (error) notify('Could not update', error.message);
    else {
      notify(accept ? 'Team accepted ✅' : 'Team rejected',
        accept ? 'Every member is now an accepted participant and can use the event chat.' : '');
      onChanged();
    }
  }

  return (
    <Card>
      <View style={styles.rowTop}>
        <View style={styles.avatar}><Text style={styles.avatarText}>🧩</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{app.team?.name ?? 'Team'}</Text>
          <Text style={styles.meta}>{app.team?.competition ?? 'Team application'}</Text>
        </View>
        <StatusPill status={app.status} />
      </View>
      {app.message ? <Text style={styles.teamMsg}>“{app.message}”</Text> : null}

      <TouchableOpacity onPress={toggle} style={{ marginTop: 10 }}>
        <Text style={styles.linkish}>{open ? '▾ Hide members' : '▸ See members & profiles'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 8 }}>
          {members.length === 0 ? (
            <Text style={styles.meta}>No accepted members in this team yet.</Text>
          ) : members.map((m) => (
            <TouchableOpacity key={m.id} style={styles.memberRow} onPress={() => router.push(`/user/${m.id}`)}>
              <View style={styles.avatarSm}><Text style={styles.avatarSmText}>{(m.full_name ?? '?')[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.full_name}{m.verified_student ? ' ✔' : ''}</Text>
                <Text style={styles.meta}>{m.university ?? ''}{m.major ? ` · ${m.major}` : ''} · ⭐ {m.reliability ?? 75}%</Text>
              </View>
              <Text style={styles.linkish}>View →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {app.status === 'pending' ? (
        <View style={styles.actions}>
          <Button title="Accept team" variant="green" style={styles.actionBtn} loading={busy} onPress={() => decide(true)} />
          <Button title="Reject" variant="ghost" style={styles.actionBtn} onPress={() => decide(false)} />
        </View>
      ) : app.status === 'rejected' ? (
        <Button title="✅ Accept instead" variant="green" style={{ marginTop: 10 }} loading={busy} onPress={() => decide(true)} />
      ) : null}
    </Card>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { t: '🟡 Pending', c: colors.warn, b: colors.warnSoft },
    accepted: { t: '🟢 Accepted', c: colors.accent, b: colors.accentSoft },
    rejected: { t: '🔴 Rejected', c: colors.danger, b: '#fdecec' },
  };
  const s = map[status] ?? map.pending;
  return <Text style={[styles.pill, { color: s.c, backgroundColor: s.b }]}>{s.t}</Text>;
}

const styles = StyleSheet.create({
  head: { backgroundColor: colors.card, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 18 },
  name: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  pill: { fontSize: 11, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
  section: { fontSize: 14, fontWeight: '800', color: colors.ink, marginBottom: 10, marginTop: 4 },
  teamMsg: { fontSize: 13, color: colors.ink, fontStyle: 'italic', marginTop: 10, lineHeight: 19 },
  linkish: { fontSize: 12.5, color: colors.brand, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  avatarSm: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarSmText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.ink },
});
