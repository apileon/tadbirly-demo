import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonList } from '../components/Skeleton';
import { useRouter, useFocusEffect, useSegments } from 'expo-router';
import { colors, radius, type } from '../lib/theme';
import { listNotifications, markRead, markAllRead, clearAll } from '../lib/notifications';
import { timeAgo } from '../lib/news';
import { confirmAsync, notify } from '../lib/notify';
import { openLink, notificationLink } from '../lib/links';
import { useBadges } from '../lib/badges';
import { EmptyState } from '../components/ui';
import { t } from '../lib/i18n';

// Ionicons per notification type (lib/notifications' ICONS holds emoji).
const TYPE_ICONS = {
  message: { icon: 'chatbubbles-outline', tone: 'brand' },
  friend_request: { icon: 'person-add-outline', tone: 'brand' },
  friend_accepted: { icon: 'people-outline', tone: 'brand' },
  new_application: { icon: 'document-text-outline', tone: 'brand' },
  accepted: { icon: 'checkmark-circle', tone: 'brand' },
  rejected: { icon: 'close-circle-outline', tone: 'danger' },
  team_invite: { icon: 'people-outline', tone: 'brand' },
  team_request: { icon: 'people-outline', tone: 'brand' },
  team_joined: { icon: 'people-outline', tone: 'brand' },
  team_approved: { icon: 'checkmark-circle', tone: 'brand' },
  team_rejected: { icon: 'close-circle-outline', tone: 'danger' },
  team_application: { icon: 'people-outline', tone: 'brand' },
  team_accepted: { icon: 'checkmark-circle', tone: 'brand' },
  award: { icon: 'medal-outline', tone: 'warn' },
  reminder: { icon: 'alarm-outline', tone: 'warn' },
};
const TONES = {
  brand: { fg: colors.brand, bg: colors.brandSoft },
  warn: { fg: colors.warn, bg: colors.warnSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};

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
    if (!(await confirmAsync(t('Clear all notifications?'), t('This removes them from your list.'), t('Clear')))) return;
    setRows([]);
    const { error } = await clearAll();
    if (error) { notify(t('Could not clear'), error.message); load(); }
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
          <View style={styles.barInner}>
            <Text style={styles.barText}>
              {unread > 0 ? t('{n} unread', { n: unread }) : t('All caught up')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {unread > 0 && (
                <TouchableOpacity onPress={readAll} style={styles.barBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="checkmark-done-outline" size={15} color={colors.brand} />
                  <Text style={styles.barBtnText}>{t('Mark all read')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={wipe} style={styles.barBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={15} color={colors.danger} />
                <Text style={[styles.barBtnText, { color: colors.danger }]}>{t('Clear')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-outline"
            title={t('No notifications yet')}
            text={t("You'll see it here when someone adds you as a friend, when you're accepted to an event, invited to a team, or given an award.")}
          />
        }
        renderItem={({ item }) => {
          const meta = TYPE_ICONS[item.type] ?? { icon: 'notifications-outline', tone: 'brand' };
          const tone = TONES[meta.tone];
          return (
            <TouchableOpacity style={[styles.row, !item.read_at && styles.unread]} onPress={() => open(item)} activeOpacity={0.85}>
              <View style={[styles.icon, { backgroundColor: !item.read_at && meta.tone === 'brand' ? colors.card : tone.bg }]}>
                <Ionicons name={meta.icon} size={18} color={tone.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, !item.read_at && { fontWeight: '800' }]}>{item.title}</Text>
                {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>
              {!item.read_at && <View style={styles.dot} />}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  barInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 11, width: '100%', maxWidth: 680, alignSelf: 'center' },
  barText: { ...type.label, color: colors.muted },
  barBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  barBtnText: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  unread: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14.5, color: colors.ink, fontWeight: '700', lineHeight: 20 },
  body: { fontSize: 13, color: colors.body, marginTop: 3, lineHeight: 18 },
  time: { fontSize: 11.5, color: colors.muted, marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand, marginTop: 6 },
});
