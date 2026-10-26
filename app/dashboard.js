import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, radius, type, shadow, column } from '../lib/theme';
import { EmptyState, SectionHeader, Button } from '../components/ui';
import Stars from '../components/Stars';
import { t, dateLocale } from '../lib/i18n';

// A function the database doesn't have yet (migration not run).
const missingFunction = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883');

// Organizer stats: how each event does from views to people at the door.
// '/dashboard?post=<id>' shows one event (opened from that event's page).
export default function Dashboard() {
  const router = useRouter();
  const { post: onlyPost } = useLocalSearchParams();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('organizer_event_stats');
    // Never show the raw database message: say what it means for them.
    setError(e ? (missingFunction(e) ? 'missing' : 'failed') : null);
    setRows(data ?? []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (rows === null) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (error === 'missing') return <EmptyState icon="stats-chart-outline" title={t('Stats are not switched on yet')} text={t('They appear here as soon as they are turned on for your account.')} />;
  if (error) return <EmptyState icon="cloud-offline-outline" title={t('Could not load')} text={t('Please check your connection and try again.')} action={t('Try again')} onAction={load} />;
  if (!rows.length) return <EmptyState icon="stats-chart-outline" title={t('No events yet')} text={t('Post an event and its numbers show up here.')} />;

  const filtered = onlyPost ? rows.filter((r) => String(r.post_id) === String(onlyPost)) : [];
  const single = filtered.length > 0;
  const shown = single ? filtered : rows;
  const sum = (k) => shown.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const rated = shown.filter((r) => r.rating != null);
  const avgRating = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />}
    >
      {single ? (
        <View style={styles.singleHead}>
          <Text style={styles.singleTitle} numberOfLines={2}>{filtered[0].title}</Text>
          <Button title={t('All stats')} icon="stats-chart-outline" variant="ghost" size="sm" onPress={() => router.setParams({ post: undefined })} />
        </View>
      ) : null}
      <View style={styles.kpis}>
        <Kpi icon="eye-outline" value={sum('views')} label={t('Views')} />
        <Kpi icon="document-text-outline" value={sum('applied')} label={t('Applications')} />
        <Kpi icon="checkmark-done-outline" value={sum('accepted')} label={t('Accepted')} />
        <Kpi icon="enter-outline" value={sum('checked_in')} label={t('Came')} />
      </View>
      {avgRating != null && (
        <View style={styles.ratingCard}>
          <Text style={styles.ratingNum}>{avgRating.toFixed(1)}</Text>
          <View style={{ flex: 1 }}>
            <Stars value={avgRating} size={16} />
            <Text style={type.small}>{t('Average rating across {n} reviews', { n: sum('reviews') })}</Text>
          </View>
        </View>
      )}

      <SectionHeader title={single ? t('Funnel') : t('By event')} />
      {shown.map((r) => {
        const max = Math.max(Number(r.views) || 0, Number(r.applied) || 0, 1);
        const conv = r.views > 0 ? Math.round((Number(r.applied) / Number(r.views)) * 100) : null;
        return (
          <TouchableOpacity key={r.post_id} style={styles.card} activeOpacity={0.9} onPress={() => router.push(`/post/${r.post_id}`)}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{r.title}</Text>
                <Text style={styles.meta}>
                  {r.event_date ? new Date(`${r.event_date}T00:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : t('No date')}
                  {r.status === 'completed' ? ` · ${t('Finished')}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </View>
            <Bar label={t('Views')} value={r.views} max={max} />
            <Bar label={t('Applied')} value={r.applied} max={max} />
            <Bar label={t('Accepted')} value={r.accepted} max={max} />
            <Bar label={t('Came')} value={r.checked_in} max={max} />
            <View style={styles.foot}>
              <Mini icon="bookmark-outline" text={t('{n} saved', { n: r.saves })} />
              {conv != null ? <Mini icon="trending-up-outline" text={t('{n}% applied after viewing', { n: conv })} /> : null}
              {r.rating != null ? <Mini icon="star" text={`${Number(r.rating).toFixed(1)} (${r.reviews})`} /> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function Kpi({ icon, value, label }) {
  return (
    <View style={styles.kpi}>
      <Ionicons name={icon} size={16} color={colors.brand} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Bar({ label, value, max }) {
  const v = Number(value) || 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max((v / max) * 100, v ? 3 : 0)}%` }]} />
      </View>
      <Text style={styles.barValue}>{v}</Text>
    </View>
  );
}

function Mini({ icon, text }) {
  return (
    <View style={styles.mini}>
      <Ionicons name={icon} size={12} color={colors.muted} />
      <Text style={styles.miniText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, ...column },
  singleHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  singleTitle: { ...type.h2, flex: 1 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, gap: 4, ...shadow.sm },
  kpiValue: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  kpiLabel: { fontSize: 11.5, color: colors.muted, fontWeight: '600' },
  ratingCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginTop: 10 },
  ratingNum: { fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -1 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 12, ...shadow.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { ...type.title, fontSize: 15.5 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  barLabel: { width: 74, fontSize: 12.5, color: colors.body },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.brand },
  barValue: { width: 36, textAlign: 'right', fontSize: 12.5, fontWeight: '700', color: colors.ink },
  foot: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
});
