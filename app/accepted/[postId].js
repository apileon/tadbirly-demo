import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow } from '../../lib/theme';
import { Button, Avatar, EmptyState } from '../../components/ui';
import { t } from '../../lib/i18n';

// Organizer-only, like Applicants / Medals / End event. Participants never
// get a link here (they see "Going: …" on the event page, which uses the
// event_roster function), and row security only returns their OWN
// application to them — so for a participant this list was simply wrong
// ("1 confirmed": themselves).
export default function AcceptedParticipants() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [post, setPost] = useState(undefined); // undefined = still loading
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('posts').select('title, author_id').eq('id', postId).single();
    if (p && p.author_id === uid) {
      const { data } = await supabase
        .from('applications')
        .select('applicant:profiles!applications_applicant_id_fkey(id, full_name, university, major, reliability, verified_student)')
        .eq('post_id', postId)
        .eq('status', 'accepted');
      setRows((data ?? []).map((r) => r.applicant).filter(Boolean));
    }
    setPost(p ?? null);
  }, [postId, uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (post === undefined) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="alert-circle-outline" title={t('Event not found.')} />;
  if (post.author_id !== uid) {
    return (
      <View style={styles.gate}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('Organizers only')}
          text={t("Only the organizer of this event can open this page. You can see who's going on the event page.")}
          style={{ paddingBottom: 8 }}
        />
        <Button title={t('Open the event')} variant="ghost" style={{ marginTop: 8 }} onPress={() => router.replace(`/post/${postId}`)} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows}
      keyExtractor={(u) => u.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.head}>
          <Text style={styles.title}>{t('Accepted participants')}</Text>
          <Text style={styles.sub}>
            {post.title ?? t('Event')} · {rows.length === 1 ? t('1 confirmed') : t('{n} confirmed', { n: rows.length })}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="people-outline"
          title={t('No accepted participants yet')}
          text={t('Accept people from the Applicants screen.')}
        />
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => router.push(`/user/${item.id}`)}>
          <Avatar name={item.full_name} id={item.id} size={44} />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
              {item.verified_student ? (
                <Ionicons name="checkmark-circle" size={15} color={colors.brand} accessibilityLabel={t('Verified student')} />
              ) : null}
            </View>
            {item.university || item.major ? (
              <Text style={styles.meta} numberOfLines={1}>{item.university ?? ''}{item.major ? `${item.university ? ' · ' : ''}${item.major}` : ''}</Text>
            ) : null}
            <View style={styles.relRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={colors.brand} />
              <Text style={styles.rel}>{t('{n}% reliable', { n: item.reliability ?? 75 })}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} accessibilityLabel={t('Profile')} />
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  gate: { padding: 24, alignItems: 'center', width: '100%', maxWidth: 520, alignSelf: 'center' },
  head: { marginBottom: 14 },
  title: { ...type.h2 },
  sub: { ...type.small, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 10, ...shadow.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...type.title, fontSize: 15, flexShrink: 1 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  relRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  rel: { fontSize: 12, color: colors.body, fontWeight: '600' },
});
