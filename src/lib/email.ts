// Send a receipt email via the send-receipt Supabase Edge Function.

import { supabase } from './supabase';

export interface ReceiptEmailParams {
  to: string;
  orderRef: string | null;
  cashierName: string;
  items: {
    label: string;
    screeningTitle: string;
    qty: number;
    unitPriceCents: number;
  }[];
  totalCents: number;
  payMethod: 'cash' | 'external';
  cardBrand?: string | null;
  cardLast4?: string | null;
}

export async function sendReceiptEmail(params: ReceiptEmailParams): Promise<void> {
  const { error } = await supabase.functions.invoke('send-receipt', { body: params });
  if (error) throw new Error(error.message ?? 'Email send failed');
}
