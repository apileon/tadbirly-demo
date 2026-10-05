import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, CATEGORIES } from '../../lib/theme';
import { Card } from '../../components/ui';

export default function MyEvents() {
  const { session } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('posts')
      .select('*, applications(count)')
      .eq('author_id', session.user.id)
      .order('created_at', { ascending: false });
    setRows(data ?? []);
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Text style={styles.h1}>🎪 My events</Text>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No events yet. Use the Post event tab to create one.</Text>}
        renderItem={({ item }) => {
          const cat = CATEGORIES[item.kind] ?? CATEGORIES.event;
          const count = item.applications?.[0]?.count ?? 0;
          const done = item.status === 'completed';
          return (
            <Card onPress={() => router.push(`/post/${item.id}`)} style={done ? { opacity: 0.85 } : null}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.title, { flex: 1 }]}>{cat.emoji} {item.title}</Text>
                {done && <Text style={styles.finished}>🏁 FINISHED</Text>}
              </View>
              <Text style={styles.meta}>{item.location ?? item.city}{item.event_date ? ` · ${item.event_date}` : ''}</Text>
              <Text style={styles.count}>{count} applicant{count === 1 ? '' : 's'} · review & award →</Text>
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink, paddingHorizontal: 18, paddingTop: 6 },
  title: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  count: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 10 },
  finished: { fontSize: 10.5, fontWeight: '900', color: '#fff', backgroundColor: colors.danger, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden', marginLeft: 8, letterSpacing: 0.5 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
});
