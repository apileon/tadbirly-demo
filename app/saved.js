import React, { useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { EmptyState, SectionHeader } from '../components/ui';
import EventCard, { daysUntil } from '../components/EventCard';
import { useSavedIds, toggleSaved, loadSaved } from '../lib/discover';
import { t } from '../lib/i18n';

// Bookmarked events: upcoming first, then the ones that have passed.
export default function Saved() {
  const router = useRouter();
  const savedIds = useSavedIds();
  const [posts, setPosts] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const ids = [...(await loadSaved(true))];
    if (!ids.length) { setPosts([]); return; }
    const { data } = await supabase
      .from('posts')
      .select('*, author:profiles!posts_author_id_fkey(full_name, reliability)')
      .in('id', ids);
    setPosts(data ?? []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (posts === null) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  // Unsaving keeps the card until the screen is opened again, so a mis-tap
  // can be undone right there.
  const sorted = [...posts].sort((a, b) => String(a.event_date ?? '9999').localeCompare(String(b.event_date ?? '9999')));
  const upcoming = sorted.filter((p) => p.status !== 'completed' && (daysUntil(p.event_date) ?? 0) >= 0);
  const past = sorted.filter((p) => !upcoming.includes(p));
  const rows = [
    ...upcoming.map((p) => ({ p })),
    ...(past.length ? [{ header: t('Past events') }] : []),
    ...past.map((p) => ({ p })),
  ];

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows}
      keyExtractor={(r, i) => r.p?.id ?? `h${i}`}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />}
      ListEmptyComponent={
        <EmptyState
          icon="bookmark-outline"
          title={t('No saved events yet')}
          text={t("Tap the bookmark on any event to keep it here. We'll remind you the day before its deadline.")}
          action={t('Browse events')}
          onAction={() => router.dismissTo('/')}
        />
      }
      renderItem={({ item }) => item.header ? (
        <SectionHeader title={item.header} />
      ) : (
        <View style={item.p.status === 'completed' || (daysUntil(item.p.event_date) ?? 0) < 0 ? { opacity: 0.6 } : null}>
          <EventCard
            post={item.p}
            saved={savedIds.has(item.p.id)}
            onSave={() => toggleSaved(item.p.id)}
            onPress={() => router.push(`/post/${item.p.id}`)}
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 520, alignSelf: 'center' },
});
