import React, { useEffect, useRef, useState, Children } from 'react';
import { Animated, Easing, View, PanResponder, Platform, AccessibilityInfo, StyleSheet } from 'react-native';

// Shared motion for the whole app: one spring, one fade, so every transition
// feels like the same app. Everything honours the OS "Reduce motion" setting.

const native = Platform.OS !== 'web';

// ---------------------------------------------------------------------------
//  Reduce motion
// ---------------------------------------------------------------------------
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; }).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => { reduceMotion = !!v; });

export function prefersReducedMotion() {
  return reduceMotion;
}

// The app's one spring: quick, no wobble.
export function springTo(value, toValue) {
  if (reduceMotion) { value.setValue(toValue); return; }
  Animated.spring(value, {
    toValue,
    useNativeDriver: native,
    stiffness: 260,
    damping: 30,
    mass: 1,
    overshootClamping: true,
  }).start();
}

// ---------------------------------------------------------------------------
//  FadeIn: content softly appears (opacity + a few px rise) when it mounts.
// ---------------------------------------------------------------------------
export function FadeIn({ children, style, duration = 220, rise = 6 }) {
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(v, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [v, duration]);
  return (
    <Animated.View
      style={[
        { flex: 1, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
//  Pager: side-by-side sections that slide (Chats ↔ News, Portal sections).
//
//    <Pager keys={['chats','news']} value={tab} onChange={setTab}>
//      <ChatsDivision />
//      <NewsDivision />
//    </Pager>
//
//  • Every page stays mounted, so switching never reloads or flickers.
//  • A horizontal swipe follows the finger and snaps; vertical scrolling in
//    the lists is untouched (the pager only takes a clearly sideways drag,
//    and inner horizontal scrollers like chip rows keep priority).
//  • Pages that are off screen are hidden from screen readers and taps.
// ---------------------------------------------------------------------------
export function Pager({ keys, value, onChange, children, style }) {
  const pages = Children.toArray(children);
  const index = Math.max(0, keys.indexOf(value));
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;      // translateX of the strip
  const live = useRef({ index, width, keys, onChange });
  live.current = { index, width, keys, onChange };

  // Follow the selected page (tap on the segmented control, or after a swipe).
  useEffect(() => {
    if (!width) return;
    springTo(x, -index * width);
  }, [index, width, x]);

  const pan = useRef(
    PanResponder.create({
      // Only a decidedly horizontal drag becomes a swipe.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderTerminationRequest: () => true,
      onPanResponderMove: (_, g) => {
        const { index: i, width: w, keys: k } = live.current;
        if (!w) return;
        let dx = g.dx;
        // Rubber-band at the first and last page.
        if ((i === 0 && dx > 0) || (i === k.length - 1 && dx < 0)) dx *= 0.3;
        x.setValue(-i * w + dx);
      },
      onPanResponderRelease: (_, g) => {
        const { index: i, width: w, keys: k, onChange: change } = live.current;
        if (!w) return;
        const far = Math.abs(g.dx) > w * 0.22;
        const fast = Math.abs(g.vx) > 0.35;
        let next = i;
        if ((far || fast) && g.dx < 0 && i < k.length - 1) next = i + 1;
        if ((far || fast) && g.dx > 0 && i > 0) next = i - 1;
        if (next !== i) change?.(k[next]);
        else springTo(x, -i * w);
      },
      onPanResponderTerminate: () => {
        const { index: i, width: w } = live.current;
        if (w) springTo(x, -i * w);
      },
    }),
  ).current;

  return (
    <View
      style={[styles.viewport, style]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w && w !== width) {
          x.setValue(-index * w);
          setWidth(w);
        }
      }}
      {...pan.panHandlers}
    >
      {/* The pages are mounted once and never re-mounted: sized in % so they
          lay out before we know the width, invisible for that first frame. */}
      <Animated.View
        style={[
          styles.strip,
          { width: `${pages.length * 100}%`, opacity: width ? 1 : 0, transform: [{ translateX: x }] },
        ]}
      >
        {pages.map((page, i) => {
          const shown = i === index;
          return (
            <View
              key={keys[i] ?? i}
              style={{ width: `${100 / pages.length}%`, height: '100%', pointerEvents: shown ? 'auto' : 'none' }}
              accessibilityElementsHidden={!shown}
              importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
              aria-hidden={!shown}
            >
              {page}
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  strip: { flex: 1, flexDirection: 'row' },
});
