import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Button } from '../../components/ui';

export default function Profile() {
  const router = useRouter();
  const { profile, session, signOut } = useAuth();
  const [stats, setStats] = useState({ applications: 0, posts: 0 });

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    const [{ count: apps }, { count: posts }] = await Promise.all([
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', uid),
      supabase.from('posts').select('*', { count: 'exact', head: true }).eq('author_id', uid),
    ]);
    setStats({ applications: apps ?? 0, posts: posts ?? 0 });
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const initials = (profile?.full_name ?? 'U').split(' ').map((s) => s[0]).slice(0, 2).join('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
        <View style={styles.head}>
          <View style={styles.pfp}><Text style={styles.pfpText}>{initials}</Text></View>
          <Text style={styles.name}>{profile?.full_name ?? 'Your name'}</Text>
          <Text style={styles.role}>
            {(profile?.role ?? 'participant')} · {profile?.city ?? 'Tashkent'}
          </Text>
          <View style={styles.badges}>
            {profile?.verified_student && <Badge text="✔ Verified student" />}
            {profile?.is_pro && <Badge text="⚡ Pro" />}
          </View>
        </View>

        <View style={styles.statRow}>
          <Stat value={stats.applications} label="Applications" />
          <Stat value={stats.posts} label="Posts" />
          <Stat value={`${profile?.reliability ?? 100}%`} label="Reliability" />
        </View>

        <TouchableOpacity style={styles.coach} onPress={() => router.push('/coach')}>
          <Text style={styles.coachTitle}>🧭 AI Career Coach</Text>
          <Text style={styles.coachBody}>
            Get a personalized suggestion for your next event to grow your profile.
          </Text>
          <Text style={styles.coachCta}>→ Open coach</Text>
        </TouchableOpacity>

        {!profile?.is_pro && (
          <Button title="⚡ Upgrade to Tadbirly Pro" variant="dark" style={{ marginTop: 14 }} onPress={() => router.push('/pro')} />
        )}
        <Button title="Privacy & account" variant="ghost" style={{ marginTop: 12 }} onPress={() => router.push('/legal')} />
        <Button title="Log out" variant="ghost" style={{ marginTop: 12 }} onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Badge({ text }) {
  return <Text style={styles.badge}>{text}</Text>;
}
function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', paddingVertical: 10 },
  pfp: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  pfpText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: colors.ink },
  role: { fontSize: 13, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { fontSize: 11.5, backgroundColor: colors.brandSoft, color: colors.brand, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 20, fontWeight: '700', overflow: 'hidden' },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  stat: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  coach: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16, marginTop: 18 },
  coachTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  coachBody: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 6, lineHeight: 19 },
  coachCta: { color: '#8fb4ff', fontWeight: '700', marginTop: 10 },
});
