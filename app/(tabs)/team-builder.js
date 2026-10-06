import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify } from '../../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow } from '../../lib/theme';
import { Button, SectionHeader, EmptyState, Avatar } from '../../components/ui';
import { requestJoin, TEAM_STATUS, skillMatches } from '../../lib/teams';
import { t } from '../../lib/i18n';
import { useReportSheet, useBlockedIds } from '../../lib/moderation';

// Same column width as the feed on a laptop, instead of full-screen bars.
const MAX_W = 720;

export default function TeamBuilder() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const [mine, setMine] = useState([]);
  const [open, setOpen] = useState([]);
  const [joining, setJoining] = useState(null);
  const blocked = useBlockedIds();
  // Blocking the owner from the sheet hides their teams straight away.
  const safety = useReportSheet();

  const load = useCallback(async () => {
    if (!uid) return;
    // Teams I'm in (accepted)
    const { data: memberships } = await supabase
      .from('team_members')
      .select('status, team:teams(id, name, competition, spots, owner_id, status)')
      .eq('user_id', uid).eq('status', 'accepted');
    setMine((memberships ?? []).map((m) => m.team).filter(Boolean));
    // Open teams to browse — only approved ones (not mine)
    const { data: allTeams } = await supabase
      .from('teams')
      .select('*, owner:profiles!teams_owner_id_fkey(full_name)')
      .eq('status', 'approved')
      .neq('owner_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    setOpen(allTeams ?? []);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function join(teamId) {
    // requestJoin explains itself ("already in this team", "already asked",
    // network errors…) and lets people ask again after being declined, so
    // show its message rather than assuming every error means "already requested".
    setJoining(teamId);
    const { error } = await requestJoin(teamId);
    setJoining(null);
    if (error) return notify(t('Could not send the request'), error.message);
    notify(t('Request sent'), t('The team owner will see it in their Portal → Teams.'));
  }

  function report(team) {
    safety.open({
      type: 'team',
      id: team.id,
      userId: team.owner_id,
      name: team.owner?.full_name ?? t('the team owner'),
    });
  }

  // Teams that need skills you have come first.
  const visible = open
    .filter((tm) => !blocked.has(tm.owner_id))
    .map((tm, i) => ({ tm, i, m: skillMatches(tm.skills_needed, profile?.skills) }))
    .sort((a, b) => b.m.length - a.m.length || a.i - b.i)
    .map(({ tm, m }) => ({ ...tm, matched: m }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={type.h1}>{t('Teams')}</Text>
                <Text style={styles.sub}>{t("Build a team for any competition, or join one. New teams need an organizer's approval before they can apply to events.")}</Text>
              </View>
            </View>
            <Button title={t('Create a team')} icon="add" onPress={() => router.push('/team/create')} />

            {mine.length > 0 && <SectionHeader title={t('My teams')} />}
            {mine.map((tm) => {
              const s = TEAM_STATUS[tm.status ?? 'pending'] ?? TEAM_STATUS.pending;
              return (
                <TouchableOpacity key={tm.id} style={styles.card} activeOpacity={0.9} onPress={() => router.push(`/team/${tm.id}`)}>
                  <View style={styles.cardTop}>
                    <View style={styles.teamIcon}><Ionicons name="people" size={18} color={colors.brand} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{tm.name}</Text>
                      <Text style={styles.meta} numberOfLines={1}>{tm.competition ?? t('Competition')}{tm.owner_id === uid ? ` · ${t('you own this')}` : ''}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                  </View>
                  <Text style={[styles.status, { color: s.color }]}>{t(s.label)}</Text>
                </TouchableOpacity>
              );
            })}
            <SectionHeader title={t('Open teams')} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="people-outline" title={t('No open teams yet')} text={t('Create the first one and invite your friends.')} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => router.push(`/team/${item.id}`)}>
            <View style={styles.cardTop}>
              <View style={styles.teamIcon}><Ionicons name="people" size={18} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.competition ?? t('Competition')}{item.spots ? ` · ${item.spots} spots` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => report(item)}
                style={styles.flag}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={t('Report team {name}', { name: item.name })}
              >
                <Ionicons name="flag-outline" size={17} color={colors.muted} />
              </TouchableOpacity>
            </View>
            {item.description ? <Text style={styles.desc} numberOfLines={3}>{item.description}</Text> : null}
            {(item.skills_needed ?? []).length > 0 && (
              <View style={styles.skills}>
                {item.matched.length > 0 && (
                  <View style={styles.match}>
                    <Ionicons name="sparkles" size={11} color={colors.onBrand} />
                    <Text style={styles.matchText}>{t('You match')}</Text>
                  </View>
                )}
                {item.skills_needed.map((sk) => {
                  const hit = item.matched.includes(sk);
                  return (
                    <View key={sk} style={[styles.skill, hit && styles.skillHit]}>
                      {hit ? <Ionicons name="checkmark" size={11} color={colors.brand} /> : null}
                      <Text style={[styles.skillText, hit && { color: colors.brand }]}>{sk}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            <View style={styles.cardFoot}>
              <Avatar id={item.owner_id} name={item.owner?.full_name} size={22} />
              <Text style={styles.owner} numberOfLines={1}>{item.owner?.full_name ?? t('Someone')}</Text>
              <Button
                title={t('Request to join')}
                size="sm"
                loading={joining === item.id}
                onPress={() => join(item.id)}
              />
            </View>
          </TouchableOpacity>
        )}
      />
      {safety.sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: MAX_W, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  sub: { ...type.small, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 12, ...shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  name: { ...type.title, fontSize: 15.5 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  flag: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  status: { fontSize: 12.5, fontWeight: '700', marginTop: 10 },
  desc: { ...type.body, fontSize: 14, lineHeight: 20, marginTop: 10 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  owner: { flex: 1, fontSize: 13, color: colors.body, fontWeight: '600' },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  skill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9 },
  skillHit: { backgroundColor: colors.brandSoft },
  skillText: { fontSize: 12, fontWeight: '600', color: colors.body },
  match: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9 },
  matchText: { fontSize: 12, fontWeight: '700', color: colors.onBrand },
});
