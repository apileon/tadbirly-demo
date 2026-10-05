import React, { useEffect } from 'react';
import { View, ActivityIndicator, TouchableOpacity, Text, Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../lib/auth';
import { BadgeProvider } from '../lib/badges';
import { colors } from '../lib/theme';
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
      activeOpacity={0.8}
      style={{
        backgroundColor: colors.brand,
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 14,
        marginRight: 12,
        marginLeft: 4,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 14.5, fontWeight: '800' }}>‹ Back</Text>
    </TouchableOpacity>
  );
}

// Redirect users into or out of the app depending on auth state.
function useProtectedRoute() {
  const { session, loading } = useAuth();
  const segments = useSegments();
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
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);
}

function RootNavigator() {
  const { loading } = useAuth();
  useProtectedRoute();
  useAudioUnlock();
  useHideSplash(loading);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink }}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    {/* Dark icons on the light app background (no-op on web). */}
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, headerLeft: () => <HeaderBack />, headerBackVisible: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="reset-password" options={{ headerShown: true, title: 'New password' }} />
      <Stack.Screen name="post/[id]" options={{ headerShown: true, title: 'Details' }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: 'Chat' }} />
      <Stack.Screen name="event-chat/[postId]" options={{ headerShown: true, title: 'Event chat' }} />
      <Stack.Screen name="coach" options={{ headerShown: true, title: 'AI Career Coach' }} />
      <Stack.Screen name="legal" options={{ headerShown: true, title: 'Privacy & Terms' }} />
      <Stack.Screen name="my-posts" options={{ headerShown: true, title: 'My posts' }} />
      <Stack.Screen name="my-applications" options={{ headerShown: true, title: 'My applications' }} />
      <Stack.Screen name="applicants/[postId]" options={{ headerShown: true, title: 'Applicants' }} />
      <Stack.Screen name="passport" options={{ headerShown: true, title: 'Student Passport' }} />
      <Stack.Screen name="badge/[postId]" options={{ headerShown: true, title: 'Event medal' }} />
      <Stack.Screen name="user/[id]" options={{ headerShown: true, title: 'Profile' }} />
      <Stack.Screen name="search" options={{ headerShown: true, title: 'Find people' }} />
      <Stack.Screen name="friends/[id]" options={{ headerShown: true, title: 'Friends' }} />
      <Stack.Screen name="leaderboard" options={{ headerShown: true, title: '🏆 Ranking' }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, title: '🔔 Notifications' }} />
      <Stack.Screen name="event-edit/[id]" options={{ headerShown: true, title: 'Edit event' }} />
      <Stack.Screen name="news/create" options={{ headerShown: true, title: 'Post news' }} />
      <Stack.Screen name="news/[id]" options={{ headerShown: true, title: 'News' }} />
      <Stack.Screen name="team-apply/[postId]" options={{ headerShown: true, title: 'Apply as a team' }} />
      <Stack.Screen name="team/create" options={{ headerShown: true, title: 'Create team' }} />
      <Stack.Screen name="team/[id]" options={{ headerShown: true, title: 'Team' }} />
      <Stack.Screen name="accepted/[postId]" options={{ headerShown: true, title: 'Accepted participants' }} />
      <Stack.Screen name="end/[postId]" options={{ headerShown: true, title: 'End event' }} />
    </Stack>
    <NotificationToast />
    <InstallPrompt />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <BadgeProvider>
          <RootNavigator />
        </BadgeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
