import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { supabase } from './supabase';
import { useAuth } from './auth';

const EMPTY = {
  messages: 0,
  friend_requests: 0,
  team_invites: 0,
  team_requests: 0,
  team_approvals: 0,
  applications: 0,
  team_applications: 0,
  notifications: 0,
  // False until the first successful badge_counts() for this account, so a
  // screen can tell "really zero" from "not fetched yet".
  loaded: false,
};

const BadgeContext = createContext({ badges: EMPTY, loaded: false, refreshBadges: () => {} });

export function useBadges() {
  return useContext(BadgeContext);
}

// Derived groupings, so screens don't each re-invent the same sums.
// The Portal tab dot is exactly the sum of its three segment dots — anything
// counted in the tab but shown in no segment would be a dot nobody can clear.
export function portalCount(b) {
  return requestsCount(b) + teamsCount(b) + eventsCount(b);
}
export function requestsCount(b) {
  return b.friend_requests || 0;
}
export function teamsCount(b) {
  return (b.team_invites || 0) + (b.team_requests || 0) + (b.team_approvals || 0);
}
// Individual applications only: that's all Portal → Events lists. Pending team
// applications used to be counted too, and since that list never shows them,
// an organizer's Events dot could never go away.
export function eventsCount(b) {
  return b.applications || 0;
}

// One source of truth for every red dot. Refetches on navigation, when the app
// comes back to the foreground, and whenever one of YOUR notifications changes,
// so the dots stay correct without the screens polling.
// Same counts → keep the same object. badge_counts() runs on every
// navigation, and a fresh object each time re-rendered every consumer.
function sameBadges(a, b) {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

export function BadgeProvider({ children }) {
  const { uid } = useAuth();
  const [badges, setBadgesState] = useState(EMPTY);
  const setBadges = useCallback((next) => {
    setBadgesState((prev) => (sameBadges(prev, next) ? prev : next));
  }, []);
  const timer = useRef(null);
  const pathname = usePathname();
  // The account on screen right now, for answers that arrive after a switch.
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const refreshBadges = useCallback(async () => {
    if (!uid) { setBadges(EMPTY); return; }
    const { data, error } = await supabase.rpc('badge_counts');
    // Signed out (or into another account) while this was in flight: these
    // are the previous person's counts.
    if (uidRef.current !== uid) return;
    if (!error && data) setBadges({ ...EMPTY, ...data, loaded: true });
  }, [uid, setBadges]);

  // Coalesce bursts — ten messages arriving shouldn't mean ten round trips.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refreshBadges, 400);
  }, [refreshBadges]);

  // A different account starts from zero (and not-loaded), never from the
  // previous one's counts. Declared before the refresh below so it runs first.
  useEffect(() => { setBadges(EMPTY); }, [uid, setBadges]);

  // Re-check on every navigation. Cheap (one RPC), and it catches what no
  // notification announces — e.g. your own accept/decline elsewhere.
  useEffect(() => { refreshBadges(); }, [pathname, refreshBadges]);

  useEffect(() => {
    if (!uid) return;

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshBadges();
    });

    // One listener, on your own notification rows only. Everything a dot
    // counts for you arrives as a notification written or updated for you (a
    // message, friend request, team invite or request, an application), and
    // opening a chat marks its message notification read (mark_chat_read).
    // Before, five unfiltered listeners (messages, notifications, connections,
    // team_members, applications) made every open app receive every change in
    // the whole school.
    // Deletes are the exception: Postgres only sends a deleted row's id, so a
    // user_id filter can't match them — whoever clears notifications calls
    // refreshBadges() itself.
    const channel = supabase
      .channel(`badges:${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      sub?.remove?.();
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [uid, refreshBadges, scheduleRefresh]);

  // Stable identity — this provider re-renders on every navigation, and a
  // fresh object here would re-render every tab and list with it.
  const value = useMemo(
    () => ({ badges, loaded: badges.loaded, refreshBadges }),
    [badges, refreshBadges],
  );

  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

// Unread count + last activity per chat, for the bubbles in the chat list.
export async function unreadByChat() {
  const { data } = await supabase.rpc('unread_by_chat');
  const map = {};
  (data ?? []).forEach((r) => { map[r.chat_id] = { unread: Number(r.unread) || 0, lastAt: r.last_at }; });
  return map;
}
