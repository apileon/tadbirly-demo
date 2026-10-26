import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, isDark, radius, shadow } from '../lib/theme';
import { t } from '../lib/i18n';

// ---------------------------------------------------------------------------
//  In-app toasts and (web) dialogs.
//
//    toast('Saved')                                  → small banner, ~2.5 s
//    toast('Could not save', { type: 'error', body }) → with a second line
//
//  <ToastHost /> is mounted once, in app/_layout.js. Toasts raised before it
//  mounts wait for it. lib/notify.js routes short, informational notify()
//  calls here instead of a blocking browser alert, and uses the dialog below
//  for confirmAsync() and for messages that need reading on the web.
// ---------------------------------------------------------------------------

const isWeb = Platform.OS === 'web';
const MAX_VISIBLE = 2;

let nextId = 1;
let pushToast = null;          // set while a host is mounted
let pendingToasts = [];

export function toast(message, opts = {}) {
  const title = String(message ?? '').trim();
  const body = String(opts.body ?? '').trim();
  if (!title && !body) return;
  const item = {
    id: nextId++,
    title: title || body,
    body: title ? body : '',
    type: ['success', 'error', 'info'].includes(opts.type) ? opts.type : 'info',
    // Long enough to read the second line, never so long it lingers.
    duration: opts.duration ?? Math.min(5000, 2500 + (title ? body.length : 0) * 25),
  };
  if (pushToast) pushToast(item);
  else pendingToasts = [...pendingToasts, item].slice(-MAX_VISIBLE);
}

// --- Dialog (web) -----------------------------------------------------------
// showDialog({ title, body, buttons: [{ text, style: 'cancel'|'primary'|'destructive', value }] })
// resolves with the pressed button's value (cancel / backdrop / Escape → the
// cancel button's value, or undefined). Returns null when no host is mounted,
// so the caller can fall back to the browser's own dialog.
let pushDialog = null;

export function showDialog(dialog) {
  if (!pushDialog) return null;
  return new Promise((resolve) => pushDialog({ ...dialog, id: nextId++, resolve }));
}

const ICONS = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};
// The toast is ink-coloured (dark on the light theme, light on the dark
// theme), so its accents are picked for contrast against that.
const ACCENT = {
  success: isDark ? colors.brand : colors.lime,
  error: isDark ? colors.danger : '#ff8577',
  info: isDark ? colors.muted : colors.faint,
};

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [dialogs, setDialogs] = useState([]);
  const top = useWebViewportTop();

  useEffect(() => {
    pushToast = (item) => setItems((xs) => {
      // The same message twice in a row (a double tap) shows once, restarted.
      const last = xs[xs.length - 1];
      if (last && last.title === item.title && last.body === item.body) return [...xs.slice(0, -1), item];
      return [...xs, item].slice(-MAX_VISIBLE);
    });
    if (pendingToasts.length) {
      const waiting = pendingToasts;
      pendingToasts = [];
      waiting.forEach((it) => pushToast(it));
    }
    if (isWeb) pushDialog = (d) => setDialogs((xs) => [...xs, d]);
    return () => { pushToast = null; pushDialog = null; };
  }, []);

  const remove = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const closeDialog = useCallback((d, value) => {
    setDialogs((xs) => xs.filter((x) => x.id !== d.id));
    d.resolve(value);
  }, []);

  const offset = isWeb ? top + 10 : Math.max(insets.top, 20) + 6;

  return (
    <>
      {items.length ? (
        <View pointerEvents="box-none" style={[styles.wrap, { top: offset }]}>
          {items.map((it) => <ToastItem key={it.id} item={it} onDone={remove} />)}
        </View>
      ) : null}
      {isWeb && dialogs.length ? <Dialog key={dialogs[0].id} dialog={dialogs[0]} onClose={closeDialog} /> : null}
    </>
  );
}

