const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "14:05" for today, "3 Nov" for earlier days. */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString() ? time.format(date) : day.format(date);
}

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}
