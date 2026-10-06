import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow, CATEGORIES, typeMeta } from '../../lib/theme';
import { EmptyState } from '../../components/ui';
import { t } from '../../lib/i18n';

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
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.heading}>{t('My events')}</Text>}
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title={t('No events yet')}
            text={t('Use the Post event tab to create one.')}
          />
        }
        renderItem={({ item }) => {
          const cat = CATEGORIES[item.kind] ?? CATEGORIES.event;
          const tm = typeMeta(item.category);
          const count = item.applications?.[0]?.count ?? 0;
          const done = item.status === 'completed';
          const where = item.location ?? item.city;
          return (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => router.push(`/post/${item.id}`)}
              style={[styles.card, done && { opacity: 0.85 }]}
            >
              <View style={styles.head}>
                <View style={[styles.typeIcon, { backgroundColor: cat.soft }]}>
                  <Ionicons name={tm.icon} size={18} color={cat.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  {where || item.event_date ? (
                    <Text style={styles.meta} numberOfLines={1}>{where}{item.event_date ? `${where ? ' · ' : ''}${item.event_date}` : ''}</Text>
                  ) : null}
                </View>
                {done && (
                  <View style={styles.finished}>
                    <Ionicons name="flag-outline" size={11} color={colors.danger} />
                    <Text style={styles.finishedText}>{t('Finished')}</Text>
                  </View>
                )}
              </View>
              <View style={styles.foot}>
                <Ionicons name="people-outline" size={15} color={colors.brand} />
                <Text style={styles.count}>
                  {count === 1 ? t('1 applicant') : t('{n} applicants', { n: count })}
                </Text>
                <Text style={styles.review}>{t('Review and award')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.brand} />
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  heading: { ...type.h1, paddingTop: 2, marginBottom: 14 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 12, ...shadow.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  typeIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.title, fontSize: 15.5 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 3 },
  finished: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.dangerSoft, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill },
  finishedText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  count: { fontSize: 13, color: colors.ink, fontWeight: '700', flex: 1 },
  review: { fontSize: 13, color: colors.brand, fontWeight: '700' },
});
