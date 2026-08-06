/**
 * Order.periodMonth is always the first day of the month at UTC midnight (BR-4).
 * Never construct a periodMonth value inline — always go through this module.
 */
export function toPeriodMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Parses the wire format "YYYY-MM" (validated by monthLabelSchema) into a periodMonth Date. */
export function parseMonthLabel(label: string): Date {
  const [year = 1970, month = 1] = label.split("-").map(Number);
  return toPeriodMonth(new Date(Date.UTC(year, month - 1, 1)));
}

/** Formats a periodMonth Date back to the wire format "YYYY-MM". */
export function formatMonthLabel(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Inclusive list of "YYYY-MM" labels from `start` to `end`. Empty if `start` is after `end`. */
export function monthRange(start: Date, end: Date): string[] {
  const labels: string[] = [];
  let cursor = toPeriodMonth(start);
  const last = toPeriodMonth(end);
  while (cursor <= last) {
    labels.push(formatMonthLabel(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return labels;
}

export function isPeriodMonth(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}
