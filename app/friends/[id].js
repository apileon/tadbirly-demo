import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, column } from '../../lib/theme';
import { Avatar, EmptyState, SectionHeader, reliabilityText } from '../../components/ui';
import { t } from '../../lib/i18n';
import { SkeletonList } from '../../components/Skeleton';

export default function FriendsList() {
  const { id } = useLocalSearchParams();
  const { session } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const isMe = uid === id;

  const [who, setWho] = useState(null);
  const [rows, setRows] = useState([]);
  const [mutualIds, setMutualIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [profileRes, friendsRes, mutualRes] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', id).single(),
      supabase.rpc('friends_of', { target: id }),
      isMe ? Promise.resolve({ data: [] }) : supabase.rpc('mutual_friends', { target: id }),
    ]);
    setWho(profileRes.data?.full_name ?? t('This student'));
    setRows(friendsRes.data ?? []);
    setMutualIds(new Set((mutualRes.data ?? []).map((m) => m.id)));
    setLoading(false);
  }, [id, isMe]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <SkeletonList count={6} type="row" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <SectionHeader
            title={`${isMe ? t('Your friends') : t("{name}'s friends", { name: who })} · ${rows.length}`}
            style={{ marginTop: 0 }}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={isMe ? t("You haven't added anyone yet") : t("{name} hasn't added anyone yet", { name: who })}
            text={isMe ? t('Use Social, then Find people, to add friends.') : undefined}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/user/${item.id}`)}>
            <Avatar uri={item.avatar_url} name={item.full_name} id={item.id} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {item.full_name}{item.id === uid ? ` · ${t('you')}` : ''}
              </Text>
              <View style={styles.metaRow}>
                {item.university ? <Text style={styles.meta} numberOfLines={1}>{item.university} ·</Text> : null}
                <Ionicons name="shield-checkmark-outline" size={12} color={colors.muted} />
                <Text style={styles.meta}>
                  {reliabilityText(item.reliability)}{mutualIds.has(item.id) ? ` · ${t('mutual')}` : ''}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, ...column },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 13, marginBottom: 10 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { fontSize: 12.5, color: colors.muted, flexShrink: 1 },
});
