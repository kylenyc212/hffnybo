import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Database } from './database.types';

type UserRow = Database['public']['Tables']['users']['Row'];

interface SessionState {
  user: Pick<UserRow, 'id' | 'name' | 'role'> | null;
  deviceLabel: string | null;
  setUser: (u: SessionState['user']) => void;
  setDeviceLabel: (s: string) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      deviceLabel: null,
      setUser: (user) => set({ user }),
      setDeviceLabel: (deviceLabel) => set({ deviceLabel }),
      signOut: () => set({ user: null })
    }),
    { name: 'hffny-session' }
  )
);
