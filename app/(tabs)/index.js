import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl, Modal, Image, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCachedQuery } from '../../lib/cache';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, radius, CATEGORIES, EVENT_TYPES, EVENT_TYPE_KEYS, typeMeta } from '../../lib/theme';
import { unreadCount } from '../../lib/notifications';
import { Logo } from '../../components/ui';
import { SkeletonList } from '../../components/Skeleton';
import NotifyNudge from '../../components/NotifyNudge';
import { useBadges } from '../../lib/badges';
import { formatStartTime } from '../../lib/events';

// Quick chips shown inline; everything else lives behind the Filter button.
const QUICK = ['MUN', 'Hackathon'];
const FIXED = EVENT_TYPE_KEYS.filter((k) => k !== 'Other');
// Feed column width. On a phone it fills the screen; on a laptop it stays a
// narrow column in the middle instead of stretching across the monitor.
const MAX_W = 460;
const label = (key) => { const t = EVENT_TYPES.find((x) => x.key === key); return t ? `${t.emoji} ${t.key}` : key; };

// Event dates are Tashkent calendar days. Taking "today" from UTC kept
// yesterday's events in the feed until 05:00 local time. Tashkent is UTC+5
// all year (no daylight saving), so a fixed offset is exact — and doesn't
// depend on the device's own time zone or Intl support.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const todayInTashkent = () => new Date(Date.now() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);

