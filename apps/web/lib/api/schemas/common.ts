import { z } from "zod";

/** Money on the wire: a string with exactly two decimal places, e.g. "45.00". */
export const MONEY_RE = /^-?\d+\.\d{2}$/;
export const moneySchema = z.string().regex(MONEY_RE, 'Money must be a string like "45.00".');

/**
 * Money that can never legitimately be negative — a budget target or `actualPaid`, unlike
 * `subtotal`/`discount`/an adjustment line item, none of which use this. Also caps at 10 integer
 * digits so an oversized value 400s here instead of overflowing `Decimal(12,2)` into a 500 later.
 */
export const NONNEGATIVE_MONEY_RE = /^\d{1,10}\.\d{2}$/;
export const nonNegativeMoneySchema = z
  .string()
  .regex(NONNEGATIVE_MONEY_RE, 'Money must be a non-negative string like "45.00".');

/** Month on the wire: "YYYY-MM". */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthLabelSchema = z.string().regex(MONTH_RE, 'Month must be formatted as "YYYY-MM".');

export const clientRefSchema = z.string().min(1).max(128);

/** Period within a month; legacy wire name retained for older clients. */
export const periodWeekSchema = z.coerce.number().int().min(1).max(31);
