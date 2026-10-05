import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Platform, Easing } from 'react-native';
import { colors, radius } from '../lib/theme';

// A soft pulsing placeholder. Used instead of spinners so a loading screen
// already has the shape of the content that's about to appear.
export function Shimmer({ style }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0.45, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.block, style, { opacity: pulse }]} />;
}

// Placeholder shaped like a feed card.
export function CardSkeleton({ withImage }) {
  return (
    <View style={styles.card}>
      {withImage && <Shimmer style={{ height: 150, borderRadius: 0, marginBottom: 12, marginHorizontal: -16, marginTop: -16 }} />}
      <Shimmer style={{ width: 90, height: 18, borderRadius: 999 }} />
      <Shimmer style={{ width: '80%', height: 16, marginTop: 12 }} />
      <Shimmer style={{ width: '55%', height: 12, marginTop: 8 }} />
      <Shimmer style={{ width: '35%', height: 12, marginTop: 10 }} />
    </View>
  );
}

// Placeholder shaped like a list row with an avatar.
export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <Shimmer style={{ width: 44, height: 44, borderRadius: 22 }} />
      <View style={{ flex: 1 }}>
        <Shimmer style={{ width: '45%', height: 14 }} />
        <Shimmer style={{ width: '70%', height: 11, marginTop: 8 }} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 4, type = 'card', withImage }) {
  return (
    <View style={{ padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        type === 'row' ? <RowSkeleton key={i} /> : <CardSkeleton key={i} withImage={withImage} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: '#dfe5d8', borderRadius: 8 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
});
