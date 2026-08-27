import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui';
import { colors, radius } from '../../lib/theme';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signUp() {
    if (!name.trim()) return Alert.alert('Add your name');
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    setLoading(false);
    if (error) Alert.alert('Could not sign up', error.message);
    else Alert.alert('Check your email', 'Confirm your address, then log in.');
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.logo}>Create your account</Text>

      <Text style={styles.label}>Full name</Text>
      <TextInput style={styles.input} placeholder="Kent K." placeholderTextColor={colors.muted}
        value={name} onChangeText={setName} />
      <Text style={styles.label}>Email</Text>
      <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address"
        placeholder="you@example.com" placeholderTextColor={colors.muted}
        value={email} onChangeText={setEmail} />
      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} secureTextEntry placeholder="At least 6 characters"
        placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} />

      <Button title="Sign up" variant="green" onPress={signUp} loading={loading} style={{ marginTop: 20 }} />

      <Text style={styles.foot}>
        Already have an account?{' '}
        <Link href="/(auth)/login" style={styles.link}>Log in</Link>
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' },
  logo: { fontSize: 26, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 13, fontSize: 15, color: colors.ink,
  },
  foot: { textAlign: 'center', marginTop: 22, color: colors.muted, fontSize: 14 },
  link: { color: colors.brand, fontWeight: '700' },
});
