import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, radius } from '../lib/theme';
import { Button } from '../components/ui';
import { deleteAccount } from '../lib/moderation';

// Short in-app copy. The FULL policy must also be hosted at a public URL
// (e.g. https://tadbirly.uz/privacy) and linked in your store listings.
export default function Legal() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently removes your profile, posts, applications and messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await deleteAccount();
            } catch (e) {
              setBusy(false);
              Alert.alert('Could not delete', e.message ?? 'Try again, or contact support.');
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18 }}>
      <Text style={styles.h1}>Privacy & Terms</Text>

      <Section title="Community rules">
        Tadbirly has zero tolerance for abusive, harmful, or spam content. Posts may be reviewed.
        You can report any post or user, and block users you don't want to interact with. Accounts
        that break the rules are removed.
      </Section>

      <Section title="Your data">
        We store your name, email, profile details and the posts, applications and messages you
        create, in order to run the service. We do not sell your data. You can delete your account
        at any time below.
      </Section>

      <Section title="Terms of use">
        By using Tadbirly you agree to post accurate information, treat other users respectfully,
        and follow local laws. Tadbirly is provided "as is" during this early access period.
      </Section>

      <Text style={styles.note}>
        Full policy: https://tadbirly.uz/privacy  ·  Contact: support@tadbirly.uz
      </Text>

      <View style={styles.danger}>
        <Text style={styles.dangerTitle}>Danger zone</Text>
        <Button title="Delete my account" variant="primary" style={styles.delBtn} loading={busy} onPress={confirmDelete} />
      </View>

      <Button title="Back" variant="ghost" style={{ marginTop: 12 }} onPress={() => router.back()} />
    </ScrollView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 13.5, lineHeight: 21, color: colors.ink },
  note: { fontSize: 11.5, color: colors.muted, marginTop: 4, marginBottom: 16, lineHeight: 18 },
  danger: { borderWidth: 1, borderColor: '#fbd5d5', backgroundColor: '#fdecec', borderRadius: radius.lg, padding: 16 },
  dangerTitle: { fontSize: 13, fontWeight: '800', color: colors.danger, marginBottom: 10 },
  delBtn: { backgroundColor: colors.danger },
});
