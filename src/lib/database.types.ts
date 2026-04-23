// Hand-maintained. Regenerate after schema changes.

export type CompCategory = 'press' | 'pass_holder' | 'industry';
export type TicketCategory = 'paid' | 'comp' | 'other';
export type UserRole = 'cashier' | 'admin';
export type CashEventType = 'open' | 'sale' | 'removal' | 'close' | 'adjustment' | 'add';

export interface ScreeningRow {
  id: string;
  starts_at: string;
  title: string;
  capacity: number;
  online_sold: number;
  notes: string | null;
  is_free: boolean;
  is_always_available: boolean;
  short_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketTypeRow {
  id: string;
  screening_id: string | null;
  label: string;
  price_cents: number;
  category: TicketCategory;
  comp_category: CompCategory | null;
  sort_order: number;
  active: boolean;
  heartland_sku: string | null;
}

export interface PassholderRow {
  id: string;
  name: string;
  email: string | null;
  barcode: string;
  synced_at: string;
}

export interface UserRow {
  id: string;
  name: string;
  pin_hash: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export interface OrderRow {
  id: string;
  created_at: string;
  cashier_id: string | null;
  cashier_name: string;
  device_label: string;
  drawer_id: string | null;
  subtotal_cents: number;
  cash_tendered_cents: number;
  change_cents: number;
  source: 'boxoffice' | 'external_heartland';
  notes: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  external_ref: string | null;
}

export type HeartlandTxnStatus = 'pending' | 'matched' | 'needs_review' | 'ignored';

export interface HeartlandTransactionRow {
  id: string;
  heartland_txn_id: string;
  amount_cents: number;
  charged_at: string;
  raw: unknown;
  matched_order_id: string | null;
  status: HeartlandTxnStatus;
  notes: string | null;
  created_at: string;
}

export interface CashCountRow {
  id: string;
  drawer_id: string;
  created_at: string;
  who: string;
  denoms: DenomBreakdown;
  counted_cents: number;
  expected_cents: number;
  variance_cents: number;
  notes: string | null;
}

export interface OrderLineRow {
  id: string;
  order_id: string;
  screening_id: string;
  ticket_type_id: string | null;
  label: string;
  qty: number;
  unit_price_cents: number;
  category: TicketCategory;
  comp_category: CompCategory | null;
  passholder_id: string | null;
  patron_name: string | null;
}

export type DenomBreakdown = Record<string, number>; // key = cent value, value = count

export interface CashDrawerRow {
  id: string;
  device_label: string;
  shift_date: string;
  opened_at: string;
  opened_by: string;
  opening_cents: number;
  closed_at: string | null;
  closed_by: string | null;
  counted_cents: number | null;
  opening_denoms: DenomBreakdown | null;
  closing_denoms: DenomBreakdown | null;
}

export interface CashEventRow {
  id: string;
  drawer_id: string;
  kind: CashEventType;
  amount_cents: number;
  reason: string | null;
  who: string;
  order_id: string | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      screenings: { Row: ScreeningRow; Insert: Partial<ScreeningRow> & { starts_at: string; title: string }; Update: Partial<ScreeningRow> };
      ticket_types: { Row: TicketTypeRow; Insert: Partial<TicketTypeRow> & { label: string; price_cents: number; category: TicketCategory }; Update: Partial<TicketTypeRow> };
      passholders: { Row: PassholderRow; Insert: { name: string; email?: string | null; barcode: string }; Update: Partial<PassholderRow> };
      users: { Row: UserRow; Insert: { name: string; pin_hash: string; role: UserRole }; Update: Partial<UserRow> };
      orders: { Row: OrderRow; Insert: Partial<OrderRow> & { cashier_name: string; device_label: string; subtotal_cents: number }; Update: Partial<OrderRow> };
      order_lines: { Row: OrderLineRow; Insert: Omit<OrderLineRow, 'id'>; Update: Partial<OrderLineRow> };
      cash_drawers: { Row: CashDrawerRow; Insert: Partial<CashDrawerRow> & { device_label: string; shift_date: string; opened_by: string; opening_cents: number }; Update: Partial<CashDrawerRow> };
      cash_events: { Row: CashEventRow; Insert: Omit<CashEventRow, 'id' | 'created_at'> & { created_at?: string }; Update: Partial<CashEventRow> };
      cash_counts: { Row: CashCountRow; Insert: Omit<CashCountRow, 'id' | 'created_at'> & { created_at?: string }; Update: Partial<CashCountRow> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
