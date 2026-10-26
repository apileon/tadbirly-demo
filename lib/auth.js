import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { clearCache } from './cache';
import { initPush, pushLogin, pushLogout } from './push';

const AuthContext = createContext({
  session: null,
  uid: null,
  profile: null,
  profileReady: true,
  loading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
});

// A profile request that never answers mustn't keep anyone on the spinner.
const PROFILE_TIMEOUT_MS = 10000;

function fetchProfile(userId) {
  const req = supabase.from('profiles').select('*').eq('id', userId).single();
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), PROFILE_TIMEOUT_MS);
  });
  return Promise.race([req, timeout]).catch((e) => ({ data: null, error: e || { message: 'failed' } }));
}

// Same person, same token → keep the old object, so nothing re-renders when
// Supabase re-announces the session it already had (tab focus, INITIAL_SESSION).
function sameSession(a, b) {
  return a === b || (!!a && !!b && a.access_token === b.access_token && a.user?.id === b.user?.id);
}

export function AuthProvider({ children }) {
  const [session, setSessionState] = useState(null);
  const [profile, setProfile] = useState(null);
  // Whose profile request has finished (with or without a row). Until it
  // matches the signed-in user, routing waits — so a new account goes straight
  // to onboarding instead of the feed flashing first.
  const [profileUid, setProfileUid] = useState(null);
  const [sessionKnown, setSessionKnown] = useState(false);
  // Who the latest loadProfile() call was for. A slow answer to an older call
  // (say, one from just before signing out) must not land on top of it.
  const wanted = useRef(null);

  const uid = session?.user?.id ?? null;
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const setSession = useCallback((next) => {
    setSessionState((prev) => (sameSession(prev, next) ? prev : next));
  }, []);

  const loadProfile = useCallback(async (userId) => {
    wanted.current = userId ?? null;
    if (!userId) {
      setProfile(null);
      setProfileUid(null);
      return;
    }
    const { data, error } = await fetchProfile(userId);
    if (wanted.current !== userId) return;
    if (error) {
      // One flaky request used to null the profile, which hid an organizer's
      // tabs until reload — so keep what we have, as long as it's this same
      // person's.
      setProfile((prev) => (prev?.id === userId ? prev : null));
    } else {
      setProfile(data ?? null);
    }
    setProfileUid(userId);
  }, []);

  useEffect(() => {
    let mounted = true;
    initPush();

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const s = data.session ?? null;
      setSession(s);
      if (s?.user?.id) pushLogin(s.user.id);
      if (wanted.current !== (s?.user?.id ?? null) || !s) await loadProfile(s?.user?.id);
      if (mounted) setSessionKnown(true);
    }, () => { if (mounted) setSessionKnown(true); });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      const nextUid = newSession?.user?.id ?? null;
      const apply = () => {
        if (!mounted) return;
        if (nextUid) pushLogin(nextUid);
        setSession(newSession ?? null);
        // Only a new person (or changed account details) needs a fresh profile.
        // The hourly TOKEN_REFRESHED, and the SIGNED_IN Supabase repeats when
        // the tab regains focus, used to refetch it — and re-render every
        // screen — each time.
        if (nextUid !== wanted.current || event === 'USER_UPDATED') {
          // Deferred: Supabase holds its auth lock while this callback runs,
          // and a query awaited inside it can deadlock.
          setTimeout(() => { if (mounted) loadProfile(nextUid); }, 0);
        }
      };
      // Never let one account's cached data show to the next person on this device.
      if (event === 'SIGNED_OUT') {
        pushLogout();
        clearCache().catch(() => {}).finally(apply);
      } else {
        apply();
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, setSession]);

  const profileReady = !uid || profileUid === uid;

  // The first answer (session + that person's profile) ends the start-up
  // spinner; later sign-ins don't bring it back — routing just waits for
  // profileReady instead.
  const booted = useRef(false);
  if (sessionKnown && profileReady) booted.current = true;
  const loading = !booted.current;

  // Stable across token refreshes: reads the current user through a ref.
  const refreshProfile = useCallback(() => loadProfile(uidRef.current), [loadProfile]);
  // 'local': log out of THIS device only. The default ('global') revoked the
  // account's sessions everywhere — logging out on a laptop also logged the
  // phone out and silently stopped its push notifications.
  const signOut = useCallback(() => supabase.auth.signOut({ scope: 'local' }), []);

  const value = useMemo(() => ({
    session,
    // Prefer `uid` in effect/callback dependencies: it only changes when the
    // person changes, while `session` is replaced on every token refresh.
    uid,
    profile,
    profileReady,
    loading,
    refreshProfile,
    signOut,
  }), [session, uid, profile, profileReady, loading, refreshProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
