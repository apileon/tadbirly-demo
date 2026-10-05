import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import { Card, Button } from '../../components/ui';

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
  if (!post) return <Text style={styles.empty}>Event not found.</Text>;
  if (post.author_id !== uid) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={styles.empty}>Only the organizer of this event can open this page. You can see who's going on the event page.</Text>
        <Button title="Open the event" variant="ghost" style={{ marginTop: 14 }} onPress={() => router.replace(`/post/${postId}`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.head}>
        <Text style={styles.title}>👥 Accepted participants</Text>
        <Text style={styles.sub}>{post.title ?? 'Event'} · {rows.length} confirmed</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No accepted participants yet. Accept people from the Applicants screen.</Text>}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/user/${item.id}`)}>
            <View style={styles.row}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(item.full_name ?? '?')[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.full_name}{item.verified_student ? ' ✔' : ''}</Text>
                <Text style={styles.meta}>{item.university ?? ''}{item.major ? ` · ${item.major}` : ''} · ⭐ {item.reliability ?? 75}%</Text>
              </View>
              <Text style={styles.view}>Profile →</Text>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: colors.card, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 18 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  view: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
});
