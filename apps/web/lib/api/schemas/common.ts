import { z } from "zod";

/** Money on the wire: a string with exactly two decimal places, e.g. "45.00". */
export const MONEY_RE = /^-?\d+\.\d{2}$/;
export const moneySchema = z.string().regex(MONEY_RE, 'Money must be a string like "45.00".');

/** Month on the wire: "YYYY-MM". */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthLabelSchema = z.string().regex(MONTH_RE, 'Month must be formatted as "YYYY-MM".');

export const clientRefSchema = z.string().min(1).max(128);
