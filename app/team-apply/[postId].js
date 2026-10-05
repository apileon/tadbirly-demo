import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, radius } from '../../lib/theme';
import { Button, Card } from '../../components/ui';
import { notify } from '../../lib/notify';
import { myTeamsWithSize, applyAsTeam } from '../../lib/teams';

export default function TeamApply() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const [post, setPost] = useState(null);
  const [teams, setTeams] = useState([]);
  const [applied, setApplied] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: p } = await supabase.from('posts').select('title, team_min, team_mode').eq('id', postId).single();
      setPost(p);
      const all = await myTeamsWithSize();
      const { data: statuses } = await supabase.from('teams').select('id, status').in('id', all.map((t) => t.id).length ? all.map((t) => t.id) : ['00000000-0000-0000-0000-000000000000']);
      const smap = {};
      (statuses ?? []).forEach((s) => { smap[s.id] = s.status; });
      setTeams(all.map((t) => ({ ...t, status: smap[t.id] ?? 'pending' })));
      const { data: ta } = await supabase.from('team_applications').select('team_id, status').eq('post_id', postId);
      setApplied(ta ?? []);
    } finally {
      setLoading(false); // never leave the page spinning if something throws
    }
  }, [postId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submit() {
    if (!chosen) return notify('Pick a team', 'Choose which team is applying.');
    if (chosen.status !== 'approved') {
      return notify('Team not approved yet', `“${chosen.name}” has to be approved by an organizer before it can apply to events.`);
    }
    const min = post?.team_min ?? 2;
    if (chosen.size < min) {
      return notify('Team too small', `This event needs at least ${min} members. "${chosen.name}" has ${chosen.size}. Invite more people from the team page.`);
    }
    setBusy(true);
    // try/finally: a throw (e.g. a network blip) used to leave this button
    // spinning forever.
    try {
      const { error } = await applyAsTeam(postId, chosen.id, message);
      if (error) {
        const dup = error.code === '23505' || String(error.message).includes('duplicate');
        return notify('Could not apply', dup ? 'This team has already applied to this event.' : error.message);
      }
      notify('Team applied ✅', 'The organizer will review your team and can see every member’s profile.');
      router.back();
    } catch (e) {
      notify('Could not apply', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  const min = post?.team_min ?? 2;
  const appliedIds = new Set(applied.filter((a) => a.status !== 'rejected').map((a) => a.team_id));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.h1}>Apply as a team</Text>
      <Text style={styles.sub}>{post?.title} · needs teams of at least {min} people.</Text>

      {teams.length === 0 ? (
        <Card>
          <Text style={styles.empty}>You don't own a team yet. Create one in the Teams tab, invite members, then come back here.</Text>
          {/* dismissTo, not replace('/(tabs)/…'): replace stacked a second tab navigator. */}
          <Button title="🧩 Go to Team Builder" style={{ marginTop: 12 }} onPress={() => router.dismissTo('/team-builder')} />
        </Card>
      ) : (
        <>
          <Text style={styles.label}>Choose your team</Text>
          {teams.map((t) => {
            const already = appliedIds.has(t.id);
            const tooSmall = t.size < min;
            const notApproved = t.status !== 'approved';
            const blocked = already || notApproved;
            const on = chosen?.id === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                disabled={blocked}
                onPress={() => setChosen(t)}
                style={[styles.team, on && styles.teamOn, blocked && { opacity: 0.55 }]}
              >
                <Text style={[styles.teamName, on && { color: '#fff' }]}>🧩 {t.name}</Text>
                <Text style={[styles.teamMeta, on && { color: 'rgba(255,255,255,0.85)' }]}>
                  {t.size} member{t.size === 1 ? '' : 's'}
                  {notApproved ? (t.status === 'rejected' ? ' · ❌ not approved' : ' · ⏳ waiting for organizer approval')
                    : already ? ' · already applied'
                    : tooSmall ? ` · needs ${min - t.size} more`
                    : ' · ready'}
                </Text>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.label}>Message to the organizer (optional)</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder="Why your team is a great fit…"
            placeholderTextColor={colors.muted}
          />

          <Button title="Apply as this team" onPress={submit} loading={busy} style={{ marginTop: 18 }} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.muted, marginTop: 6, lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 18, marginBottom: 8 },
  team: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  teamOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  teamName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  teamMeta: { fontSize: 12.5, color: colors.muted, marginTop: 3 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  empty: { fontSize: 13.5, color: colors.muted, lineHeight: 20 },
});
