import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Read credentials from app.json -> expo.extra (or an EAS secret / env at build time).
const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || supabaseUrl.startsWith('REPLACE_')) {
  console.warn(
    '[Tadbirly] Supabase is not configured yet. Set supabaseUrl / supabaseAnonKey in app.json > expo.extra. See README.'
  );
}

export const supabase = createClient(supabaseUrl ?? 'https://placeholder.supabase.co', supabaseAnonKey ?? 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Password-reset emails are often opened somewhere other than where they
    // were requested (the Mail app's browser, or Safari when the request came
    // from the installed iPhone app, which has separate storage). The implicit
    // flow puts everything needed in the link itself; PKCE would need a secret
    // saved by the requesting browser and fail everywhere else. This is the
    // library default — spelled out so nobody "upgrades" it without that in mind.
    flowType: 'implicit',
    // Off on purpose: only app/reset-password.js reads tokens out of a URL, and
    // it does so itself. Nothing else should be signed in by a stray link.
    detectSessionInUrl: false,
  },
});

// Native only (Supabase's documented React Native setup): a phone app is
// suspended in the background, so the token-refresh timer can't be trusted
// there. Refresh only while the app is in the foreground, and restart the
// timer (which also refreshes an expired token) as soon as it comes back.
// The browser handles this by itself via visibilitychange — web is untouched.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
