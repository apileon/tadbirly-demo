import React, { useEffect } from 'react';
import { View, ActivityIndicator, TouchableOpacity, Text, Platform } from 'react-native';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../lib/auth';
import { BadgeProvider } from '../lib/badges';
import { colors, isDark } from '../lib/theme';
import { LocaleProvider, t } from '../lib/i18n';
import NotificationToast from '../components/NotificationToast';
import InstallPrompt from '../components/InstallPrompt';
import { unlockAudio } from '../lib/feedback';

// Expo Router wraps a layout in an error boundary when the layout exports one.
// Exported from the ROOT layout, a crash while rendering any screen shows
// "Something went wrong" with a Retry button instead of a blank white app.
export { ErrorBoundary } from 'expo-router';

// Native app: keep the launch splash up until we know whether the user is
// signed in, so they never see a spinner or a flash of the login screen.
// Web has no native splash — nothing to do there.
const isNative = Platform.OS !== 'web';
if (isNative) {
  SplashScreen.preventAutoHideAsync().catch(() => {});
  try { SplashScreen.setOptions({ duration: 250, fade: true }); } catch {}
}
// Never leave someone stuck on the splash: if auth hangs, hide it anyway and
// let the in-app loading spinner take over.
const SPLASH_MAX_MS = 8000;

function useHideSplash(loading) {
  useEffect(() => {
    if (!isNative) return undefined;
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
      return undefined;
    }
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [loading]);
}

// Browsers refuse to play any sound until the user has interacted with the
// page once. Unlock on the very first tap so notification pings can be heard.
function useAudioUnlock() {
  useEffect(() => {
    // Web only. A native app has a `window` too, but no addEventListener on
    // it — calling it crashed the app on launch.
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const go = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('touchstart', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go, { once: false });
    window.addEventListener('touchstart', go, { once: false });
    window.addEventListener('keydown', go, { once: false });
    return () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('touchstart', go);
      window.removeEventListener('keydown', go);
    };
  }, []);
}

// A visible, consistent Back control for every stacked (detail) screen —
// important on web, where the native header back button often doesn't show.
function HeaderBack() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
        marginRight: 10,
        marginLeft: Platform.OS === 'web' ? 8 : 0,
      }}
    >
      <Ionicons name="chevron-back" size={22} color={colors.ink} style={{ marginLeft: -2 }} />
    </TouchableOpacity>
  );
}

// Redirect users into or out of the app depending on auth state.
// A shared event link opened while signed out: remembered here and opened
// right after login, instead of dropping the student on the feed.
let pendingPath = null;

function useProtectedRoute() {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // The password-reset link works for both states: it arrives signed out,
    // signs the user in from the link, and then still needs this screen to set
    // the new password. Bouncing it to login or the feed would lose the link.
    // Reachable without logging in: password reset, and the legal pages
    // (store reviewers and listings link to them).
    if (['reset-password', 'legal', 'privacy'].includes(segments[0])) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      if (pathname && pathname !== '/' && !pathname.startsWith('/login')) pendingPath = pathname;
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      const next = pendingPath;
      pendingPath = null;
      router.replace(next || '/(tabs)');
    } else if (session && profile && profile.onboarded === false && segments[0] !== 'onboarding') {
      // New account: pick interests first, so the feed is personal from day one.
      // (Databases without 29_growth.sql have no `onboarded` — undefined skips this.)
      router.replace('/onboarding');
    }
  }, [session, profile, loading, segments, pathname]);
}

function RootNavigator() {
  const { loading } = useAuth();
  useProtectedRoute();
  useAudioUnlock();
  useHideSplash(loading);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111511' }}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    {/* Dark icons on the light app background (no-op on web). */}
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        headerLeft: () => <HeaderBack />,
        headerBackVisible: false,
        headerShadowVisible: false,
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontSize: 16, fontWeight: '700', color: colors.ink },
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="reset-password" options={{ headerShown: true, title: t('New password') }} />
      <Stack.Screen name="post/[id]" options={{ headerShown: true, title: t('Details') }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: t('Chat') }} />
      <Stack.Screen name="event-chat/[postId]" options={{ headerShown: true, title: t('Event chat') }} />
      <Stack.Screen name="coach" options={{ headerShown: true, title: t('AI Career Coach') }} />
      <Stack.Screen name="legal" options={{ headerShown: true, title: t('Privacy & Terms') }} />
      <Stack.Screen name="my-posts" options={{ headerShown: true, title: t('My posts') }} />
      <Stack.Screen name="my-applications" options={{ headerShown: true, title: t('My applications') }} />
      <Stack.Screen name="applicants/[postId]" options={{ headerShown: true, title: t('Applicants') }} />
      <Stack.Screen name="passport" options={{ headerShown: true, title: t('Student Passport') }} />
      <Stack.Screen name="badge/[postId]" options={{ headerShown: true, title: t('Event medal') }} />
      <Stack.Screen name="user/[id]" options={{ headerShown: true, title: t('Profile') }} />
      <Stack.Screen name="search" options={{ headerShown: true, title: t('Find people') }} />
      <Stack.Screen name="friends/[id]" options={{ headerShown: true, title: t('Friends') }} />
      <Stack.Screen name="leaderboard" options={{ headerShown: true, title: t('Ranking') }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, title: t('Notifications') }} />
      <Stack.Screen name="event-edit/[id]" options={{ headerShown: true, title: t('Edit event') }} />
      <Stack.Screen name="news/create" options={{ headerShown: true, title: t('Post news') }} />
      <Stack.Screen name="news/[id]" options={{ headerShown: true, title: t('News') }} />
      <Stack.Screen name="team-apply/[postId]" options={{ headerShown: true, title: t('Apply as a team') }} />
      <Stack.Screen name="team/create" options={{ headerShown: true, title: t('Create team') }} />
      <Stack.Screen name="team/[id]" options={{ headerShown: true, title: t('Team') }} />
      <Stack.Screen name="accepted/[postId]" options={{ headerShown: true, title: t('Accepted participants') }} />
      <Stack.Screen name="end/[postId]" options={{ headerShown: true, title: t('End event') }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="saved" options={{ headerShown: true, title: t('Saved events') }} />
      <Stack.Screen name="scan/[postId]" options={{ headerShown: true, title: t('Check-in') }} />
      <Stack.Screen name="dashboard" options={{ headerShown: true, title: t('Event stats') }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('Settings') }} />
      <Stack.Screen name="review/[postId]" options={{ headerShown: true, title: t('Rate this event') }} />
    </Stack>
    <NotificationToast />
    <InstallPrompt />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <AuthProvider>
          <BadgeProvider>
            <RootNavigator />
          </BadgeProvider>
        </AuthProvider>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
