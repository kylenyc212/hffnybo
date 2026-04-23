import { supabase } from './supabase';
import type { UserRow } from './database.types';
import * as cache from './cache';
import { CacheKeys } from './cache';

const SALT = 'hffny-boxoffice-v1';

type CachedUser = Pick<UserRow, 'id' | 'name' | 'role' | 'active' | 'pin_hash'>;

export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(SALT + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Keep a rolling copy of active users in localStorage so PIN verification
// works offline. pin_hash is already one-way so caching it is safe.
async function refreshUsersCache(): Promise<CachedUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, active, pin_hash');
  if (error) throw error;
  const rows = (data ?? []) as CachedUser[];
  cache.set(CacheKeys.users, rows);
  return rows;
}

function cachedUsers(): CachedUser[] {
  return cache.get<CachedUser[]>(CacheKeys.users)?.data ?? [];
}

export async function verifyPin(pin: string) {
  const hash = await hashPin(pin);
  // Try online first — authoritative + refreshes cache
  try {
    const rows = await refreshUsersCache();
    const hit = rows.find((u) => u.pin_hash === hash && u.active);
    if (hit) return { id: hit.id, name: hit.name, role: hit.role };
    return null;
  } catch (e) {
    console.warn('[auth] online verify failed, falling back to cache', e);
    const rows = cachedUsers();
    const hit = rows.find((u) => u.pin_hash === hash && u.active);
    if (hit) return { id: hit.id, name: hit.name, role: hit.role };
    return null;
  }
}

export async function countUsers(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    // Also prime the users cache for offline verification on next session
    refreshUsersCache().catch(() => {});
    return count ?? 0;
  } catch (e) {
    // Offline: use cache
    const cached = cachedUsers();
    if (cached.length > 0) return cached.length;
    throw e;
  }
}

export async function createUser(name: string, pin: string, role: 'admin' | 'cashier') {
  const pin_hash = await hashPin(pin);
  const { data, error } = await supabase
    .from('users')
    .insert({ name, pin_hash, role })
    .select()
    .single();
  if (error) throw error;
  return data as UserRow;
}
