import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { notify } from '../../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import { Card, Button } from '../../components/ui';
import { requestJoin, TEAM_STATUS } from '../../lib/teams';

export default function TeamBuilder() {
  const { session } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const [mine, setMine] = useState([]);
  const [open, setOpen] = useState([]);

  const load = useCallback(async () => {
    if (!uid) return;
    // Teams I'm in (accepted)
    const { data: memberships } = await supabase
      .from('team_members')
      .select('status, team:teams(id, name, competition, spots, owner_id, status)')
      .eq('user_id', uid).eq('status', 'accepted');
    setMine((memberships ?? []).map((m) => m.team).filter(Boolean));
    // Open teams to browse — only approved ones (not mine)
    const { data: allTeams } = await supabase
      .from('teams')
      .select('id, name, competition, description, spots, owner_id, owner:profiles!teams_owner_id_fkey(full_name)')
      .eq('status', 'approved')
      .neq('owner_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    setOpen(allTeams ?? []);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function join(teamId) {
    // requestJoin explains itself ("already in this team", "already asked",
    // network errors…) and lets people ask again after being declined, so
    // show its message rather than assuming every error means "already requested".
    const { error } = await requestJoin(teamId);
    if (error) return notify('Could not send the request', error.message);
    notify('Request sent 🧩', 'The team owner will see it in their Portal → Teams.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.h1}>🧩 Team Builder</Text>
        <Text style={styles.sub}>Build a team for any competition, or join one. New teams need an organizer's approval before they can apply to events.</Text>
        <Button title="＋ Create a team" style={{ marginTop: 12 }} onPress={() => router.push('/team/create')} />
      </View>
      <FlatList
        data={open}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <View>
            {mine.length > 0 && <Text style={styles.section}>My teams</Text>}
            {mine.map((t) => {
              const s = TEAM_STATUS[t.status ?? 'pending'] ?? TEAM_STATUS.pending;
              return (
                <Card key={t.id} onPress={() => router.push(`/team/${t.id}`)}>
                  <Text style={styles.name}>🧩 {t.name}</Text>
                  <Text style={styles.meta}>{t.competition ?? 'Competition'}{t.owner_id === uid ? ' · you own this' : ''}</Text>
                  <Text style={[styles.status, { color: s.color }]}>{s.label}</Text>
                </Card>
              );
            })}
            <Text style={styles.section}>Open teams</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No approved teams to join yet. Create the first one!</Text>}
        renderItem={({ item }) => (
          <Card>
            <Text style={styles.name}>🧩 {item.name}</Text>
            <Text style={styles.meta}>{item.competition ?? 'Competition'} · by {item.owner?.full_name ?? 'someone'}{item.spots ? ` · ${item.spots} spots` : ''}</Text>
            {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
            <Button title="Request to join" variant="green" style={{ marginTop: 10 }} onPress={() => join(item.id)} />
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 6 },
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  section: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 6, marginBottom: 10 },
  name: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  status: { fontSize: 12.5, fontWeight: '800', marginTop: 8 },
  desc: { fontSize: 13, color: colors.ink, marginTop: 8, lineHeight: 19 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 30, paddingHorizontal: 20, lineHeight: 21 },
});
