import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { clearCache } from './cache';
import { initPush, pushLogin, pushLogout } from './push';

const AuthContext = createContext({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Who the latest loadProfile() call was for. A slow answer to an older call
  // (say, one from just before signing out) must not land on top of it.
  const wanted = useRef(null);

  const loadProfile = useCallback(async (userId) => {
    wanted.current = userId ?? null;
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (wanted.current !== userId) return;
    if (error) {
      // This also runs on every hourly token refresh. One flaky request used
      // to null the profile, which hid an organizer's tabs until reload — so
      // keep what we have, as long as it's this same person's.
      setProfile((prev) => (prev?.id === userId ? prev : null));
      return;
    }
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;
    initPush();

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user?.id) pushLogin(data.session.user.id);
      await loadProfile(data.session?.user?.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      // Never let one account's cached data show to the next person on this device.
      if (_event === 'SIGNED_OUT') { await clearCache(); pushLogout(); }
      if (newSession?.user?.id) pushLogin(newSession.user.id);
      setSession(newSession);
      await loadProfile(newSession?.user?.id);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = {
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session?.user?.id),
    // 'local': log out of THIS device only. The default ('global') revoked the
    // account's sessions everywhere — logging out on a laptop also logged the
    // phone out and silently stopped its push notifications.
    signOut: () => supabase.auth.signOut({ scope: 'local' }),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
