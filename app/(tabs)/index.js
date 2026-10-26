import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl, Modal, Image, ScrollView, Switch, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCachedQuery } from '../../lib/cache';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, radius, type, shadow, layout, EVENT_TYPES, EVENT_TYPE_KEYS, EVENT_LANGUAGES } from '../../lib/theme';
import { getBlockedIds } from '../../lib/moderation';
import { Logo, Wordmark, IconButton, Chip, EmptyState, Button, Segmented } from '../../components/ui';
import { SkeletonList } from '../../components/Skeleton';
import NotifyNudge from '../../components/NotifyNudge';
import { useBadges } from '../../lib/badges';
import { useSavedIds, toggleSaved, scorePost, seedPost } from '../../lib/discover';
import EventCard, { daysUntil, todayInTashkent } from '../../components/EventCard';
import { t, dateLocale } from '../../lib/i18n';

const FIXED = EVENT_TYPE_KEYS.filter((k) => k !== 'Other');
// Feed column width: the app-wide content column (lib/theme layout).
const MAX_W = layout.contentMax;
const iconFor = (key) => EVENT_TYPES.find((x) => x.key === key)?.icon;

const NO_FILTERS = { category: 'all', city: 'all', language: 'all', freeOnly: false, onlineOnly: false, closingSoon: false };

// Event dates are Tashkent calendar days. Taking "today" from UTC kept
// yesterday's events in the feed until 05:00 local time. Tashkent is UTC+5
// all year (no daylight saving), so a fixed offset is exact — and doesn't
// depend on the device's own time zone or Intl support.

