import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, column, CATEGORIES } from '../lib/theme';
import { Card, EmptyState } from '../components/ui';
import { formatEventWhen } from '../lib/events';
import { t } from '../lib/i18n';

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
        contentContainerStyle={{ padding: 16, ...column }}
        ListEmptyComponent={<EmptyState icon="calendar-outline" title={t('No events yet')} text={t('Use the Post event tab to create one.')} />}
        renderItem={({ item }) => {
          const cat = CATEGORIES[item.kind] ?? CATEGORIES.event;
          const count = item.applications?.[0]?.count ?? 0;
          return (
            <Card onPress={() => router.push(`/applicants/${item.id}`)}>
              <Text style={styles.title}>{cat.emoji} {item.title}</Text>
              <Text style={styles.meta}>{item.location ?? item.city}{item.event_date ? ` · ${formatEventWhen(item.event_date)}` : ''}</Text>
              <Text style={styles.count}>{count === 1 ? t('1 applicant') : t('{n} applicants', { n: count })} · {t('Review applicants')} →</Text>
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
