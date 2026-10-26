import React from 'react';
import { View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { useBadges, portalCount } from '../../lib/badges';
import { IconDot } from '../../components/Dot';
import { prefersReducedMotion } from '../../components/Motion';
import { t } from '../../lib/i18n';

// A tab icon that can carry a red dot in its top-right corner.
function TabIcon({ name, color, size, n = 0 }) {
  return (
    <View>
      <Ionicons name={name} color={color} size={size} />
      <IconDot n={n} />
    </View>
  );
}

export default function TabsLayout() {
  const { profile } = useAuth();
  const isOrg = profile?.role === 'organizer';
  const { badges } = useBadges();
  // Native: lift the tab bar above the iPhone home indicator / Android gesture
  // bar (the app draws edge-to-edge). Web keeps its fixed 60px bar (8px pad).
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 8 : Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Tabs cross-fade instead of cutting (skipped with "Reduce motion").
        animation: prefersReducedMotion() ? 'none' : 'fade',
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.line, height: 56 + bottomPad, paddingBottom: bottomPad, paddingTop: 7, backgroundColor: colors.card },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.1 },
      }}
    >
      {/* Feed — participants only */}
      <Tabs.Screen
        name="index"
        options={{
          title: t('Feed'),
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'compass' : 'compass-outline'} color={color} size={size - 1} />,
        }}
      />
      {/* Post event — organizers only */}
      <Tabs.Screen
        name="create"
        options={{
          title: t('Post event'),
          href: isOrg ? '/create' : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size + 8} />,
        }}
      />
      {/* Old student-built teams: no longer in the bar (organizers make the
          teams now, see app/tournament). The route stays for old links. */}
      <Tabs.Screen
        name="team-builder"
        options={{
          title: t('Teams'),
          href: null,
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'people' : 'people-outline'} color={color} size={size - 1} />,
        }}
      />
      {/* My events — organizers only */}
      <Tabs.Screen
        name="my-events"
        options={{
          title: t('My events'),
          href: isOrg ? '/my-events' : null,
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} color={color} size={size - 1} />,
        }}
      />
      {/* Portal — both (content differs by role) */}
      <Tabs.Screen
        name="portal"
        options={{
          title: t('Portal'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? 'albums' : 'albums-outline'} color={color} size={size - 1} n={portalCount(badges)} />
          ),
        }}
      />
      {/* Chats — participants (organizers reach chats from applicants) */}
      <Tabs.Screen
        name="chats"
        options={{
          title: t('Social'),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} size={size - 1} n={badges.messages} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('Profile'),
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'person' : 'person-outline'} color={color} size={size - 1} />,
        }}
      />
    </Tabs>
  );
}
