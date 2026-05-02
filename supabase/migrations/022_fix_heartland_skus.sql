-- Fix heartland_sku values to match exact Heartland inventory item names.
-- Previous values (MERCH-TSHIRT, MERCH-TOTE, PASS-*) didn't match what
-- Heartland prints on receipts, so the receipt parser never auto-matched them.

-- Merch
update public.ticket_types set heartland_sku = 'T-shirt'
  where label = 'T-shirt' and heartland_sku = 'MERCH-TSHIRT';

update public.ticket_types set heartland_sku = 'Tote'
  where label = 'Tote' and heartland_sku = 'MERCH-TOTE';

-- Passes
update public.ticket_types set heartland_sku = 'All Access Pass'
  where label = 'All Access Pass' and heartland_sku = 'PASS-ALLACCESS';

update public.ticket_types set heartland_sku = 'Cinephone Pass'
  where label = 'Cinephone Pass' and heartland_sku = 'PASS-CINEPHONE';

update public.ticket_types set heartland_sku = 'Weekday Pass'
  where label = 'Weekday Pass' and heartland_sku = 'PASS-WEEKDAY';

update public.ticket_types set heartland_sku = 'YP All Access'
  where label = 'YP All Access' and heartland_sku = 'PASS-YPACCESS';
