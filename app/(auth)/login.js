import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui';
import { colors, radius } from '../../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) Alert.alert('Could not sign in', error.message);
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.brandBlock}>
        <Text style={styles.logo}>Tadbir<Text style={{ color: colors.brand }}>ly</Text></Text>
        <Text style={styles.tag}>Every opportunity in Uzbekistan — one tap away.</Text>
      </View>

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
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={setPassword}
      />

      <Button title="Log in" onPress={signIn} loading={loading} style={{ marginTop: 20 }} />

      <Text style={styles.foot}>
        <Link href="/(auth)/reset" style={styles.link}>Forgot password?</Link>
      </Text>
      <Text style={[styles.foot, { marginTop: 8 }]}>
        New here?{' '}
        <Link href="/(auth)/signup" style={styles.link}>Create an account</Link>
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' },
  brandBlock: { alignItems: 'center', marginBottom: 36 },
  logo: { fontSize: 34, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  tag: { fontSize: 14, color: colors.muted, marginTop: 8, textAlign: 'center' },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 13, fontSize: 15, color: colors.ink,
  },
  foot: { textAlign: 'center', marginTop: 22, color: colors.muted, fontSize: 14 },
  link: { color: colors.brand, fontWeight: '700' },
});
