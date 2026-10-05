import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../lib/theme';
import { Button, Logo } from '../components/ui';
import { useAuth } from '../lib/auth';
import { LegalDocument } from './legal';

// Public Privacy Policy / Terms page for the store listings:
//   <PUBLIC_URL>/privacy
// Needs no login (app/_layout.js must let 'privacy' through for logged-out
// visitors — see the allow-list next to 'reset-password').
export default function PrivacyPage() {
  const router = useRouter();
  const { session } = useAuth();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={s.page}>
      <View style={s.top}>
        <Logo size={36} />
        <Text style={s.h1}>Tadbirly — Privacy Policy, Terms & Community Rules</Text>
      </View>
      <LegalDocument />
      <Button
        title={session ? 'Open Tadbirly' : 'Log in or sign up'}
        style={{ marginTop: 12 }}
        onPress={() => router.replace(session ? '/(tabs)' : '/(auth)/login')}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, width: '100%', maxWidth: 760, alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  h1: { flex: 1, fontSize: 19, fontWeight: '800', color: colors.ink },
});
