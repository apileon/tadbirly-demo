import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, CATEGORIES } from '../lib/theme';
import { Card } from '../components/ui';

export default function MyApplications() {
  const { session } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('applications')
      .select('*, post:posts(id, title, kind, location, city, event_date)')
      .eq('applicant_id', session.user.id)
      .order('created_at', { ascending: false });
    setRows(data ?? []);
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.legend}>
        <Text style={styles.legendText}>🟡 Pending · 🟢 Accepted · 🔴 Not selected</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>Nothing yet — apply to something from the feed and it appears here.</Text>}
        renderItem={({ item }) => {
          const p = item.post ?? {};
          const cat = CATEGORIES[p.kind] ?? CATEGORIES.event;
          return (
            <Card onPress={() => p.id && router.push(`/post/${p.id}`)}>
              <View style={styles.rowTop}>
                <Text style={styles.title}>{cat.emoji} {p.title ?? 'Post'}</Text>
                <StatusPill status={item.status} />
              </View>
              <Text style={styles.meta}>{p.location ?? p.city}{p.event_date ? ` · ${p.event_date}` : ''}</Text>
            </Card>
          );
        }}
      />
    </View>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { t: '🟡 Pending', c: colors.warn, b: colors.warnSoft },
    accepted: { t: '🟢 Accepted', c: colors.accent, b: colors.accentSoft },
    rejected: { t: '🔴 Not selected', c: colors.danger, b: '#fdecec' },
  };
  const s = map[status] ?? map.pending;
  return <Text style={[styles.pill, { color: s.c, backgroundColor: s.b }]}>{s.t}</Text>;
}

const styles = StyleSheet.create({
  legend: { backgroundColor: colors.card, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  legendText: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink, flex: 1 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 6 },
  pill: { fontSize: 11, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
});
