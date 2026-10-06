import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';
import { t } from '../lib/i18n';
import { ping, buzz, notificationState } from '../lib/feedback';
import { openLink, notificationLink } from '../lib/links';
import { setPushRouter, onPushForeground } from '../lib/push';

const isWeb = Platform.OS === 'web';

// Ionicons per notification type (lib/notifications' ICONS holds emoji).
const TYPE_ICONS = {
  message: 'chatbubbles-outline',
  friend_request: 'person-add-outline',
  friend_accepted: 'people-outline',
  new_application: 'document-text-outline',
  accepted: 'checkmark-circle',
  rejected: 'close-circle-outline',
  team_invite: 'people-outline',
  team_request: 'people-outline',
  team_joined: 'people-outline',
  team_approved: 'checkmark-circle',
  team_rejected: 'close-circle-outline',
  team_application: 'people-outline',
  team_accepted: 'checkmark-circle',
  award: 'medal-outline',
  reminder: 'alarm-outline',
};

// Natively the same notification can reach us twice — the realtime row and,
// a moment later, the OneSignal push (shown here instead of a system banner).
// One toast per title+body within this window.
const DEDUPE_MS = 20000;

// Slides a banner in whenever a notification arrives while the app is open.
// In the phone app it also opens tapped pushes (it lives inside the navigator).
export default function NotificationToast() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // The toast floats over every screen, so it has to know whether that's a
  // tab or a stacked screen to open a tab link correctly (see lib/links.js).
  const segments = useSegments();
  // Read through refs so the callbacks below aren't rebuilt (and the realtime
  // channel resubscribed) on every navigation.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const [item, setItem] = useState(null);
  const y = useRef(new Animated.Value(-160)).current;
  const timer = useRef(null);
  const recent = useRef(new Map()); // title+body → shown at (native only)

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.timing(y, { toValue: -160, duration: 220, useNativeDriver: !isWeb })
      .start(() => setItem(null));
  }, [y]);

  const show = useCallback((n) => {
    // Don't announce a message from the very chat that's on screen — you can
    // already see it arrive. Everything else still toasts normally.
    if (n.link && pathRef.current === n.link) return;

    if (!isWeb) {
      const key = `${n.title ?? ''}\n${n.body ?? ''}`;
      const now = Date.now();
      for (const [k, at] of recent.current) if (now - at > DEDUPE_MS) recent.current.delete(k);
      if (recent.current.has(key)) return;
      recent.current.set(key, now);
    }

    // Sound + vibration always.
    ping();
    buzz();
    // Web: in the background with notifications allowed, the push (OneSignal)
    // already puts this on the lock screen / in the notification centre. A
    // second, local OS notification from here was a duplicate — and the
    // banner would only be stale by the time you came back.
    // (Natively there's no `document`; OneSignal handles the background.)
    const hidden = isWeb && typeof document !== 'undefined' && document.hidden;
    if (hidden && notificationState() === 'granted') return;
    clearTimeout(timer.current);
    setItem(n);
    Animated.spring(y, { toValue: 0, useNativeDriver: !isWeb, friction: 9, tension: 60 }).start();
    timer.current = setTimeout(hide, 5000);
  }, [y, hide]);

  useEffect(() => {
    if (!uid) return undefined;
    const channel = supabase
      .channel(`toast:${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        (payload) => show(payload.new),
      )
      .subscribe();
    return () => { clearTimeout(timer.current); supabase.removeChannel(channel); };
  }, [uid, show]);

  // Native: a push arriving while the app is open shows here, not as a
  // system banner (lib/push.native.js holds the banner back while this
  // listens). Covers re-alerts ("4 new messages") too, which have no new row.
  useEffect(() => {
    if (isWeb || !uid) return undefined;
    return onPushForeground((p) => show(p));
  }, [uid, show]);

  // Native: opening a tapped push. Waits until signed in and past the
  // start-up redirect ('/' → tabs), so the link isn't replaced by it.
  const routerReady = !isWeb && !!uid && !!segments[0] && segments[0] !== '(auth)';
  useEffect(() => {
    if (!routerReady) return undefined;
    return setPushRouter((link) => openLink(routerRef.current, link, segmentsRef.current));
  }, [routerReady]);

  if (!item) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { paddingTop: isWeb ? 14 : Math.max(insets.top, 20) + 8 },
        { transform: [{ translateY: y }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.card}
        onPress={() => { const l = notificationLink(item); hide(); openLink(router, l, segments); }}
      >
        <Ionicons name={TYPE_ICONS[item.type] ?? 'notifications-outline'} size={20} color={colors.bg} />
        <Text style={styles.text} numberOfLines={2}>
          <Text style={styles.title}>{item.title}</Text>
          {item.body ? `\n${item.body}` : ''}
        </Text>
        <TouchableOpacity
          onPress={(e) => { e?.stopPropagation?.(); hide(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('Dismiss')}
          style={styles.close}
        >
          <Ionicons name="close" size={18} color={colors.faint} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, zIndex: 999 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: colors.ink, borderRadius: radius.lg, paddingVertical: 13, paddingHorizontal: 15,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    maxWidth: 560, alignSelf: 'center', width: '100%',
  },
  // The card is ink-coloured (dark in light mode, light in dark mode), so its
  // text uses the page background colour family to stay readable in both.
  text: { flex: 1, color: colors.line, fontSize: 12.5, lineHeight: 17 },
  title: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  close: { paddingLeft: 4 },
});
