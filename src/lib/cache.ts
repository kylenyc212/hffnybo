// Generic localStorage-backed cache for Supabase reads.
// Every wrapped query tries the network first; on failure it falls back to
// whatever was cached last. On success the cache is refreshed.
//
// Keys are namespaced with a prefix + schema version so a future migration
// can invalidate everything by bumping the version.

const PREFIX = 'hffny-cache-v1:';

export interface CacheEntry<T> {
  data: T;
  syncedAt: string; // ISO timestamp
}

export function set<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, syncedAt: new Date().toISOString() };
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // Quota exceeded or disabled. Non-fatal.
    console.warn('[cache] failed to write', key, e);
  }
}

export function get<T>(key: string): CacheEntry<T> | null {
  const raw = localStorage.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

export function clear(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

// Wrapper: try fetcher, cache on success, return cache on network failure.
// `fetchFn` should throw on any error (network, RLS, parse).
export async function cachedFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  try {
    const data = await fetchFn();
    set(key, data);
    return data;
  } catch (err) {
    const cached = get<T>(key);
    if (cached) {
      console.info(`[cache] using cached ${key} after fetch error`, err);
      return cached.data;
    }
    throw err;
  }
}

// Returns the most recent syncedAt timestamp across the given keys.
export function latestSync(keys: string[]): Date | null {
  let latest: Date | null = null;
  for (const k of keys) {
    const e = get(k);
    if (!e) continue;
    const d = new Date(e.syncedAt);
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

// Keys used across the app — keep in one place.
export const CacheKeys = {
  screenings: 'screenings-with-types',
  passholders: 'passholders',
  users: 'users',
  openDrawer: 'open-drawer',
  drawerEvents: 'drawer-events', // keyed further by drawer id in practice
  testCounts: 'test-counts'
} as const;
