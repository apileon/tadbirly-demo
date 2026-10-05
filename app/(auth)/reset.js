import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native';
import { notify } from '../../lib/notify';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui';
import { colors, radius } from '../../lib/theme';

// Where the emailed link lands: app/reset-password.js. On web that's this same
// site, whatever address it's served from. A native build has no web address
// of its own, so its link opens the live web app, which finishes the reset;
// the new password then works in the app too. The old 'tadbirly://' link
// opened nothing on the web, which is why nobody could reset a password.
// The address must be listed in Supabase → Authentication → URL Configuration
// → Redirect URLs, or Supabase silently sends people to the Site URL instead.
function resetRedirectUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/reset-password`;
  }
  return 'https://tadbirly.expo.app/reset-password';
}

export default function Reset() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function sendReset() {
    if (!email.trim()) return notify('Enter your email');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectUrl(),
    });
    setLoading(false);
    if (error) notify('Could not send', error.message);
    else setSent(true);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>Reset your password</Text>
      {sent ? (
        <Text style={styles.body}>
          If an account exists for {email}, a reset link is on its way. Check your inbox (and spam), then open the link to choose a new password.
        </Text>
      ) : (
        <>
          <Text style={styles.body}>Enter your email and we'll send a reset link.</Text>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={sendReset}
          />
          <Button title="Send reset link" onPress={sendReset} loading={loading} style={{ marginTop: 18 }} />
        </>
      )}
      <Text style={styles.foot}>
        <Link href="/(auth)/login" style={styles.link}>← Back to log in</Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' },
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, fontSize: 15, color: colors.ink },
  foot: { textAlign: 'center', marginTop: 24 },
  link: { color: colors.brand, fontWeight: '700', fontSize: 14 },
});