function ToastItem({ item, onDone }) {
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);
  const gone = useRef(false);

  const hide = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    clearTimeout(timer.current);
    Animated.timing(anim, {
      toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: !isWeb,
    }).start(() => onDone(item.id));
  }, [anim, item.id, onDone]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb,
    }).start();
    timer.current = setTimeout(hide, item.duration);
    return () => clearTimeout(timer.current);
  }, [anim, hide, item.duration]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] });
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY }, { scale }], width: '100%', alignItems: 'center' }}>
      <Pressable
        onPress={hide}
        accessibilityRole={isWeb ? 'alert' : 'button'}
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [styles.toast, !!item.body && styles.toastTall, pressed && { opacity: 0.9 }]}
      >
        <Ionicons name={ICONS[item.type]} size={20} color={ACCENT[item.type]} />
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          {item.body ? <Text style={styles.body} numberOfLines={3}>{item.body}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function Dialog({ dialog, onClose }) {
  const anim = useRef(new Animated.Value(0)).current;
  const buttons = dialog.buttons?.length ? dialog.buttons : [{ text: t('OK'), style: 'primary', value: true }];
  const cancel = buttons.find((b) => b.style === 'cancel');
  const main = [...buttons].reverse().find((b) => b.style !== 'cancel') ?? buttons[buttons.length - 1];

  const close = useCallback((value) => onClose(dialog, value), [dialog, onClose]);
  const dismiss = useCallback(() => close(cancel ? cancel.value : main.value), [cancel, main, close]);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim]);

  // Enter confirms, like a native dialog — except a destructive one, which
  // needs a deliberate click. (Escape → onRequestClose.)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return undefined;
    if (main.style === 'destructive') return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(main.value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, main]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        {/* A sibling behind the card, not a wrapper: on the web a button may
            not contain the dialog's own buttons. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel={t('Close')} />
        <Animated.View accessibilityRole="alert" style={[styles.card, { opacity: anim, transform: [{ scale }] }]}>
          {dialog.title ? <Text style={styles.dTitle}>{dialog.title}</Text> : null}
          {dialog.body ? <Text style={[styles.dBody, !dialog.title && { marginTop: 0 }]}>{dialog.body}</Text> : null}
          <View style={styles.dRow}>
            {buttons.map((b, i) => {
              const kind = b.style === 'cancel' ? 'cancel' : b.style === 'destructive' ? 'destructive' : 'primary';
              return (
                <TouchableOpacity
                  key={`${b.text}-${i}`}
                  onPress={() => close(b.value)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  style={[styles.dBtn, kind === 'cancel' ? styles.dBtnGhost : { backgroundColor: kind === 'destructive' ? colors.danger : colors.brand }]}
                >
                  <Text style={[styles.dBtnText, { color: kind === 'cancel' ? colors.ink : colors.onBrand }]}>{b.text}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Mobile browsers scroll the page under the on-screen keyboard; keep the
// toast inside what's actually visible.
function useWebViewportTop() {
  const [top, setTop] = useState(0);
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined' || !window.visualViewport) return undefined;
    const vv = window.visualViewport;
    const update = () => setTop(Math.max(0, Math.round(vv.offsetTop || 0)));
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return top;
}

const styles = StyleSheet.create({
  wrap: {
    position: isWeb ? 'fixed' : 'absolute', left: 0, right: 0,
    paddingHorizontal: 14, alignItems: 'center', gap: 8, zIndex: 1000, elevation: 12,
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.ink, borderRadius: radius.pill,
    paddingVertical: 11, paddingLeft: 14, paddingRight: 18,
    maxWidth: 480, minHeight: 44,
    ...shadow.lg,
    ...(isWeb ? { cursor: 'pointer', userSelect: 'none' } : null),
  },
  toastTall: { borderRadius: radius.xl, alignItems: 'flex-start', paddingVertical: 12 },
  title: { color: colors.bg, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  body: { color: colors.line, fontSize: 12.5, lineHeight: 17, marginTop: 1 },

  backdrop: {
    flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  card: {
    width: '100%', maxWidth: 400, backgroundColor: colors.card, borderRadius: radius.xl,
    paddingTop: 22, paddingHorizontal: 22, paddingBottom: 18, ...shadow.lg,
  },
  dTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  dBody: { fontSize: 14.5, lineHeight: 21, color: colors.body, marginTop: 8 },
  dRow: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  dBtn: { borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 18, minWidth: 88, alignItems: 'center' },
  dBtnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineStrong },
  dBtnText: { fontSize: 14.5, fontWeight: '700' },
});