export default function Feed() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [filter, setFilter] = useState('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  // All four requests go out at once instead of one after another.
  const fetchFeed = useCallback(async () => {
    const today = todayInTashkent();
    // Same day: earlier start first, events without a time after the timed
    // ones. If the database doesn't know start_time yet (25_reminders.sql not
    // run), ask again without it — an empty feed is far worse than same-day
    // events in posting order.
    const postsQuery = (byStartTime) => {
      let q = supabase
        .from('posts')
        .select('*, author:profiles!posts_author_id_fkey(full_name, reliability)')
        .eq('status', 'open')
        .or(`event_date.is.null,event_date.gte.${today}`)
        .order('boosted', { ascending: false })
        .order('event_date', { ascending: true, nullsFirst: false });
      if (byStartTime) q = q.order('start_time', { ascending: true, nullsFirst: false });
      return q.order('created_at', { ascending: false });
    };
    const [postsRes, blockedRes, rankRes, unread] = await Promise.all([
      postsQuery(true).then((res) => (res.error ? postsQuery(false) : res)),
      supabase.from('blocks').select('blocked_id'),
      supabase.rpc('my_points'),
      unreadCount(),
    ]);
    const blockedSet = new Set((blockedRes.data ?? []).map((b) => b.blocked_id));
    return {
      posts: (postsRes.data ?? []).filter((p) => !blockedSet.has(p.author_id)),
      rank: rankRes.data && rankRes.data[0] ? rankRes.data[0] : null,
      unread,
    };
  }, []);

  // Keyed per user — the payload carries your own rank and unread count.
  const { data, loading: first, refreshing, refresh } = useCachedQuery(uid ? `feed:${uid}` : null, fetchFeed);
  const posts = data?.posts ?? [];
  const rank = data?.rank ?? null;
  // Live count from the shared badge context once it has loaded; the cached
  // payload only covers first paint, so the bell isn't briefly empty. (With
  // `||`, a live 0 fell through to the cached number — read notifications
  // kept a stale badge on the bell.)
  const { badges } = useBadges();
  const unread = badges.loaded ? badges.notifications : (data?.unread ?? 0);

  const visible = posts.filter((p) => {
    if (search.trim() && !p.title?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'Other') return !FIXED.includes(p.category);
    return p.category === filter;
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <Logo size={40} />
            <View>
              <Text style={styles.logo}>Tadbir<Text style={{ color: colors.brand }}>ly</Text></Text>
              <Text style={styles.city}>The next move is yours</Text>
            </View>
          </View>
          {/* Notifications */}
          <TouchableOpacity style={styles.bell} onPress={() => router.push('/notifications')} activeOpacity={0.85}>
            <Text style={{ fontSize: 19 }}>🔔</Text>
            {unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          {/* Ranking — square badge, top right */}
          <TouchableOpacity style={styles.rankBox} onPress={() => router.push('/leaderboard')} activeOpacity={0.85}>
            <Text style={styles.rankTrophy}>🏆</Text>
            <Text style={styles.rankNum}>{rank && rank.points > 0 ? `#${rank.place}` : '—'}</Text>
            <Text style={styles.rankPts}>{rank ? `${rank.points} pts` : 'ranking'}</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search events…"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Compact filter bar: All · 2 quick picks · Filter ▾ */}
      <View style={styles.filterBar}>
        <Chip on={filter === 'all'} onPress={() => setFilter('all')} text="All" />
        {QUICK.map((k) => <Chip key={k} on={filter === k} onPress={() => setFilter(k)} text={label(k)} />)}
        {filter !== 'all' && !QUICK.includes(filter) ? (
          <Chip on onPress={() => setFilter('all')} text={`${label(filter)}  ✕`} />
        ) : (
          <TouchableOpacity onPress={() => setPickerOpen(true)} style={[styles.chip, styles.filterBtn]}>
            <Text style={[styles.chipText, { color: colors.brand }]}>⚙ Filter ▾</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.modalWrap} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filter by category</Text>
            <View style={styles.grid}>
              <Chip on={filter === 'all'} onPress={() => { setFilter('all'); setPickerOpen(false); }} text="All" />
              {EVENT_TYPES.map((t) => (
                <Chip key={t.key} on={filter === t.key} onPress={() => { setFilter(t.key); setPickerOpen(false); }} text={`${t.emoji} ${t.key}`} />
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {first ? (
        <View style={styles.inner}><SkeletonList count={3} withImage /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, width: '100%', maxWidth: MAX_W, alignSelf: 'flex-start' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
          ListHeaderComponent={<NotifyNudge />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {filter === 'all' ? 'No open events yet. Check back soon!' : `No ${filter} events right now.`}
            </Text>
          }
          renderItem={({ item }) => <PostCard post={item} onPress={() => router.push(`/post/${item.id}`)} />}
        />
      )}
    </SafeAreaView>
  );
}

function Chip({ on, onPress, text }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{text}</Text>
    </TouchableOpacity>
  );
}

const dayLabel = (d) => {
  if (!d) return null;
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return d;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((date - today) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return `In ${days} days`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// Reads a remote image's real shape so portrait posters aren't squashed
// into a thin strip. Clamped like Instagram: never taller than 4:5.
function useImageRatio(uri) {
  const [ratio, setRatio] = useState(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    Image.getSize(uri, (w, h) => { if (alive && h) setRatio(w / h); }, () => {});
    return () => { alive = false; };
  }, [uri]);
  return ratio;
}

function PostCard({ post, onPress }) {
  const cat = CATEGORIES[post.kind] ?? CATEGORIES.event;
  const t = typeMeta(post.category);
  const day = dayLabel(post.event_date);
  const soon = day === 'Today' || day === 'Tomorrow';
  // "Today · 15:00" — the date pill carries the start time too, when there is one.
  const time = formatStartTime(post.start_time);
  const when = day && time ? `${day} · ${time}` : day;
  const ratio = useImageRatio(post.cover_url);
  const { width: winW } = useWindowDimensions();
  const wide = winW >= 700; // laptop/desktop
  // Phones can afford a tall 4:5 preview; on a laptop that's a wall of image,
  // so portrait posters are cropped to a shorter card there.
  const shown = ratio ? Math.min(Math.max(ratio, wide ? 1.25 : 0.8), 1.91) : 1.6;

  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={styles.card}>
      {post.cover_url ? (
        <View>
          <Image source={{ uri: post.cover_url }} style={[styles.cover, { aspectRatio: shown }]} resizeMode="cover" />
          <View style={styles.coverTag}>
            <Text style={styles.coverTagText}>{t.emoji} {t.key}</Text>
          </View>
          {when && (
            <View style={[styles.datePill, soon && { backgroundColor: colors.warn }]}>
              <Text style={styles.datePillText}>{when}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.coverFallback, { backgroundColor: cat.color }]}>
          <Text style={styles.coverEmoji}>{t.emoji}</Text>
          <View style={styles.coverTag}>
            <Text style={styles.coverTagText}>{t.key}</Text>
          </View>
          {when && (
            <View style={[styles.datePill, soon && { backgroundColor: colors.warn }]}>
              <Text style={styles.datePillText}>{when}</Text>
            </View>
          )}
        </View>
      )}

      <View style={{ padding: 14 }}>
        <Text style={styles.title} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          📍 {post.location ?? post.city}
          {post.team_mode === 'team' ? '  ·  🧩 Teams' : ''}
        </Text>
        <View style={styles.row}>
          <Text style={styles.author} numberOfLines={1}>by {post.author?.full_name ?? 'Organizer'}</Text>
          {post.boosted && <Text style={styles.boost}>⚡</Text>}
          {typeof post.spots === 'number' && <Text style={styles.spots}>{post.spots} spots</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.card, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  brandLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  logo: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  city: { fontSize: 11, color: colors.muted, marginTop: 1, letterSpacing: 0.3 },
  rankBox: { width: 68, height: 68, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  bell: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: colors.card },
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  rankTrophy: { fontSize: 17 },
  rankNum: { color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 1 },
  rankPts: { color: 'rgba(255,255,255,0.8)', fontSize: 9.5, fontWeight: '600' },
  search: { marginTop: 12, backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 16, fontSize: 14, color: colors.ink },
  inner: { width: '100%', maxWidth: MAX_W, alignSelf: 'flex-start' },
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  filterBtn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12.5, color: colors.muted, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cover: { width: '100%', backgroundColor: colors.line, maxHeight: 560 },
  coverFallback: { width: '100%', height: 110, alignItems: 'center', justifyContent: 'center' },
  coverEmoji: { fontSize: 42, opacity: 0.9 },
  coverTag: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  coverTagText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  datePill: { position: 'absolute', top: 10, right: 10, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  datePillText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink, lineHeight: 21 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 5, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8 },
  author: { fontSize: 12, color: colors.muted, flex: 1 },
  spots: { fontSize: 12, color: colors.brand, fontWeight: '700' },
  boost: { fontSize: 12, color: colors.warn, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, fontSize: 14, lineHeight: 22, paddingHorizontal: 20 },
});
