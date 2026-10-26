import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Linking } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, column } from '../../lib/theme';
import { Button, EmptyState } from '../../components/ui';
import { notify, confirmAsync } from '../../lib/notify';
import { formatEventWhen } from '../../lib/events';
import { pendingSubmissions, markReviewed, submissionParams } from '../../lib/opportunities';
import { t } from '../../lib/i18n';

// Admins: students' suggestions → "Create event" (the normal create form,
// prefilled; publishing marks the suggestion approved) or "Reject".
export default function ReviewSubmissions() {
  const router = useRouter();
  const { profile } = useAuth();
  const isAdmin = profile?.is_admin === true;
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await pendingSubmissions();
    if (error) notify(t('Could not load'), error.message);
    setItems(data);
  }, []);

  // Reload when coming back from the create screen.
  useFocusEffect(useCallback(() => { if (isAdmin) load(); }, [isAdmin, load]));

  async function reject(s) {
    if (!(await confirmAsync(t('Reject this suggestion?'), s.title, t('Reject')))) return;
    setBusy(s.id);
    const { error } = await markReviewed(s.id, 'rejected');
    setBusy(null);
    if (error) return notify(t('Could not update'), error.message);
    setItems((list) => (list ?? []).filter((x) => x.id !== s.id));
  }

  if (!isAdmin) return <EmptyState icon="lock-closed-outline" title={t('Admins only')} />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.list}
      data={items ?? []}
      keyExtractor={(s) => s.id}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListEmptyComponent={items ? <EmptyState icon="checkmark-done-outline" title={t('No suggestions to review')} /> : null}
      renderItem={({ item: s }) => (
        <View style={styles.card}>
          <Text style={type.title}>{s.title}</Text>
          <Text style={styles.meta}>
            {[s.submitter?.full_name, s.event_date ? formatEventWhen(s.event_date) : null].filter(Boolean).join(' · ')}
          </Text>
          {/^https?:\/\//i.test(s.url ?? '') ? <Text style={styles.link} numberOfLines={1} onPress={() => Linking.openURL(s.url).catch(() => {})}>{s.url}</Text> : null}
          {s.details ? <Text style={styles.details} numberOfLines={6}>{s.details}</Text> : null}
          <View style={styles.actions}>
            <Button title={t('Create event')} icon="add" size="sm" style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/create', params: submissionParams(s) })} />
            <Button title={t('Reject')} variant="ghost" size="sm" loading={busy === s.id} onPress={() => reject(s)} />
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, ...column },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 12 },
  meta: { ...type.small, marginTop: 2 },
  link: { color: colors.brand, fontSize: 13.5, fontWeight: '600', marginTop: 8 },
  details: { ...type.body, fontSize: 14, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
