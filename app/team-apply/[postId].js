import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, radius, type, shadow, column } from '../../lib/theme';
import { Button, EmptyState, SectionHeader, TextField } from '../../components/ui';
import { notify } from '../../lib/notify';
import { myTeamsWithSize, applyAsTeam } from '../../lib/teams';
import { t } from '../../lib/i18n';

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
      const { data: statuses } = await supabase.from('teams').select('id, status').in('id', all.map((tm) => tm.id).length ? all.map((tm) => tm.id) : ['00000000-0000-0000-0000-000000000000']);
      const smap = {};
      (statuses ?? []).forEach((s) => { smap[s.id] = s.status; });
      setTeams(all.map((tm) => ({ ...tm, status: smap[tm.id] ?? 'pending' })));
      const { data: ta } = await supabase.from('team_applications').select('team_id, status').eq('post_id', postId);
      setApplied(ta ?? []);
    } finally {
      setLoading(false); // never leave the page spinning if something throws
    }
  }, [postId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submit() {
    if (!chosen) return notify(t('Pick a team'), t('Choose which team is applying.'));
    if (chosen.status !== 'approved') {
      return notify(t('Team not approved yet'), t('“{name}” has to be approved by an organizer before it can apply to events.', { name: chosen.name }));
    }
    const min = post?.team_min ?? 2;
    if (chosen.size < min) {
      return notify(t('Team too small'), t('This event needs at least {min} members. “{name}” has {n}. Invite more people from the team page.', { min, name: chosen.name, n: chosen.size }));
    }
    setBusy(true);
    // try/finally: a throw (e.g. a network blip) used to leave this button
    // spinning forever.
    try {
      const { error } = await applyAsTeam(postId, chosen.id, message);
      if (error) {
        const dup = error.code === '23505' || String(error.message).includes('duplicate');
        return notify(t('Could not apply'), dup ? t('This team has already applied to this event.') : error.message);
      }
      notify(t('Team applied'), t('The organizer will review your team and can see every member’s profile.'));
      router.back();
    } catch (e) {
      notify(t('Could not apply'), e?.message ?? t('Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  const min = post?.team_min ?? 2;
  const appliedIds = new Set(applied.filter((a) => a.status !== 'rejected').map((a) => a.team_id));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <Text style={styles.h1}>{t('Apply as a team')}</Text>
      <Text style={styles.sub}>
        {post?.title ? `${post.title} · ` : ''}{t('Needs teams of at least {n} people.', { n: min })}
      </Text>

      {teams.length === 0 ? (
        <View style={[styles.card, { marginTop: 16 }]}>
          {/* dismissTo, not replace('/(tabs)/…'): replace stacked a second tab navigator. */}
          <EmptyState
            icon="people-outline"
            title={t("You don't own a team yet")}
            text={t('Create one in the Teams tab, invite members, then come back here.')}
            action={t('Go to Team Builder')}
            onAction={() => router.dismissTo('/team-builder')}
            style={{ paddingVertical: 24 }}
          />
        </View>
      ) : (
        <>
          <SectionHeader title={t('Choose your team')} />
          {teams.map((tm) => {
            const already = appliedIds.has(tm.id);
            const tooSmall = tm.size < min;
            const notApproved = tm.status !== 'approved';
            const blocked = already || notApproved;
            const on = chosen?.id === tm.id;
            const state = notApproved
              ? (tm.status === 'rejected'
                ? { icon: 'close-circle-outline', text: t('Not approved'), color: colors.danger }
                : { icon: 'time-outline', text: t('Waiting for organizer approval'), color: colors.warn })
              : already ? { icon: 'checkmark-done-outline', text: t('Already applied'), color: colors.muted }
              : tooSmall ? { icon: 'person-add-outline', text: t('Needs {n} more', { n: min - tm.size }), color: colors.warn }
              : { icon: 'checkmark-circle-outline', text: t('Ready'), color: colors.accent };
            return (
              <TouchableOpacity
                key={tm.id}
                disabled={blocked}
                onPress={() => setChosen(tm)}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, disabled: blocked }}
                style={[styles.team, on && styles.teamOn, blocked && { opacity: 0.55 }]}
              >
                <View style={styles.teamIcon}><Ionicons name="people" size={18} color={colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.teamName} numberOfLines={1}>{tm.name}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.teamMeta}>
                      {tm.size === 1 ? t('1 member') : t('{n} members', { n: tm.size })}
                    </Text>
                    <Text style={styles.teamMeta}>·</Text>
                    <Ionicons name={state.icon} size={13} color={state.color} />
                    <Text style={[styles.teamMeta, { color: state.color }]}>{state.text}</Text>
                  </View>
                </View>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.brand : colors.faint} />
              </TouchableOpacity>
            );
          })}

          <TextField
            label={t('Message to the organizer (optional)')}
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder={t('Why your team is a great fit…')}
            inputStyle={{ height: 96, textAlignVertical: 'top' }}
            style={{ marginTop: 18 }}
          />

          <Button title={t('Apply as this team')} icon="paper-plane-outline" onPress={submit} loading={busy} style={{ marginTop: 18 }} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, ...column },
  h1: { ...type.h1 },
  sub: { ...type.small, marginTop: 6, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, ...shadow.sm },
  team: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 14, marginBottom: 10,
  },
  teamOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  teamIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  teamName: { ...type.title, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
  teamMeta: { fontSize: 12.5, color: colors.muted },
});
