import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Button, Logo } from '../../components/ui';
import { colors, radius } from '../../lib/theme';
import { LegalDocument, POLICY_UPDATED } from '../legal';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function signUp() {
    setErr(''); setMsg('');
    if (!name.trim()) { setErr('Add your name.'); return; }
    if (!email.trim() || password.length < 6) { setErr('Enter an email and a password of at least 6 characters.'); return; }
    if (!agreed) { setErr('Please agree to the Terms and Community Rules to create an account.'); return; }
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
    if (error) setErr(error.message);
    else if (!data.session) setMsg('Account created. Please confirm your email, then log in.');
    // if a session exists, the auth listener signs you straight in
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Logo size={56} style={{ alignSelf: 'center', marginBottom: 18 }} />
      <Text style={styles.logo}>Create your account</Text>

      <Text style={styles.label}>Full name</Text>
      <TextInput style={styles.input} placeholder="Kent K." placeholderTextColor={colors.muted}
        value={name} onChangeText={setName} />
      <Text style={styles.label}>Email</Text>
      <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address"
        placeholder="you@example.com" placeholderTextColor={colors.muted}
        value={email} onChangeText={setEmail} />
      <Text style={styles.label}>Password</Text>
      <View style={styles.pwWrap}>
        <TextInput
          style={styles.pwInput}
          secureTextEntry={!showPw}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={signUp}
        />
        <TouchableOpacity
          onPress={() => setShowPw((v) => !v)}
          style={styles.eye}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.agreeRow}>
        <TouchableOpacity
          onPress={() => { setAgreed((v) => !v); setErr(''); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Terms and Community Rules"
        >
          <View style={[styles.box, agreed && styles.boxOn]}>
            {agreed ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          </View>
        </TouchableOpacity>
        <Text style={styles.agreeText}>
          I agree to the{' '}
          <Text style={styles.link} onPress={() => setShowTerms(true)} accessibilityRole="link">
            Terms and Community Rules
          </Text>
          {' '}(no objectionable content or abusive users) and the{' '}
          <Text style={styles.link} onPress={() => setShowTerms(true)} accessibilityRole="link">
            Privacy Policy
          </Text>
          .
        </Text>
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      <Button title="Sign up" variant="green" onPress={signUp} loading={loading} disabled={!agreed} style={{ marginTop: 16 }} />

      <Text style={styles.foot}>
        Already have an account?{' '}
        <Link href="/(auth)/login" style={styles.link}>Log in</Link>
      </Text>

      {/* Shown here instead of navigating to /legal, so it works before login. */}
      <Modal visible={showTerms} animationType="slide" onRequestClose={() => setShowTerms(false)}>
        <View style={styles.modal}>
          <View style={styles.modalTop}>
            <Text style={styles.modalTitle}>Terms, Rules & Privacy</Text>
            <TouchableOpacity onPress={() => setShowTerms(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
            <LegalDocument />
            <Button
              title={agreed ? 'Close' : 'I agree'}
              variant="green"
              style={{ marginTop: 8 }}
              onPress={() => { setAgreed(true); setErr(''); setShowTerms(false); }}
            />
          </ScrollView>
        </View>
      </Modal>
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
  pwWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  pwInput: { flex: 1, padding: 13, fontSize: 15, color: colors.ink },
  eye: { paddingHorizontal: 14, paddingVertical: 12 },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  agreeText: { flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 20 },
  foot: { textAlign: 'center', marginTop: 22, color: colors.muted, fontSize: 14 },
  link: { color: colors.brand, fontWeight: '700' },
  err: { color: colors.danger, fontSize: 13.5, marginTop: 14, textAlign: 'center' },
  msg: { color: colors.brand, fontSize: 13.5, marginTop: 14, textAlign: 'center' },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  close: { color: colors.brand, fontWeight: '800', fontSize: 15 },
});
