import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Avatar } from '../../components/ui';
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
    setWho(profileRes.data?.full_name ?? 'This student');
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
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <Text style={styles.header}>
            {isMe ? 'Your friends' : `${who}'s friends`} · {rows.length}
          </Text>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isMe
              ? "You haven't added anyone yet. Use Social → Find people to add friends."
              : `${who} hasn't added anyone yet.`}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/user/${item.id}`)}>
            <Avatar uri={item.avatar_url} name={item.full_name} id={item.id} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {item.full_name}{item.id === uid ? ' · you' : ''}
              </Text>
              <Text style={styles.meta}>
                {item.university ? `${item.university} · ` : ''}⭐ {item.reliability ?? 75}%
                {mutualIds.has(item.id) ? ' · mutual' : ''}
              </Text>
            </View>
            <Text style={styles.go}>View →</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 13, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, marginBottom: 10 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  go: { fontSize: 12.5, color: colors.brand, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, lineHeight: 21, paddingHorizontal: 20 },
});
