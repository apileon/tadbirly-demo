import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, type, shadow, CATEGORIES, column } from '../lib/theme';
import { EmptyState, StatusPill } from '../components/ui';
import { formatEventWhen } from '../lib/events';
import { t } from '../lib/i18n';

// The post is fetched without its category, so the icon follows the coarse kind.
const KIND_ICONS = { event: 'calendar-outline', internship: 'briefcase-outline', mun: 'globe-outline' };

export default function MyApplications() {
  const { session } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('applications')
      .select('*, post:posts(id, title, kind, location, city, event_date)')
      .eq('applicant_id', session.user.id)
      .order('created_at', { ascending: false });
    setRows(data ?? []);
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <EmptyState
          icon="document-text-outline"
          title={t('No applications yet')}
          text={t('Apply to something from the feed and it appears here.')}
        />
      }
      renderItem={({ item }) => {
        const p = item.post ?? {};
        const cat = CATEGORIES[p.kind] ?? CATEGORIES.event;
        const where = p.location ?? p.city;
        return (
          <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={() => p.id && router.push(`/post/${p.id}`)}>
            <View style={[styles.typeIcon, { backgroundColor: cat.soft }]}>
              <Ionicons name={KIND_ICONS[p.kind] ?? KIND_ICONS.event} size={18} color={cat.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{p.title ?? t('Post')}</Text>
              {where || p.event_date ? (
                <Text style={styles.meta} numberOfLines={1}>{where}{p.event_date ? `${where ? ' · ' : ''}${formatEventWhen(p.event_date)}` : ''}</Text>
              ) : null}
              <View style={{ marginTop: 8 }}>
                <StatusPill status={item.status} />
              </View>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.faint} style={{ alignSelf: 'center' }} />
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, ...column },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 12, ...shadow.sm },
  typeIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.title, fontSize: 15 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 3 },
});
