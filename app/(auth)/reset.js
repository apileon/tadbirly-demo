import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui';
import { colors, radius } from '../../lib/theme';

export default function Reset() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function sendReset() {
    if (!email.trim()) return Alert.alert('Enter your email');
    setLoading(true);
    // Sends a recovery email. Configure the redirect in Supabase > Auth > URL config.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'tadbirly://reset-callback',
    });
    setLoading(false);
    if (error) Alert.alert('Could not send', error.message);
    else setSent(true);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>Reset your password</Text>
      {sent ? (
        <Text style={styles.body}>
          If an account exists for {email}, a reset link is on its way. Check your inbox.
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
