/**
 * Pure matching-key helpers — deliberately dependency-free (no Prisma, no other service) so
 * transport-layer Zod schemas can import `normalizeItemName` without pulling the whole service
 * graph into the validation layer.
 */

/** The matching key for merchant-item memory (PROJECT_SPEC.md §11) — same rule everywhere an
 *  OrderItem.normalizedName is written or looked up. */
export function normalizeItemName(name: string): string {
  return name.trim().toLowerCase();
}

/** `Order.merchant` is only `trim()`-ed at write time, never case-normalized, so "Carrefour" and
 *  "carrefour" are otherwise treated as two different stores when matching purchases. Comparisons
 *  should go through this; display should keep the stored casing. */
export function normalizeMerchant(merchant: string): string {
  return merchant.trim().toLowerCase();
}
