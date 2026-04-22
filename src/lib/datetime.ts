// All festival times are in America/New_York. Always format against that TZ,
// never slice ISO strings (UTC midnight shifts the calendar date).

const TZ = 'America/New_York';

export function nyDateKey(iso: string): string {
  // Returns YYYY-MM-DD in NY local time (en-CA gives ISO-ordered dates).
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function fmtDayHeader(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: TZ,
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function fmtWhen(iso: string): string {
  return `${fmtDayHeader(iso)}, ${fmtTime(iso)}`;
}

// YYYY-MM-DD for "today" in NY, used to hide past days.
export function nyTodayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
