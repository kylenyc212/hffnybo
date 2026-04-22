import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompCategory, TicketCategory } from './database.types';

export interface CartLine {
  key: string; // stable local id for UI
  screeningId: string;
  screeningTitle: string;
  screeningStartsAt: string;
  ticketTypeId: string | null; // null for ad-hoc "other"
  label: string;
  qty: number;
  unitPriceCents: number;
  category: TicketCategory;
  compCategory: CompCategory | null;
  passholderId: string | null;
  patronName: string | null;
}

interface CartState {
  lines: CartLine[];
  addLine: (line: Omit<CartLine, 'key'>) => void;
  updateQty: (key: string, qty: number) => void;
  updateLine: (key: string, patch: Partial<CartLine>) => void;
  removeLine: (key: string) => void;
  clear: () => void;
  subtotalCents: () => number;
  count: () => number;
}

const makeKey = () => Math.random().toString(36).slice(2, 10);

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      addLine: (line) => {
        const existing = get().lines.find(
          (l) =>
            l.screeningId === line.screeningId &&
            l.ticketTypeId === line.ticketTypeId &&
            l.label === line.label &&
            l.unitPriceCents === line.unitPriceCents &&
            !l.patronName // don't merge comp lines with a patron name
        );
        if (existing) {
          set({
            lines: get().lines.map((l) =>
              l.key === existing.key ? { ...l, qty: l.qty + line.qty } : l
            )
          });
        } else {
          set({ lines: [...get().lines, { ...line, key: makeKey() }] });
        }
      },
      updateQty: (key, qty) =>
        set({
          lines: get()
            .lines.map((l) => (l.key === key ? { ...l, qty } : l))
            .filter((l) => l.qty > 0)
        }),
      updateLine: (key, patch) =>
        set({ lines: get().lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }),
      removeLine: (key) => set({ lines: get().lines.filter((l) => l.key !== key) }),
      clear: () => set({ lines: [] }),
      subtotalCents: () => get().lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0),
      count: () => get().lines.reduce((sum, l) => sum + l.qty, 0)
    }),
    { name: 'hffny-cart' }
  )
);
