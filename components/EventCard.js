import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type, shadow, CATEGORIES, typeMeta } from '../lib/theme';
import { formatStartTime } from '../lib/events';
import { t, dateLocale } from '../lib/i18n';
import { useFriendsGoing, friendsGoingText } from '../lib/discover';
import { Avatar } from './ui';

// The event card used by the feed and the Saved list.

// Event dates are Tashkent calendar days. Taking "today" from UTC kept
// yesterday's events in the feed until 05:00 local time. Tashkent is UTC+5
// all year (no daylight saving), so a fixed offset is exact — and doesn't
// depend on the device's own time zone or Intl support.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
export const todayInTashkent = () => new Date(Date.now() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
export const daysUntil = (d) => (d ? Math.round((new Date(`${d}T00:00:00`) - new Date(`${todayInTashkent()}T00:00:00`)) / 86400000) : null);

const dayLabel = (d) => {
  if (!d) return null;
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return d;
  const days = daysUntil(d);
  if (days === 0) return t('Today');
  if (days === 1) return t('Tomorrow');
  if (days > 1 && days < 7) return t('In {n} days', { n: days });
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
};

// Covers get one fixed 16:10 frame (cropped to fill), decided by design
// rather than by measuring each image: measuring made every card jump in
// height once its picture arrived. The event page shows the whole poster.
const COVER_RATIO = 1.6;

// onPress(post) and onSave(postId): pass stable functions so a bookmark tap
// re-renders only the card it changed (the card is memoised).
function EventCard({ post, onPress, saved, onSave }) {
  const cat = CATEGORIES[post.kind] ?? CATEGORIES.event;
  const tm = typeMeta(post.category);
  const day = dayLabel(post.event_date);
  const soon = daysUntil(post.event_date) !== null && daysUntil(post.event_date) <= 1;
  // "Today · 15:00" — the date carries the start time too, when there is one.
  const time = formatStartTime(post.start_time);
  const when = day && time ? `${day} · ${time}` : day;
  const deadlineIn = daysUntil(post.deadline);
  const where = post.is_online ? t('Online') : (post.location ?? post.city);

  const bookmark = (
    <TouchableOpacity
      onPress={() => onSave?.(post.id)}
      style={styles.saveBtn}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={saved ? t('Remove from saved') : t('Save event')}
    >
      <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={17} color="#fff" />
    </TouchableOpacity>
  );

  return (
    <TouchableOpacity activeOpacity={0.92} onPress={() => onPress?.(post)} style={styles.card}>
      {post.cover_url ? (
        <View>
          <Image source={{ uri: post.cover_url }} style={styles.cover} resizeMode="cover" />
          <View style={styles.coverTag}>
            <Ionicons name={tm.icon} size={12} color="#fff" />
            <Text style={styles.coverTagText}>{t(tm.key)}</Text>
          </View>
          {bookmark}
        </View>
      ) : (
        <View style={[styles.coverFallback, { backgroundColor: cat.color }]}>
          <Ionicons name={tm.icon} size={34} color="rgba(255,255,255,0.92)" />
          <View style={styles.coverTag}>
            <Text style={styles.coverTagText}>{t(tm.key)}</Text>
          </View>
          {bookmark}
        </View>
      )}

      <View style={{ padding: 14, paddingTop: 12 }}>
        {when || post.boosted ? (
          <View style={styles.whenRow}>
            {when ? (
              <>
                <Ionicons name="calendar-clear-outline" size={13} color={soon ? colors.warn : colors.brand} />
                <Text style={[styles.when, soon && { color: colors.warn }]}>{when}</Text>
              </>
            ) : null}
            {post.boosted && (
              <View style={styles.featured}>
                <Ionicons name="flash" size={10} color={colors.warn} />
                <Text style={styles.featuredText}>{t('Featured')}</Text>
              </View>
            )}
          </View>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>{post.title}</Text>
        {where ? (
          <View style={styles.metaRow}>
            <Ionicons name={post.is_online ? 'laptop-outline' : 'location-outline'} size={14} color={colors.muted} />
            <Text style={styles.meta} numberOfLines={1}>{where}</Text>
          </View>
        ) : null}
        <FriendsGoing postId={post.id} style={{ marginTop: 8 }} />
        <View style={styles.pills}>
          <Pill
            icon="pricetag-outline"
            text={post.is_free === false ? (post.fee || t('Paid')) : t('Free')}
            tone={post.is_free === false ? 'neutral' : 'brand'}
          />
          {post.team_mode === 'team' ? <Pill icon="people-outline" text={t('Teams')} /> : null}
          {deadlineIn !== null && deadlineIn >= 0 && deadlineIn <= 7 ? (
            <Pill
              icon="hourglass-outline"
              tone="warn"
              text={deadlineIn === 0 ? t('Apply today') : deadlineIn === 1 ? t('Apply by tomorrow') : t('Apply within {n} days', { n: deadlineIn })}
            />
          ) : null}
        </View>
        <View style={styles.row}>
          <Text style={styles.author} numberOfLines={1}>
            {t('by')} <Text style={{ color: colors.body, fontWeight: '600' }}>{post.author?.full_name ?? t('Organizer')}</Text>
          </Text>
          {typeof post.spots === 'number' && (
            <Text style={styles.spots}>{post.spots === 1 ? t('1 spot') : t('{n} spots', { n: post.spots })}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default memo(EventCard);

// One quiet line — tiny overlapping faces + "Aziz and 2 friends are going".
// Renders nothing until friends_going() answers with someone (or if it fails).
export function FriendsGoing({ postId, style }) {
  const fgv = useFriendsGoing(postId);
  const text = friendsGoingText(fgv);
  if (!text) return null;
  const names = fgv.names ?? [];
  const faces = names.slice(0, 3);
  return (
    <View style={[styles.fgRow, style]}>
      <View style={styles.fgFaces}>
        {faces.map((name, i) => (
          <Avatar
            key={`${name}-${i}`}
            id={name}
            name={name}
            uri={fgv.avatars?.[i] || null}
            size={18}
            style={[styles.fgFace, { marginLeft: i ? -6 : 0, zIndex: 3 - i }]}
          />
        ))}
      </View>
      <Text style={styles.fgText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function Pill({ icon, text, tone = 'neutral' }) {
  const c = tone === 'brand' ? [colors.brandSoft, colors.brand]
    : tone === 'warn' ? [colors.warnSoft, colors.warn]
      : [colors.bg, colors.body];
  return (
    <View style={[styles.pill, { backgroundColor: c[0] }]}>
      <Ionicons name={icon} size={12} color={c[1]} />
      <Text style={[styles.pillText, { color: c[1] }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: 14, overflow: 'hidden', ...shadow.sm },
  cover: { width: '100%', aspectRatio: COVER_RATIO, backgroundColor: colors.line },
  coverFallback: { width: '100%', height: 96, alignItems: 'center', justifyContent: 'center' },
  coverTag: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(10,15,11,0.6)', borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10 },
  coverTagText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  saveBtn: { position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(10,15,11,0.55)', alignItems: 'center', justifyContent: 'center' },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  when: { fontSize: 12.5, fontWeight: '700', color: colors.brand },
  featured: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', backgroundColor: colors.warnSoft, borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 },
  featuredText: { fontSize: 10.5, fontWeight: '700', color: colors.warn },
  title: { ...type.title, fontSize: 16.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  meta: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8, maxWidth: 220 },
  pillText: { fontSize: 11.5, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  author: { fontSize: 12.5, color: colors.muted, flex: 1 },
  spots: { fontSize: 12, color: colors.brand, fontWeight: '700' },
  fgRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fgFaces: { flexDirection: 'row', alignItems: 'center' },
  fgFace: { borderWidth: 1.5, borderColor: colors.card },
  fgText: { fontSize: 12, color: colors.muted, fontWeight: '600', flexShrink: 1 },
});
