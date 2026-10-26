import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Button, Logo, TextField } from '../../components/ui';
import { colors, radius, type, shadow } from '../../lib/theme';
import { LegalDocument, POLICY_UPDATED } from '../legal';
import { t, useLocale, LanguageSwitch } from '../../lib/i18n';

export default function SignUp() {
  useLocale(); // re-render in place when the language changes (typed text stays)
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  // Tapped "Create account" without ticking the box: point at the box.
  const [needAgree, setNeedAgree] = useState(false);

  async function signUp() {
    setErr(''); setMsg(''); setNeedAgree(false);
    if (!name.trim()) { setErr(t('Add your name.')); return; }
    if (!email.trim() || password.length < 6) { setErr(t('Enter an email and a password of at least 6 characters.')); return; }
    if (!agreed) {
      setNeedAgree(true);
      setErr(t('Please agree to the Terms and Community Rules to create an account.'));
      return;
    }
    setLoading(true);
    const acceptedAt = new Date().toISOString();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // terms_accepted is read by the database when the profile is created
      // (supabase/27 stamps profiles.terms_accepted_at with the server clock).
      options: {
        data: {
          full_name: name.trim(),
          terms_accepted: true,
          terms_accepted_at: acceptedAt,
          terms_version: POLICY_UPDATED,
        },
      },
    });
    if (!error && data?.session && data.user?.id) {
      // Signed straight in (no email confirmation): record it on the profile
      // too, in case the database trigger isn't installed yet. Best-effort —
      // an older database without the column just ignores this.
      try {
        await supabase.from('profiles').update({ terms_accepted_at: acceptedAt })
          .eq('id', data.user.id).is('terms_accepted_at', null);
      } catch { /* ignore */ }
    }
    setLoading(false);
    if (error) setErr(t(error.message));
    else if (!data.session) setMsg(t('Account created. Please confirm your email, then log in.'));
    // if a session exists, the auth listener signs you straight in
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
      <View style={styles.brandBlock}>
        <Logo size={52} style={{ marginBottom: 16 }} />
        <Text style={type.h1}>{t('Create your account')}</Text>
        <Text style={[type.small, { marginTop: 6, textAlign: 'center' }]}>
          {t('Hackathons, MUNs, internships and teams in one place.')}
        </Text>
      </View>

      <View style={styles.panel}>
      <TextField label={t('Full name')} icon="person-outline" placeholder={t('Your name')} autoComplete="name"
        value={name} onChangeText={setName} style={{ marginTop: 0 }} />
      <TextField label={t('Email')} icon="mail-outline" autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" placeholder={t('you@example.com')} value={email} onChangeText={setEmail} />
      <TextField
        label={t('Password')}
        icon="lock-closed-outline"
        secure
        autoComplete="new-password"
        placeholder={t('At least 6 characters')}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={signUp}
      />

      <View style={styles.agreeRow}>
        <TouchableOpacity
          onPress={() => { setAgreed((v) => !v); setErr(''); setNeedAgree(false); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel={t('I agree to the Terms and Community Rules')}
        >
          <View style={[styles.box, agreed && styles.boxOn, needAgree && !agreed && styles.boxErr]}>
            {agreed ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          </View>
        </TouchableOpacity>
        <Text style={styles.agreeText}>
          {t('I agree to the')}{' '}
          <Text style={styles.link} onPress={() => setShowTerms(true)} accessibilityRole="link">
            {t('Terms and Community Rules')}
          </Text>
          {' '}{t('(no objectionable content or abusive users) and the')}{' '}
          <Text style={styles.link} onPress={() => setShowTerms(true)} accessibilityRole="link">
            {t('Privacy Policy')}
          </Text>
          .
        </Text>
      </View>

      {err ? (
        <View style={[styles.note, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={[styles.noteText, { color: colors.danger }]}>{err}</Text>
        </View>
      ) : null}
      {msg ? (
        <View style={[styles.note, { backgroundColor: colors.brandSoft }]}>
          <Ionicons name="mail-unread-outline" size={16} color={colors.brand} />
          <Text style={[styles.noteText, { color: colors.brand }]}>{msg}</Text>
        </View>
      ) : null}

      {/* Always tappable: unticked, it explains what's missing instead of
          sitting greyed out with no reason given. */}
      <Button title={t('Create account')} onPress={signUp} loading={loading} style={{ marginTop: 18 }} />
      </View>

      <Text style={styles.foot}>
        {t('Already have an account?')}{' '}
        <Link href="/(auth)/login" style={styles.link}>{t('Log in')}</Link>
      </Text>
      </View>
      </ScrollView>
      <LanguageSwitch style={[styles.lang, { top: insets.top + 12 }]} />

      {/* Shown here instead of navigating to /legal, so it works before login. */}
      <Modal visible={showTerms} animationType="slide" onRequestClose={() => setShowTerms(false)}>
        <View style={styles.modal}>
          <View style={styles.modalTop}>
            <Text style={styles.modalTitle}>{t('Terms, Rules & Privacy')}</Text>
            <TouchableOpacity onPress={() => setShowTerms(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>{t('Close')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
            <LegalDocument />
            <Button
              title={agreed ? t('Close') : t('I agree')}
              variant="green"
              style={{ marginTop: 8 }}
              onPress={() => { setAgreed(true); setErr(''); setNeedAgree(false); setShowTerms(false); }}
            />
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 64, paddingBottom: 40 },
  lang: { position: 'absolute', right: 16 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  brandBlock: { alignItems: 'center', marginBottom: 24 },
  panel: {
    backgroundColor: colors.card, borderRadius: radius.xl, padding: 22,
    borderWidth: 1, borderColor: colors.line, ...shadow.md,
  },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 18 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  boxErr: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  agreeText: { flex: 1, fontSize: 13.5, color: colors.body, lineHeight: 20 },
  foot: { textAlign: 'center', marginTop: 22, color: colors.muted, fontSize: 14 },
  link: { color: colors.brand, fontWeight: '700' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12 },
  noteText: { fontSize: 13.5, flex: 1 },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  close: { color: colors.brand, fontWeight: '700', fontSize: 15 },
});
