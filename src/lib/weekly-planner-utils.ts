/**
 * Returns the Sunday that starts the week containing `date`.
 * Weeks start on Sunday per project convention.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * Returns an array of week-start dates (Sundays) covering `from` to `to`.
 * Ordered newest first.
 */
export function getWeekRange(from: Date, to: Date): Date[] {
  const weeks: Date[] = [];
  let current = getWeekStart(to);
  const stop = getWeekStart(from);

  while (current >= stop) {
    weeks.push(new Date(current));
    current.setDate(current.getDate() - 7);
  }

  return weeks;
}

/**
 * Formats a date as DD-MM-YYYY per project convention.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Formats a Date as YYYY-MM-DD using local timezone (not UTC).
 * Use instead of .toISOString().split("T")[0] to avoid UTC offset shifting the date.
 */
export function toLocalISODate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns default date range: current week start going back 3 weeks.
 */
export function defaultPupilDateRange(): { from: Date; to: Date } {
  const to = getWeekStart(new Date());
  const from = new Date(to);
  from.setDate(from.getDate() - 21); // 3 weeks back
  return { from, to };
}
