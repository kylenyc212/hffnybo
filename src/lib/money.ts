const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const money = (cents: number) => fmt.format(cents / 100);
export const toCents = (dollars: number) => Math.round(dollars * 100);
