import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonList } from '../components/Skeleton';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, type, shadow } from '../lib/theme';
import { Avatar, EmptyState } from '../components/ui';
import { t } from '../lib/i18n';

// Medals for the podium are part of the ranking itself (same emoji as awards).
const medal = (place) => (place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : null);

export default function Leaderboard() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('leaderboard', { limit_n: 200 });
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <SkeletonList count={6} type="row" />;

  const me = rows.find((r) => r.user_id === uid);
  const top = rows.filter((r) => r.points > 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={top}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <View>
            {me && (
              <View style={styles.meCard}>
                <View style={styles.meIcon}>
                  <Ionicons name="trophy-outline" size={22} color={colors.onBrand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.meLabel}>{t('Your position')}</Text>
                  <Text style={styles.meValue}>
                    {me.points > 0 ? `#${me.place}` : '-'}
                    {'  ·  '}
                    {me.points === 1 ? t('1 point') : t('{n} points', { n: me.points })}
                    {me.wins > 0 ? `  ·  ${me.wins === 1 ? t('1 win') : t('{n} wins', { n: me.wins })}` : ''}
                  </Text>
                </View>
              </View>
            )}
            <Text style={styles.intro}>
              {t('Points are awarded by organizers when they rank participants after an event. Wins are worth the most.')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="trophy-outline"
            title={t('Nobody has points yet')}
            text={t('Once organizers start awarding places after their events, the ranking fills up here.')}
          />
        }
        renderItem={({ item }) => {
          const isMe = item.user_id === uid;
          const m = medal(Number(item.place));
          return (
            <TouchableOpacity
              style={[styles.row, m && styles.rowPodium, isMe && styles.rowMe]}
              onPress={() => router.push(`/user/${item.user_id}`)}
              activeOpacity={0.85}
            >
              <View style={styles.placeBox}>
                {m ? <Text style={styles.medal}>{m}</Text> : <Text style={styles.place}>{item.place}</Text>}
              </View>
              <Avatar uri={item.avatar_url} name={item.full_name} id={item.user_id} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, isMe && { color: colors.brand }]} numberOfLines={1}>
                  {isMe ? t('{name} (you)', { name: item.full_name }) : item.full_name}
                </Text>
                <View style={styles.metaRow}>
                  {item.wins > 0 ? <Ionicons name="trophy-outline" size={12} color={colors.warn} /> : null}
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.university ? `${item.university} · ` : ''}
                    {item.wins > 0
                      ? (item.wins === 1 ? t('1 win') : t('{n} wins', { n: item.wins }))
                      : t('No wins yet')}
                  </Text>
                </View>
              </View>
              <View style={styles.pointsBox}>
                <Text style={styles.points}>{item.points}</Text>
                <Text style={styles.pointsLabel}>{t('pts')}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  meCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.brand, borderRadius: radius.lg, padding: 16, marginBottom: 14, ...shadow.md,
  },
  meIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  meLabel: { ...type.caption, color: colors.onBrand, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.8 },
  meValue: { ...type.h2, color: colors.onBrand, marginTop: 2 },
  intro: { ...type.small, marginBottom: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 12, marginBottom: 8,
  },
  rowPodium: { borderColor: colors.warn, backgroundColor: colors.warnSoft },
  rowMe: { borderColor: colors.brand, borderWidth: 2 },
  placeBox: { width: 30, alignItems: 'center' },
  medal: { fontSize: 22 },
  place: { fontSize: 15, fontWeight: '800', color: colors.muted },
  name: { ...type.title, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { ...type.small, fontSize: 12, flexShrink: 1 },
  pointsBox: { alignItems: 'flex-end', minWidth: 46 },
  points: { fontSize: 17, fontWeight: '800', color: colors.brand },
  pointsLabel: { ...type.caption, fontSize: 10 },
});
