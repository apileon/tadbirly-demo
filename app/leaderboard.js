import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SkeletonList } from '../components/Skeleton';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

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
      {me && (
        <View style={styles.meBar}>
          <Text style={styles.meLabel}>Your position</Text>
          <Text style={styles.meValue}>
            {me.points > 0 ? `#${me.place}` : '—'} · {me.points} point{me.points === 1 ? '' : 's'}
            {me.wins > 0 ? ` · ${me.wins} win${me.wins === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
      )}

      <FlatList
        data={top}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Points are awarded by organizers when they rank participants after an event.
            Wins are worth the most.
          </Text>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nobody has points yet. Once organizers start awarding places after their events, the ranking fills up here.
          </Text>
        }
        renderItem={({ item }) => {
          const isMe = item.user_id === uid;
          const m = medal(Number(item.place));
          return (
            <TouchableOpacity
              style={[styles.row, isMe && styles.rowMe, m && styles.rowTop3]}
              onPress={() => router.push(`/user/${item.user_id}`)}
            >
              <View style={styles.placeBox}>
                {m ? <Text style={styles.medal}>{m}</Text> : <Text style={styles.place}>{item.place}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, isMe && { color: colors.brand }]} numberOfLines={1}>
                  {item.full_name}{isMe ? ' · you' : ''}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.university ? `${item.university} · ` : ''}
                  {item.wins > 0 ? `🏆 ${item.wins} win${item.wins === 1 ? '' : 's'}` : 'no wins yet'}
                </Text>
              </View>
              <View style={styles.pointsBox}>
                <Text style={styles.points}>{item.points}</Text>
                <Text style={styles.pointsLabel}>pts</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  meBar: { backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 14 },
  meLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  meValue: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 3 },
  intro: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  rowTop3: { borderColor: '#e8d79a', backgroundColor: '#fffaef' },
  rowMe: { borderColor: colors.brand, borderWidth: 2 },
  placeBox: { width: 38, alignItems: 'center' },
  medal: { fontSize: 22 },
  place: { fontSize: 15, fontWeight: '800', color: colors.muted },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  pointsBox: { alignItems: 'flex-end', minWidth: 46 },
  points: { fontSize: 17, fontWeight: '800', color: colors.brand },
  pointsLabel: { fontSize: 10, color: colors.muted },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, lineHeight: 21, paddingHorizontal: 10 },
});
