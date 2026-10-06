import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Button, Logo, TextField } from '../components/ui';
import { colors, radius, type, shadow } from '../lib/theme';
import { t } from '../lib/i18n';

// ---------------------------------------------------------------------------
//  Where the "reset your password" email lands (see app/(auth)/reset.js).
//  The link signs the person in; this screen then lets them pick a new
//  password. app/_layout.js never redirects away from it, signed in or not.
// ---------------------------------------------------------------------------

const MIN_LENGTH = 8;

// Everything the emailed link can carry, from its ?query and its #fragment:
//   implicit flow (ours — lib/supabase.js)   #access_token=…&refresh_token=…&type=recovery
//   PKCE flow                                ?code=…
//   a customised email template              ?token_hash=…&type=recovery
//   an expired or already-used link          #error=access_denied&error_code=otp_expired&error_description=…
function readLinkParams(routeParams) {
  const out = {};
  let fragment = '';
  Object.entries(routeParams ?? {}).forEach(([k, v]) => {
    if (k === '#') fragment = String(v ?? ''); // expo-router passes the fragment as a '#' param
    else if (typeof v === 'string') out[k] = v;
  });
  // On web, the address bar is the untouched original — prefer it.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    new globalThis.URLSearchParams(window.location.search).forEach((v, k) => { out[k] = v; });
    if (window.location.hash.length > 1) fragment = window.location.hash.slice(1);
  }
  new globalThis.URLSearchParams(fragment).forEach((v, k) => { out[k] = v; });
  return out;
}

// The one-time secrets have done their job: take them out of the address bar
// and the browser history. history.state is kept as is — expo-router tracks
// its own history entries through it.
function scrubUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  } catch { /* ignore */ }
}

