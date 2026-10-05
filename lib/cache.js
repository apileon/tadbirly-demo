import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
//  A tiny "show it now, refresh behind your back" cache.
//
//  Screens read from memory instantly, so re-opening a tab never shows a
//  loading state again. The data is also written to the device, so it's still
//  there after the app is closed and reopened — the first paint is instant
//  even on a cold start. A fresh copy is fetched every time in the background
//  and swapped in silently when it arrives.
// ---------------------------------------------------------------------------

const mem = new Map();

// Versioned namespace. Bump it whenever the shape of cached data changes, so a
// copy saved by an older build is never fed to a newer screen (and crashes it).
const PREFIX = 'tdb2:';

// The namespace older builds cached under. It is shared with keys that are NOT
// cache — components/InstallPrompt.js keeps its 'tdb:install-dismissed' snooze
// there, straight in localStorage — so only entries shaped like cache keys
// ('tdb:<name>:<id>', e.g. 'tdb:feed:<uid>') are ever removed from it.
const LEGACY_CACHE_KEY = /^tdb:[^:]+:/;

// Bumped by clearCache(). A fetch that started before a sign-out finishes
// after it — its result belongs to the previous account and must not be
// written back into the (just emptied) cache or onto the screen.
let epoch = 0;

export function peek(key) {
  return mem.get(key);
}

export function writeCache(key, value) {
  mem.set(key, value);
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
}

async function hydrate(key) {
  if (mem.has(key)) return mem.get(key);
  const startedIn = epoch;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    // Cleared while we were reading: don't resurrect the old account's copy.
    if (raw == null || startedIn !== epoch) return undefined;
    const value = JSON.parse(raw);
    mem.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

// Drop cached entries so the next read refetches (e.g. after signing out).
export function invalidate(prefix = '') {
  for (const k of [...mem.keys()]) {
    if (k.startsWith(prefix)) {
      mem.delete(k);
      AsyncStorage.removeItem(PREFIX + k).catch(() => {});
    }
  }
}

// On web AsyncStorage is plain localStorage and getAllKeys() returns every key
// the site has ever stored — Supabase's session, InstallPrompt's snooze — so
// this must only match what the cache itself wrote.
function isCacheKey(k) {
  return k.startsWith(PREFIX) || LEGACY_CACHE_KEY.test(k);
}

export async function clearCache() {
  epoch += 1; // first, synchronously: in-flight fetches see it before they land
  mem.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter(isCacheKey));
  } catch { /* nothing to clean */ }
}

/**
 * useCachedQuery('feed', fetcher)
 *  - returns cached data straight away (no spinner on repeat visits)
 *  - refetches whenever the screen comes into focus, silently
 *  - `loading` is only true the very first time, when nothing is cached yet
 *  - `refresh` and `setData` keep the same identity between renders, so they
 *    are safe to use in effect dependencies
 */
export function useCachedQuery(key, fetcher) {
  const fRef = useRef(fetcher);
  fRef.current = fetcher;

  const [data, setData] = useState(() => (key ? mem.get(key) : undefined));
  const [loading, setLoading] = useState(() => (key ? !mem.has(key) : false));
  const [refreshing, setRefreshing] = useState(false);
  // Key of the fetch in flight. Per key, so switching keys mid-fetch (another
  // user, another record) doesn't block the new key's first load.
  const busy = useRef(null);

  // If the key changes (different user, different record), re-derive from that
  // key's cache instead of showing the previous key's data.
  const prevKey = useRef(key);
  if (prevKey.current !== key) {
    prevKey.current = key;
    setData(key ? mem.get(key) : undefined);
    setLoading(key ? !mem.has(key) : false);
  }

  // Depends on `key` only (refs and state setters are stable), so it — and
  // `refresh` below — keep one identity for as long as the key stays the same.
  const run = useCallback(async (showSpinner = false) => {
    if (!key || busy.current === key) return;
    busy.current = key;
    const startedIn = epoch;
    if (showSpinner) setRefreshing(true);
    try {
      const fresh = await fRef.current();
      if (fresh !== undefined && startedIn === epoch) {
        writeCache(key, fresh);
        // Still valid data for its own key, but not for a screen that has
        // since moved on to a different key.
        if (prevKey.current === key) setData(fresh);
      }
    } catch {
      // keep whatever we already had on screen
    }
    if (prevKey.current === key) setLoading(false);
    setRefreshing(false);
    if (busy.current === key) busy.current = null;
  }, [key]);

  const refresh = useCallback(() => run(true), [run]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (key && !mem.has(key)) {
          const stored = await hydrate(key);
          if (alive && stored !== undefined) {
            setData(stored);
            setLoading(false);
          }
        }
        if (alive) run();
      })();
      return () => { alive = false; };
    }, [key, run]),
  );

  return { data, loading, refreshing, refresh, setData };
}
