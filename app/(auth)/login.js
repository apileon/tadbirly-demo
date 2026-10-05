import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button, Logo } from '../../components/ui';
import { colors, radius } from '../../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');

  async function signIn() {
    setErr('');
    if (!email.trim() || !password) { setErr('Enter your email and password.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setErr(error.message);
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.brandBlock}>
        <Logo size={72} style={{ marginBottom: 16 }} />
        <Text style={styles.logo}>Tadbir<Text style={{ color: colors.brand }}>ly</Text></Text>
        <Text style={styles.tag}>The next move is yours.</Text>
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
      <View style={styles.pwWrap}>
        <TextInput
          style={styles.pwInput}
          secureTextEntry={!showPw}
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={signIn}
        />
        <TouchableOpacity
          onPress={() => setShowPw((v) => !v)}
          style={styles.eye}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} />
        </TouchableOpacity>
      </View>

      {/* Without this, a forgotten password meant being locked out for good. */}
      <View style={styles.forgotRow}>
        <Link href="/(auth)/reset" style={styles.forgot}>Forgot password?</Link>
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <Button title="Log in" onPress={signIn} loading={loading} style={{ marginTop: 16 }} />

      <Text style={[styles.foot, { marginTop: 18 }]}>
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
  pwWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  pwInput: { flex: 1, padding: 13, fontSize: 15, color: colors.ink },
  eye: { paddingHorizontal: 14, paddingVertical: 12 },
  forgotRow: { alignItems: 'flex-end', marginTop: 10 },
  forgot: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  foot: { textAlign: 'center', marginTop: 22, color: colors.muted, fontSize: 14 },
  link: { color: colors.brand, fontWeight: '700' },
  err: { color: colors.danger, fontSize: 13.5, marginTop: 14, textAlign: 'center' },
});