export default function ResetPassword() {
  const router = useRouter();
  const routeParams = useLocalSearchParams();
  // checking → form → done, or checking → invalid
  const [stage, setStage] = useState('checking');
  const [detail, setDetail] = useState(''); // Supabase's own words when a link fails
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const started = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Read the link once, on arrival.
  useEffect(() => {
    // Codes are single-use: a second attempt (re-render, React StrictMode)
    // would fail and wrongly report the link as expired.
    if (started.current) return;
    started.current = true;

    (async () => {
      const p = readLinkParams(routeParams);
      let error = null;
      try {
        if (p.error || p.error_code || p.error_description) {
          error = { message: p.error_description || p.error || p.error_code };
        } else if (p.code) {
          ({ error } = await supabase.auth.exchangeCodeForSession(p.code));
        } else if (p.token_hash) {
          ({ error } = await supabase.auth.verifyOtp({ token_hash: p.token_hash, type: 'recovery' }));
        } else if (p.access_token && p.refresh_token) {
          ({ error } = await supabase.auth.setSession({
            access_token: p.access_token,
            refresh_token: p.refresh_token,
          }));
        }
        // Nothing in the link at all — e.g. this page was reloaded after the
        // link was used. Fine if someone is signed in (checked below).
      } catch (e) {
        error = { message: e?.message || t('Could not check this link.') };
      }
      scrubUrl();

      const { data } = await supabase.auth.getSession();
      if (!mounted.current) return;
      const session = data?.session ?? null;
      setSignedIn(!!session);
      if (!error && session) {
        setEmail(session.user?.email ?? '');
        setStage('form');
      } else {
        setDetail(error?.message ?? '');
        setStage('invalid');
      }
    })();
    // Deliberately once: see `started` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the confirmation for a moment, then carry on into the app.
  useEffect(() => {
    if (stage !== 'done') return undefined;
    const timer = setTimeout(() => router.replace('/'), 1500);
    return () => clearTimeout(timer);
  }, [stage, router]);

  async function save() {
    setErr('');
    if (password.length < MIN_LENGTH) { setErr(t('Use at least {n} characters.', { n: MIN_LENGTH })); return; }
    if (password !== confirm) { setErr(t("The two passwords don't match.")); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (!mounted.current) return;
    setSaving(false);
    if (error) {
      // The link's sign-in doesn't last forever; once it's gone only a new
      // email can help, so say that instead of "Auth session missing!".
      if (error.name === 'AuthSessionMissingError') {
        setSignedIn(false);
        setDetail('');
        setStage('invalid');
        return;
      }
      setErr(error.message); // e.g. "New password should be different from the old password."
      return;
    }
    setStage('done');
  }

  if (stage === 'checking') {
    return (
      <View style={[styles.wrap, styles.center]}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={[styles.body, { marginTop: 14, textAlign: 'center' }]}>{t('Checking your reset link…')}</Text>
      </View>
    );
  }

  if (stage === 'invalid') {
    return (
      <Shell>
        <View style={[styles.badge, { backgroundColor: colors.warnSoft }]}>
          <Ionicons name="time-outline" size={26} color={colors.warn} />
        </View>
        <Text style={styles.h1}>{t('This link is invalid or expired')}</Text>
        <Text style={styles.body}>
          {signedIn
            ? t("Reset links only work once, and only for a short while. You're still logged in on this device, so nothing is lost.")
            : t('Reset links only work once, and only for a short while. Ask for a new one, then open the newest email you get.')}
        </Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {signedIn ? (
          <Button title={t('Go to Tadbirly')} onPress={() => router.replace('/')} style={{ marginTop: 20 }} />
        ) : (
          <Button title={t('Send me a new link')} icon="mail-outline" onPress={() => router.replace('/(auth)/reset')} style={{ marginTop: 20 }} />
        )}
      </Shell>
    );
  }

  if (stage === 'done') {
    return (
      <Shell>
        <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
        </View>
        <Text style={styles.h1}>{t('Password updated')}</Text>
        <Text style={styles.body}>{t("You're logged in with your new password. Taking you to Tadbirly…")}</Text>
        <Button title={t('Continue')} onPress={() => router.replace('/')} style={{ marginTop: 20 }} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Text style={styles.h1}>{t('Choose a new password')}</Text>
      <Text style={styles.body}>
        {email
          ? t('For {email}. At least {n} characters.', { email, n: MIN_LENGTH })
          : t('At least {n} characters.', { n: MIN_LENGTH })}
      </Text>

      <TextField
        label={t('New password')}
        icon="lock-closed-outline"
        secureTextEntry={!showPw}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        style={{ marginTop: 18 }}
      />

      <TextField
        label={t('Repeat new password')}
        icon="lock-closed-outline"
        secureTextEntry={!showPw}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="••••••••"
        value={confirm}
        onChangeText={setConfirm}
        onSubmitEditing={save}
      />

      {/* One toggle shows or hides both fields. */}
      <TouchableOpacity
        onPress={() => setShowPw((v) => !v)}
        style={styles.showRow}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={showPw ? t('Hide password') : t('Show password')}
      >
        <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.muted} />
        <Text style={styles.showText}>{showPw ? t('Hide password') : t('Show password')}</Text>
      </TouchableOpacity>

      {err ? (
        <View style={styles.err}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errText}>{err}</Text>
        </View>
      ) : null}

      <Button title={t('Save new password')} onPress={save} loading={saving} style={{ marginTop: 18 }} />
    </Shell>
  );
}

// Centred column with the logo above a card, like the log-in screen.
function Shell({ children }) {
  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <Logo size={52} style={{ alignSelf: 'center', marginBottom: 22 }} />
          <View style={styles.panel}>{children}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 40 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  panel: {
    backgroundColor: colors.card, borderRadius: radius.xl, padding: 22,
    borderWidth: 1, borderColor: colors.line, ...shadow.md,
  },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  h1: { ...type.h2, marginBottom: 8 },
  body: { ...type.small, fontSize: 14, lineHeight: 21 },
  detail: { fontSize: 12.5, color: colors.muted, marginTop: 10, fontStyle: 'italic' },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12 },
  showText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  err: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    backgroundColor: colors.dangerSoft, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12,
  },
  errText: { color: colors.danger, fontSize: 13.5, flex: 1 },
});
