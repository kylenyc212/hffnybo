import { supabase } from './supabase';

export interface PartyGuest {
  id: string;
  first_name: string;
  last_name: string;
  notes: string;
  has_screening: boolean;
  has_party: boolean;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_in_by: string | null;
  added_at_door: boolean;
  created_at: string;
}

export async function loadPartyGuests(): Promise<PartyGuest[]> {
  const { data, error } = await supabase
    .from('party_guests')
    .select('*')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PartyGuest[];
}

export async function checkInGuest(
  id: string,
  by: string
): Promise<void> {
  const { error } = await supabase
    .from('party_guests')
    .update({
      checked_in: true,
      checked_in_at: new Date().toISOString(),
      checked_in_by: by,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function undoCheckIn(id: string): Promise<void> {
  const { error } = await supabase
    .from('party_guests')
    .update({ checked_in: false, checked_in_at: null, checked_in_by: null })
    .eq('id', id);
  if (error) throw error;
}

export async function addDoorGuest(params: {
  firstName: string;
  lastName: string;
  notes: string;
  checkedInBy: string;
}): Promise<PartyGuest> {
  const { data, error } = await supabase
    .from('party_guests')
    .insert({
      first_name: params.firstName,
      last_name: params.lastName,
      notes: params.notes,
      has_party: true,
      added_at_door: true,
      checked_in: true,
      checked_in_at: new Date().toISOString(),
      checked_in_by: params.checkedInBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PartyGuest;
}
