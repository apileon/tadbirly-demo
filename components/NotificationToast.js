import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';
import { ICONS } from '../lib/notifications';
import { ping, buzz, notificationState } from '../lib/feedback';
import { openLink, notificationLink } from '../lib/links';
import { setPushRouter, onPushForeground } from '../lib/push';

const isWeb = Platform.OS === 'web';

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
      for (const [k, t] of recent.current) if (now - t > DEDUPE_MS) recent.current.delete(k);
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
        <Text style={styles.icon}>{ICONS[item.type] ?? '🔔'}</Text>
        <Text style={styles.text} numberOfLines={2}>
          <Text style={styles.title}>{item.title}</Text>
          {item.body ? `\n${item.body}` : ''}
        </Text>
        <TouchableOpacity onPress={(e) => { e?.stopPropagation?.(); hide(); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.close}>✕</Text>
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
  icon: { fontSize: 20 },
  text: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 12.5, lineHeight: 17 },
  title: { color: '#fff', fontWeight: '800', fontSize: 14 },
  close: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '700', paddingLeft: 4 },
});
