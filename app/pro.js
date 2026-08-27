import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';
import { Button } from '../components/ui';

const PRO_FEATURES = [
  'Unlimited event posts',
  'Boosted placement in the feed',
  'Filter applicants by university, skills & reliability',
  'Analytics: views, conversions, no-show stats',
  'Priority claim on the request board',
  'Verified organizer badge',
];

export default function Pro() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  // NOTE: This flips the flag directly for the MVP. Before launch, gate this
  // behind a real payment (RevenueCat / Stripe / local providers like Payme, Click)
  // and set is_pro from a verified server-side webhook — never trust the client.
  async function upgrade() {
    setLoading(true);
    await supabase.from('profiles').update({ is_pro: true }).eq('id', session.user.id);
    await refreshProfile();
    setLoading(false);
    Alert.alert('Welcome to Pro ⚡', 'Payments are stubbed for the MVP — see the code comment to wire up Payme/Click/Stripe.');
    router.back();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.h1}>⚡ Tadbirly Pro</Text>
      <Text style={styles.sub}>Students never pay. Applying is free forever. Pro is for organizers who post a lot.</Text>

      <View style={styles.freeCard}>
        <Text style={styles.planName}>Free — forever</Text>
        {['3 event posts per month', 'Unlimited applications received', 'Post requests — always free'].map((f) => (
          <Text key={f} style={styles.freeFeat}>✔ {f}</Text>
        ))}
      </View>

      <View style={styles.proCard}>
        <Text style={styles.proName}>Pro — 99 000 so'm / month</Text>
        {PRO_FEATURES.map((f) => (
          <Text key={f} style={styles.proFeat}>✔ {f}</Text>
        ))}
        <Button
          title={profile?.is_pro ? "You're on Pro ✓" : 'Upgrade to Pro'}
          variant="green"
          disabled={profile?.is_pro}
          loading={loading}
          onPress={upgrade}
          style={{ marginTop: 16 }}
        />
      </View>
      <Text style={styles.note}>Cancel anytime. Your free posts reset at the start of each month.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.muted, marginTop: 6, lineHeight: 20 },
  freeCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 18, marginTop: 20 },
  planName: { fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  freeFeat: { fontSize: 13.5, color: colors.muted, marginTop: 6 },
  proCard: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 18, marginTop: 16 },
  proName: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 10 },
  proFeat: { fontSize: 13.5, color: 'rgba(255,255,255,0.9)', marginTop: 6 },
  note: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 16 },
});
