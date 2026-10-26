import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Button, Logo, Wordmark, TextField } from '../../components/ui';
import { colors, radius, type, shadow } from '../../lib/theme';
import { t, useLocale, LanguageSwitch } from '../../lib/i18n';

export default function Login() {
  useLocale(); // re-render in place when the language changes (typed text stays)
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function signIn() {
    setErr('');
    if (!email.trim() || !password) { setErr(t('Enter your email and password.')); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setErr(t(error.message));
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <View style={styles.brandBlock}>
            <Logo size={64} style={{ marginBottom: 18 }} />
            <Wordmark size={30} />
            <Text style={styles.tag}>{t('Every opportunity in Uzbekistan, one tap away.')}</Text>
          </View>

          <View style={styles.panel}>
            <Text style={type.h2}>{t('Welcome back')}</Text>
            <Text style={[type.small, { marginTop: 4 }]}>{t('Log in to see what\'s on this week.')}</Text>

            <TextField
              label={t('Email')}
              icon="mail-outline"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder={t('you@example.com')}
              value={email}
              onChangeText={setEmail}
              style={{ marginTop: 20 }}
            />
            <TextField
              label={t('Password')}
              icon="lock-closed-outline"
              secure
              autoComplete="current-password"
              placeholder={t('Your password')}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={signIn}
            />

            {/* Without this, a forgotten password meant being locked out for good. */}
            <View style={styles.forgotRow}>
              <Link href="/(auth)/reset" style={styles.link}>{t('Forgot password?')}</Link>
            </View>

            {err ? (
              <View style={styles.err}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errText}>{err}</Text>
              </View>
            ) : null}

            <Button title={t('Log in')} onPress={signIn} loading={loading} style={{ marginTop: 18 }} />
          </View>

          <Text style={styles.foot}>
            {t('New to Tadbirly?')}{' '}
            <Link href="/(auth)/signup" style={styles.link}>{t('Create an account')}</Link>
          </Text>
        </View>
      </ScrollView>
      <LanguageSwitch style={[styles.lang, { top: insets.top + 12 }]} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 64, paddingBottom: 40 },
  lang: { position: 'absolute', right: 16 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  brandBlock: { alignItems: 'center', marginBottom: 28 },
  tag: { ...type.small, fontSize: 14, marginTop: 8, textAlign: 'center' },
  panel: {
    backgroundColor: colors.card, borderRadius: radius.xl, padding: 22,
    borderWidth: 1, borderColor: colors.line, ...shadow.md,
  },
  forgotRow: { alignItems: 'flex-end', marginTop: 12 },
  link: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  err: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    backgroundColor: colors.dangerSoft, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12,
  },
  errText: { color: colors.danger, fontSize: 13.5, flex: 1 },
  foot: { textAlign: 'center', marginTop: 22, color: colors.muted, fontSize: 14 },
});
