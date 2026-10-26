import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, TouchableOpacity, Text, Platform } from 'react-native';
import { Stack, useRouter, useSegments, usePathname, useNavigationContainerRef } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../lib/auth';
import { BadgeProvider } from '../lib/badges';
import { colors, isDark } from '../lib/theme';
import { LocaleProvider, t, useLocale } from '../lib/i18n';
import NotificationToast from '../components/NotificationToast';
import InstallPrompt from '../components/InstallPrompt';
import { ToastHost } from '../components/Toast';
import { FadeIn, prefersReducedMotion } from '../components/Motion';
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
      accessibilityLabel={t('Back')}
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

// Reachable without logging in: password reset (the link arrives signed out,
// signs the user in, and still needs this screen to set the new password),
// and the legal pages (store reviewers and listings link to them).
const PUBLIC_ROUTES = ['(auth)', 'reset-password', 'legal', 'privacy'];

// Redirect users into or out of the app depending on auth state.
// A shared event link opened while signed out: remembered here and opened
// right after login, instead of dropping the student on the feed.
let pendingPath = null;

function useProtectedRoute() {
  const { uid, profile, profileReady, loading } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  // New account: pick interests first, so the feed is personal from day one.
  // (Databases without 29_growth.sql have no `onboarded` — undefined skips this.)
  const needsOnboarding = !!uid && profileReady && profile?.onboarded === false;

  useEffect(() => {
    if (loading) return;
    if (PUBLIC_ROUTES.includes(segments[0]) && segments[0] !== '(auth)') return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!uid) {
      if (inAuthGroup) return;
      if (pathname && pathname !== '/' && !pathname.startsWith('/login')) pendingPath = pathname;
      router.replace('/(auth)/login');
      return;
    }
    // Signed in, but this person's profile hasn't arrived yet: decide nothing
    // until it has (ScreenGate keeps the screens blank meanwhile).
    if (!profileReady) return;
    if (needsOnboarding) {
      if (segments[0] !== 'onboarding') router.replace('/onboarding');
      return;
    }
    if (inAuthGroup) {
      const next = pendingPath;
      pendingPath = null;
      router.replace(next || '/(tabs)');
    }
  }, [uid, profileReady, needsOnboarding, loading, segments, pathname]);
}

// Wraps every screen of the root stack (Stack's screenLayout).
//  • Nothing behind the login is mounted until we know who's signed in and
//    have their profile — no feed fetching for a moment before the redirect
//    to /onboarding (or to the login).
//  • A language change re-draws the screens in place: keyed by locale, the
//    screen content re-mounts, while the providers above (auth, badges,
//    realtime) and the navigation stack stay. Login, sign-up and onboarding
//    re-render through useLocale() instead, so typed text and the current
//    step survive the switch.
const NO_REMOUNT = new Set(['(auth)', 'onboarding']);

function Blank() {
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}

function ScreenGate({ name, children }) {
  const { uid, profile, profileReady } = useAuth();
  const { locale } = useLocale();
  if (!PUBLIC_ROUTES.includes(name)) {
    if (!uid || !profileReady) return <Blank />;
    if (profile?.onboarded === false && name !== 'onboarding') return <Blank />;
  }
  // Web has no native screen animation, so screens softly fade in instead of
  // popping. (Phones use the native slide, see the Stack's screenOptions.)
  const body = Platform.OS === 'web' ? <FadeIn>{children}</FadeIn> : children;
  if (NO_REMOUNT.has(name)) return body;
  return <React.Fragment key={locale}>{body}</React.Fragment>;
}

const screenLayout = ({ route, children }) => <ScreenGate name={route.name}>{children}</ScreenGate>;

// Re-mounting the screens on a language change can, in rare cases, drop a
// nested navigator's position (e.g. which tab was open). Put it back.
function navShape(state) {
  if (!state || !Array.isArray(state.routes)) return null;
  return {
    i: state.index ?? 0,
    r: state.routes.map((r) => [r.name, r.params ? JSON.stringify(r.params) : '', navShape(r.state)]),
  };
}

function useKeepNavigationOnLocaleChange(locale) {
  const nav = useNavigationContainerRef();
  const prev = useRef(locale);
  const snapshot = useRef(null);
  if (prev.current !== locale) {
    prev.current = locale;
    try { snapshot.current = nav?.getRootState?.() ?? null; } catch { snapshot.current = null; }
  }
  useEffect(() => {
    const before = snapshot.current;
    snapshot.current = null;
    if (!before) return undefined;
    const timer = setTimeout(() => {
      try {
        const now = nav?.getRootState?.();
        if (now && JSON.stringify(navShape(now)) !== JSON.stringify(navShape(before))) nav.resetRoot(before);
      } catch { /* leave it as it is */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [locale, nav]);
}

function RootNavigator() {
  const { loading } = useAuth();
  // Consumed here so a language change re-renders the header titles below and
  // the overlays (toasts, banners) — without re-mounting any provider.
  const { locale } = useLocale();
  useProtectedRoute();
  useKeepNavigationOnLocaleChange(locale);
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
      screenLayout={screenLayout}
      screenOptions={{
        headerShown: false,
        // One slide on both phones (Android's default is a different, bottom
        // fade); none at all with "Reduce motion".
        animation: prefersReducedMotion() ? 'none' : (Platform.OS === 'android' ? 'slide_from_right' : 'default'),
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
      <Stack.Screen name="tournament/[postId]" options={{ headerShown: true, title: t('Teams & matches') }} />
      <Stack.Screen name="accepted/[postId]" options={{ headerShown: true, title: t('Accepted participants') }} />
      <Stack.Screen name="end/[postId]" options={{ headerShown: true, title: t('End event') }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="saved" options={{ headerShown: true, title: t('Saved events') }} />
      <Stack.Screen name="scan/[postId]" options={{ headerShown: true, title: t('Check-in') }} />
      <Stack.Screen name="dashboard" options={{ headerShown: true, title: t('Event stats') }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('Settings') }} />
      <Stack.Screen name="review/[postId]" options={{ headerShown: true, title: t('Rate this event') }} />
      <Stack.Screen name="suggest" options={{ headerShown: true, title: t('Suggest an opportunity') }} />
      <Stack.Screen name="admin/review" options={{ headerShown: true, title: t('Suggestions') }} />
    </Stack>
    <NotificationToast />
    <InstallPrompt />
    <ToastHost />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* LocaleProvider only passes the language down (no re-keying), so a
          switch never re-mounts auth or badges or their realtime channels. */}
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
