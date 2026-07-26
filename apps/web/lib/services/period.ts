/**
 * Order.periodMonth is always the first day of the month at UTC midnight (BR-4).
 * Never construct a periodMonth value inline — always go through this module.
 */
export function toPeriodMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Default month suggestion for the review screen: the receipt date, or now if unreadable. */
export function suggestPeriodMonth(purchasedAt: Date | null, now: Date): Date {
  return toPeriodMonth(purchasedAt ?? now);
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

export function isPeriodMonth(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}
