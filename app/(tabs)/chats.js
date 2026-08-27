import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function Chats() {
  const router = useRouter();
  const { session } = useAuth();
  const [chats, setChats] = useState([]);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    const { data } = await supabase
      .from('chats')
      .select('*, post:posts(title, kind), participant:profiles!chats_participant_id_fkey(full_name), organizer:profiles!chats_organizer_id_fkey(full_name)')
      .or(`participant_id.eq.${uid},organizer_id.eq.${uid}`)
      .order('created_at', { ascending: false });
    setChats(data ?? []);
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Text style={styles.h1}>Chats</Text>
      <Text style={styles.sub}>Chats open after you apply. Organizer messages are highlighted.</Text>
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No chats yet — apply to a post and a chat opens here.</Text>}
        renderItem={({ item }) => {
          const iAmOrganizer = item.organizer_id === session.user.id;
          const other = iAmOrganizer ? item.participant?.full_name : item.organizer?.full_name;
          return (
            <TouchableOpacity style={styles.row} onPress={() => router.push(`/chat/${item.id}`)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(other ?? '?')[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{other ?? 'User'}</Text>
                <Text style={styles.post} numberOfLines={1}>{item.post?.title ?? 'Post'}</Text>
              </View>
              {iAmOrganizer && <Text style={styles.badge}>Applicant</Text>}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink, paddingHorizontal: 18, paddingTop: 6 },
  sub: { fontSize: 13, color: colors.muted, paddingHorizontal: 18, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 18 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  post: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  badge: { fontSize: 11, color: colors.warn, fontWeight: '700', backgroundColor: colors.warnSoft, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, fontSize: 14, paddingHorizontal: 20 },
});
