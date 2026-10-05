import React from 'react';
import { View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { useBadges, portalCount } from '../../lib/badges';
import { IconDot } from '../../components/Dot';

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
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.line, height: 52 + bottomPad, paddingBottom: bottomPad, paddingTop: 6, backgroundColor: colors.card },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {/* Feed — participants only */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" color={color} size={size} />,
        }}
      />
      {/* Post event — organizers only */}
      <Tabs.Screen
        name="create"
        options={{
          title: 'Post event',
          href: isOrg ? '/create' : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size + 8} />,
        }}
      />
      {/* Team Builder — participants only */}
      <Tabs.Screen
        name="team-builder"
        options={{
          title: 'Teams',
          href: isOrg ? null : '/team-builder',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} />,
        }}
      />
      {/* My events — organizers only */}
      <Tabs.Screen
        name="my-events"
        options={{
          title: 'My events',
          href: isOrg ? '/my-events' : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} />,
        }}
      />
      {/* Portal — both (content differs by role) */}
      <Tabs.Screen
        name="portal"
        options={{
          title: 'Portal',
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="albums-outline" color={color} size={size} n={portalCount(badges)} />
          ),
        }}
      />
      {/* Chats — participants (organizers reach chats from applicants) */}
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Social',
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="chatbubbles-outline" color={color} size={size} n={badges.messages} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
