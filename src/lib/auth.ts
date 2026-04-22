import { supabase } from './supabase';
import type { UserRow } from './database.types';

const SALT = 'hffny-boxoffice-v1';

export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(SALT + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string) {
  const hash = await hashPin(pin);
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, active')
    .eq('pin_hash', hash)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  if (!data) return null;
  const row = data as Pick<UserRow, 'id' | 'name' | 'role' | 'active'>;
  return { id: row.id, name: row.name, role: row.role };
}

export async function countUsers(): Promise<number> {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
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
