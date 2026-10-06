import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';
import { t } from '../lib/i18n';

// Star rating. With onChange it's an input, without it just shows the value
// (halves included).
export default function Stars({ value = 0, onChange, size = 16, gap = 2 }) {
  return (
    <View style={{ flexDirection: 'row', gap }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const name = value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline';
        const star = <Ionicons name={name} size={size} color={value >= n - 0.5 ? colors.warn : colors.faint} />;
        return onChange ? (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n)}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityLabel={t('{n} stars', { n })}
          >
            {star}
          </TouchableOpacity>
        ) : <View key={n}>{star}</View>;
      })}
    </View>
  );
}
