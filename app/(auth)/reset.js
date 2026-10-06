import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify } from '../../lib/notify';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button, Logo, TextField } from '../../components/ui';
import { colors, radius, type, shadow } from '../../lib/theme';
import { t } from '../../lib/i18n';

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
    if (!email.trim()) return notify(t('Enter your email'));
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectUrl(),
    });
    setLoading(false);
    if (error) notify(t('Could not send'), error.message);
    else setSent(true);
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <Logo size={52} style={{ alignSelf: 'center', marginBottom: 22 }} />
          <View style={styles.panel}>
            {sent ? (
              <View style={styles.badge}>
                <Ionicons name="mail-open-outline" size={26} color={colors.brand} />
              </View>
            ) : null}
            <Text style={type.h2}>{t('Reset your password')}</Text>
            {sent ? (
              <Text style={styles.body}>
                {t('If an account exists for {email}, a reset link is on its way. Check your inbox (and spam), then open the link to choose a new password.', { email })}
              </Text>
            ) : (
              <>
                <Text style={styles.body}>{t("Enter your email and we'll send a reset link.")}</Text>
                <TextField
                  label={t('Email')}
                  icon="mail-outline"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder={t('you@example.com')}
                  value={email}
                  onChangeText={setEmail}
                  onSubmitEditing={sendReset}
                  style={{ marginTop: 18 }}
                />
                <Button title={t('Send reset link')} icon="paper-plane-outline" onPress={sendReset} loading={loading} style={{ marginTop: 18 }} />
              </>
            )}
          </View>
          <View style={styles.foot}>
            <Ionicons name="chevron-back" size={15} color={colors.brand} />
            <Link href="/(auth)/login" style={styles.link}>{t('Back to log in')}</Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 40 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  panel: {
    backgroundColor: colors.card, borderRadius: radius.xl, padding: 22,
    borderWidth: 1, borderColor: colors.line, ...shadow.md,
  },
  badge: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  body: { ...type.small, fontSize: 14, lineHeight: 21, marginTop: 6 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, marginTop: 22 },
  link: { color: colors.brand, fontWeight: '700', fontSize: 14 },
});
