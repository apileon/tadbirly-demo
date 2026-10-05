import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui';
import { colors, radius } from '../lib/theme';

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
    new URLSearchParams(window.location.search).forEach((v, k) => { out[k] = v; });
    if (window.location.hash.length > 1) fragment = window.location.hash.slice(1);
  }
  new URLSearchParams(fragment).forEach((v, k) => { out[k] = v; });
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
        error = { message: e?.message || 'Could not check this link.' };
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
    const t = setTimeout(() => router.replace('/'), 1500);
    return () => clearTimeout(t);
  }, [stage, router]);

  async function save() {
    setErr('');
    if (password.length < MIN_LENGTH) { setErr(`Use at least ${MIN_LENGTH} characters.`); return; }
    if (password !== confirm) { setErr("The two passwords don't match."); return; }
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
        <Text style={[styles.body, { marginTop: 14, textAlign: 'center' }]}>Checking your reset link…</Text>
      </View>
    );
  }

  if (stage === 'invalid') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>This link is invalid or expired</Text>
        <Text style={styles.body}>
          Reset links only work once, and only for a short while.{' '}
          {signedIn
            ? "You're still logged in on this device, so nothing is lost."
            : 'Ask for a new one, then open the newest email you get.'}
        </Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {signedIn ? (
          <Button title="Go to Tadbirly" onPress={() => router.replace('/')} style={{ marginTop: 20 }} />
        ) : (
          <Button title="Send me a new link" onPress={() => router.replace('/(auth)/reset')} style={{ marginTop: 20 }} />
        )}
      </View>
    );
  }

  if (stage === 'done') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>Password updated ✅</Text>
        <Text style={styles.body}>You're logged in with your new password. Taking you to Tadbirly…</Text>
        <Button title="Continue" onPress={() => router.replace('/')} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.h1}>Choose a new password</Text>
      <Text style={styles.body}>
        {email ? `For ${email}. ` : ''}At least {MIN_LENGTH} characters.
      </Text>

      <Text style={styles.label}>New password</Text>
      <View style={styles.pwWrap}>
        <TextInput
          style={styles.pwInput}
          secureTextEntry={!showPw}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          onPress={() => setShowPw((v) => !v)}
          style={styles.eye}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Repeat new password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry={!showPw}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="••••••••"
        placeholderTextColor={colors.muted}
        value={confirm}
        onChangeText={setConfirm}
        onSubmitEditing={save}
      />

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <Button title="Save new password" onPress={save} loading={saving} style={{ marginTop: 18 }} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' },
  center: { alignItems: 'center' },
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  detail: { fontSize: 12.5, color: colors.muted, marginTop: 10, fontStyle: 'italic' },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 6 },
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
  err: { color: colors.danger, fontSize: 13.5, marginTop: 14, textAlign: 'center' },
});