export default function Feed() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const uid = session?.user?.id;
  const [mode, setMode] = useState('foryou');          // foryou | upcoming
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  const savedIds = useSavedIds();
  // "For you" ranks with the saved set as it was when the list was built, so
  // tapping a bookmark doesn't reshuffle the whole feed under your finger.
  const savedRef = useRef(savedIds);
  savedRef.current = savedIds;

  // Requests go out at once. Blocked ids come from lib/moderation's shared
  // cache, and the bell count from the badge context — no duplicate queries.
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
    const [postsRes, blockedSet, rankRes] = await Promise.all([
      postsQuery(true).then((res) => (res.error ? postsQuery(false) : res)),
      getBlockedIds().catch(() => new Set()),
      supabase.rpc('my_points'),
    ]);
    return {
      posts: (postsRes.data ?? []).filter((p) => !blockedSet.has(p.author_id)),
      rank: rankRes.data && rankRes.data[0] ? rankRes.data[0] : null,
    };
  }, []);

  // Keyed per user — the payload carries your own rank.
  const { data, loading: first, refreshing, refresh } = useCachedQuery(uid ? `feed:${uid}` : null, fetchFeed);
  const posts = data?.posts ?? [];
  const rank = data?.rank ?? null;
  // The bell reads the shared badge context (one source for every dot).
  const { badges } = useBadges();
  const unread = badges.notifications ?? 0;
  const ranked = !!(rank && rank.points > 0 && rank.place);

  // Cities that actually have events, most common first.
  const cities = useMemo(() => {
    const n = {};
    posts.forEach((p) => { if (p.city) n[p.city] = (n[p.city] ?? 0) + 1; });
    return Object.keys(n).sort((a, b) => n[b] - n[a]);
  }, [posts]);

  const activeCount = Object.keys(NO_FILTERS).filter((k) => filters[k] !== NO_FILTERS[k]).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = posts.filter((p) => {
      if (q && !`${p.title} ${p.description ?? ''} ${p.location ?? ''}`.toLowerCase().includes(q)) return false;
      const f = filters;
      if (f.category !== 'all') {
        if (f.category === 'Other' ? FIXED.includes(p.category) : p.category !== f.category) return false;
      }
      if (f.city !== 'all' && p.city !== f.city) return false;
      if (f.language !== 'all' && p.language !== f.language) return false;
      if (f.freeOnly && p.is_free === false) return false;
      if (f.onlineOnly && !p.is_online) return false;
      if (f.closingSoon) {
        const d = daysUntil(p.deadline);
        if (d === null || d < 0 || d > 7) return false;
      }
      return true;
    });
    if (mode !== 'foryou') return list;
    // Stable: equal scores keep the date order the server gave.
    return list
      .map((p, i) => ({ p, i, s: scorePost(p, profile, savedRef.current) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.p);
  }, [posts, search, filters, mode, profile]);

  // Stable, so memoised cards only re-render when their own props change.
  const openPost = useCallback((p) => { seedPost(p); router.push(`/post/${p.id}`); }, [router]);
  const renderItem = useCallback(({ item }) => (
    <EventCard post={item} saved={savedIds.has(item.id)} onSave={toggleSaved} onPress={openPost} />
  ), [savedIds, openPost]);

  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <Logo size={34} />
            <Wordmark size={21} />
          </View>
          {/* Ranking: your place once you have points, otherwise just the way in. */}
          {ranked ? (
            <TouchableOpacity
              style={styles.rankPill}
              onPress={() => router.push('/leaderboard')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('Ranking')}
            >
              <Ionicons name="trophy" size={14} color={colors.lime} />
              <Text style={styles.rankNum}>{`#${rank.place}`}</Text>
            </TouchableOpacity>
          ) : (
            <IconButton icon="trophy-outline" label={t('Ranking')} onPress={() => router.push('/leaderboard')} />
          )}
          <IconButton icon="bookmark-outline" label={t('Saved events')} onPress={() => router.push('/saved')} />
          <IconButton icon="notifications-outline" label={t('Notifications')} badge={unread} onPress={() => router.push('/notifications')} />
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('Search hackathons, MUNs, internships…')}
            placeholderTextColor={colors.faint}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('Clear search')}>
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </TouchableOpacity>
          ) : null}
        </View>
        {/* For you / Upcoming */}
        <Segmented
          tone="quiet"
          style={{ marginTop: 10 }}
          value={mode}
          onChange={setMode}
          options={[{ key: 'foryou', label: t('For you') }, { key: 'upcoming', label: t('Upcoming') }]}
        />
      </View>

      {/* Filter bar: Filters (opens the sheet) · All · categories, scrolls sideways. */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
          <Chip
            on={activeCount > 0}
            onPress={() => setSheetOpen(true)}
            text={activeCount > 0 ? t('Filters · {n}', { n: activeCount }) : t('Filters')}
            icon="options-outline"
          />
          <Chip on={filters.category === 'all'} onPress={() => setF({ category: 'all' })} text={t('All')} />
          {EVENT_TYPES.map((tp) => (
            <Chip key={tp.key} on={filters.category === tp.key} onPress={() => setF({ category: tp.key })} text={t(tp.key)} icon={tp.icon} />
          ))}
        </ScrollView>
      </View>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        setF={setF}
        cities={cities}
        onReset={() => setFilters(NO_FILTERS)}
        count={visible.length}
      />

      {first ? (
        <View style={styles.inner}><SkeletonList count={3} withImage /></View>
      ) : (
        <FlatList
          data={visible}
          extraData={savedIds}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
          ListHeaderComponent={
            <View>
              <NotifyNudge />
              {mode === 'foryou' && !(profile?.interests?.length) ? (
                <TouchableOpacity style={styles.tipCard} onPress={() => router.push('/onboarding?edit=1')} activeOpacity={0.85}>
                  <Ionicons name="sparkles" size={18} color={colors.brand} />
                  <Text style={styles.tipText}>{t('Pick your interests to get better picks here.')}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.brand} />
                </TouchableOpacity>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            search.trim() ? (
              <EmptyState icon="search-outline" title={t('Nothing matches your search')} text={t('Try a shorter word or a different category.')} action={t('Clear search')} onAction={() => setSearch('')} />
            ) : activeCount === 0 ? (
              <EmptyState icon="calendar-outline" title={t('No open events yet')} text={t("New hackathons, MUNs and internships show up here as soon as they're posted.")} />
            ) : (
              <EmptyState icon={iconFor(filters.category) ?? 'options-outline'} title={t('No events match these filters')} text={t('Check back soon, or browse everything.')} action={t('Clear filters')} onAction={() => setFilters(NO_FILTERS)} />
            )
          }
          ListFooterComponent={profile?.role === 'organizer' ? null : (
            <TouchableOpacity style={styles.suggestRow} onPress={() => router.push('/suggest')} activeOpacity={0.7}>
              <Ionicons name="bulb-outline" size={15} color={colors.muted} />
              <Text style={styles.suggestText}>{t('Know an opportunity? Suggest it')}</Text>
            </TouchableOpacity>
          )}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

function FilterSheet({ open, onClose, filters, setF, cities, onReset, count }) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalWrap} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
          <View style={styles.sheetHead}>
            <Text style={type.h2}>{t('Filters')}</Text>
            <TouchableOpacity onPress={onReset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.reset}>{t('Reset')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetLabel}>{t('Category')}</Text>
            <View style={styles.grid}>
              <Chip on={filters.category === 'all'} onPress={() => setF({ category: 'all' })} text={t('All')} />
              {EVENT_TYPES.map((tp) => (
                <Chip key={tp.key} on={filters.category === tp.key} onPress={() => setF({ category: tp.key })} text={t(tp.key)} icon={tp.icon} />
              ))}
            </View>

            {cities.length > 0 && (
              <>
                <Text style={styles.sheetLabel}>{t('City')}</Text>
                <View style={styles.grid}>
                  <Chip on={filters.city === 'all'} onPress={() => setF({ city: 'all' })} text={t('Anywhere')} />
                  {cities.map((c) => <Chip key={c} on={filters.city === c} onPress={() => setF({ city: c })} text={c} icon="location-outline" />)}
                </View>
              </>
            )}

            <Text style={styles.sheetLabel}>{t('Language')}</Text>
            <View style={styles.grid}>
              <Chip on={filters.language === 'all'} onPress={() => setF({ language: 'all' })} text={t('Any')} />
              {EVENT_LANGUAGES.map((l) => (
                <Chip key={l.key} on={filters.language === l.key} onPress={() => setF({ language: l.key })} text={t(l.label)} />
              ))}
            </View>

            <ToggleRow icon="pricetag-outline" label={t('Free only')} value={filters.freeOnly} onChange={(v) => setF({ freeOnly: v })} />
            <ToggleRow icon="laptop-outline" label={t('Online only')} value={filters.onlineOnly} onChange={(v) => setF({ onlineOnly: v })} />
            <ToggleRow icon="hourglass-outline" label={t('Applications close within a week')} value={filters.closingSoon} onChange={(v) => setF({ closingSoon: v })} />
          </ScrollView>
          <Button title={t('Show {n} events', { n: count })} onPress={onClose} style={{ marginTop: 16 }} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function ToggleRow({ icon, label, value, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <Text style={styles.toggleText}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.lineStrong, true: colors.brand }}
        thumbColor="#fff"
        activeThumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.ink },
  rankNum: { color: colors.bg, fontSize: 13.5, fontWeight: '800' },
  search: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.ink, height: '100%', outlineStyle: 'none' },
  inner: { width: '100%', maxWidth: MAX_W, alignSelf: 'center', padding: 16 },
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: MAX_W, alignSelf: 'center' },
  filterBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  tipText: { flex: 1, fontSize: 13.5, color: colors.brand, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 20, maxWidth: 520, width: '100%', alignSelf: 'center', ...shadow.lg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  reset: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  sheetLabel: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, marginTop: 6, borderTopWidth: 1, borderTopColor: colors.line },
  toggleText: { flex: 1, fontSize: 14.5, color: colors.ink, fontWeight: '500' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  suggestText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
});
