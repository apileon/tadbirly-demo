import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SkeletonList } from '../components/Skeleton';
import { useRouter, useFocusEffect, useSegments } from 'expo-router';
import { colors, radius } from '../lib/theme';
import { listNotifications, markRead, markAllRead, clearAll, ICONS } from '../lib/notifications';
import { timeAgo } from '../lib/news';
import { confirmAsync, notify } from '../lib/notify';
import { openLink, notificationLink } from '../lib/links';
import { useBadges } from '../lib/badges';

export default function Notifications() {
  const router = useRouter();
  const segments = useSegments();
  const { refreshBadges } = useBadges();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setRows(await listNotifications());
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function open(n) {
    if (!n.read_at) {
      setRows((prev) => prev.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)));
      markRead(n.id);
    }
    // Tab links (Portal, Social…) go back to the tab bar that's already
    // underneath instead of stacking a second one on top of this screen.
    openLink(router, notificationLink(n), segments);
  }

  async function readAll() {
    setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })));
    await markAllRead();
  }

  async function wipe() {
    if (!(await confirmAsync('Clear all notifications?', 'This removes them from your list.', 'Clear'))) return;
    setRows([]);
    const { error } = await clearAll();
    if (error) { notify('Could not clear', error.message); load(); }
    // Deleted rows can't reach the badge listener (it filters on user_id and
    // a delete only carries the row's id), so update the bell count ourselves.
    else refreshBadges();
  }

  if (loading) return <SkeletonList count={5} type="row" />;

  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {rows.length > 0 && (
        <View style={styles.bar}>
          <Text style={styles.barText}>
            {unread > 0 ? `${unread} unread` : 'All caught up'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {unread > 0 && (
              <TouchableOpacity onPress={readAll}><Text style={styles.barBtn}>Mark all read</Text></TouchableOpacity>
            )}
            <TouchableOpacity onPress={wipe}><Text style={[styles.barBtn, { color: colors.danger }]}>Clear</Text></TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No notifications yet. You'll be told here when someone adds you as a friend, when you're
            accepted to an event, invited to a team, or given an award.
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, !item.read_at && styles.unread]} onPress={() => open(item)}>
            <Text style={styles.icon}>{ICONS[item.type] ?? '🔔'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, !item.read_at && { fontWeight: '800' }]}>{item.title}</Text>
              {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
            {!item.read_at && <View style={styles.dot} />}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  barText: { fontSize: 13, color: colors.muted, fontWeight: '700' },
  barBtn: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  unread: { borderColor: colors.brand, backgroundColor: '#f6faf3' },
  icon: { fontSize: 20, marginTop: 1 },
  title: { fontSize: 14.5, color: colors.ink, fontWeight: '700', lineHeight: 20 },
  body: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
  time: { fontSize: 11.5, color: colors.muted, marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand, marginTop: 6 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 50, lineHeight: 21, paddingHorizontal: 12 },
});
