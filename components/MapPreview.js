import React from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { colors, radius } from '../lib/theme';
import { mapEmbedUrl } from '../lib/discover';
import { canShowMap } from '../lib/native';

// A small OpenStreetMap with a pin. Free, no API key. On the web it's an
// iframe; in the phone apps a WebView (react-native-webview — needs an EAS
// build that includes it; older builds just don't show the map).
export default function MapPreview({ lat, lng, height = 180, style }) {
  const url = mapEmbedUrl(lat, lng);
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { height }, style]}>
        {React.createElement('iframe', {
          src: url,
          title: 'Map',
          loading: 'lazy',
          style: { border: 0, width: '100%', height: '100%' },
        })}
      </View>
    );
  }
  if (!canShowMap()) return null;
  let WebView = null;
  try { ({ WebView } = require('react-native-webview')); } catch { WebView = null; }
  if (!WebView) return null;
  return (
    <View style={[styles.wrap, { height }, style]}>
      <WebView source={{ uri: url }} style={{ flex: 1 }} scrollEnabled={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.line },
});
