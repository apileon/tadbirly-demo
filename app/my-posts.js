import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, CATEGORIES } from '../lib/theme';
import { Card } from '../components/ui';

export default function MyPosts() {
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>You haven't posted anything yet. Use the Post tab to create one.</Text>}
        renderItem={({ item }) => {
          const cat = CATEGORIES[item.kind] ?? CATEGORIES.event;
          const count = item.applications?.[0]?.count ?? 0;
          return (
            <Card onPress={() => router.push(`/applicants/${item.id}`)}>
              <Text style={styles.title}>{cat.emoji} {item.title}</Text>
              <Text style={styles.meta}>{item.location ?? item.city}{item.event_date ? ` · ${item.event_date}` : ''}</Text>
              <Text style={styles.count}>{count} applicant{count === 1 ? '' : 's'} · tap to review →</Text>
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  count: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 10 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
});
