import { prisma, isUniqueConstraintViolation } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";
import { assertCategoriesExist } from "@/lib/services/categoryTaxonomy";
import { parseMonthLabel } from "@/lib/services/period";
import { recomputeMonthlySummary, invalidateMonthComparisons } from "@/lib/services/monthlySummary";
import { getUserCurrency, assertCurrencyMatches } from "@/lib/services/users";
import { normalizeItemName } from "@/lib/services/itemNormalization";
import type { ConfirmReceiptRequest } from "@/lib/api/schemas/receipts";

const CONFIRMABLE_STATUSES = new Set(["PARSED", "FAILED"]);

/**
 * Stand-in when the receipt's merchant was never legible and the user didn't supply one. Grouping
 * these under a single name keeps the spend visible in analytics rather than silently absent.
 *
 * It is NOT a usable learning key: `ItemCategoryOverride` rows are written on
 * `(userId, merchant, itemName)`, so every anonymous receipt collapses into one bucket and a
 * correction made on one would otherwise be suggested for an unrelated one. The rows are still
 * recorded — they are labelled data for prompt tuning (§11) — but the merchant → category lookup,
 * when it is built, must exclude this value rather than match on it.
 */
export const UNKNOWN_MERCHANT = "Unknown merchant";

export interface ConfirmReceiptResult {
  orderId: string;
}

/**
 * Creates the Order + OrderItem[] from the user's final, edited payload (BR-2/BR-3), records
 * category overrides for the learning loop, and recomputes the month's summary — all in one
 * transaction (CLAUDE.md rule 8). Confirming an already-confirmed receipt is idempotent.
 */
export async function confirmReceipt(
  userId: string,
  receiptId: string,
  input: ConfirmReceiptRequest,
): Promise<ConfirmReceiptResult> {
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
  if (!receipt) {
    throw new AppError("NOT_FOUND", "Receipt not found.", 404);
  }

  if (receipt.status === "CONFIRMED") {
    const existingOrder = await prisma.order.findFirst({ where: { receiptId, userId } });
    if (existingOrder) {
      return { orderId: existingOrder.id };
    }
  }

  if (!CONFIRMABLE_STATUSES.has(receipt.status)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Receipt in status ${receipt.status} cannot be confirmed.`,
      400,
    );
  }

  const userCurrency = await getUserCurrency(userId);
  assertCurrencyMatches(userCurrency, input.currency);

  const periodMonth = parseMonthLabel(input.periodMonth);
  const merchant = input.merchant.trim() || UNKNOWN_MERCHANT;

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      await assertCategoriesExist(tx, input.items);

      const order = await tx.order.create({
        data: {
          userId,
          receiptId: receipt.id,
          merchant,
          periodMonth,
          currency: input.currency,
          subtotal: input.subtotal,
          tax: input.tax,
          discount: input.discount,
          total: input.total,
          notes: input.notes ?? null,
          source: "receipt",
          items: {
            create: input.items.map((item) => ({
              name: item.name,
              brand: item.brand ?? null,
              normalizedName: normalizeItemName(item.name),
              quantity: item.quantity,
              unit: item.unit ?? null,
              unitPrice: item.unitPrice ?? null,
              lineTotal: item.lineTotal,
              categoryId: item.categoryId,
              aiCategoryId: item.aiCategoryId ?? null,
              position: item.position,
            })),
          },
        },
      });

      await tx.receipt.updateMany({
        where: { id: receipt.id, userId },
        data: { status: "CONFIRMED" },
      });

      const overrides = input.items
        .filter(
          (item): item is typeof item & { aiCategoryId: string } =>
            !!item.aiCategoryId && item.aiCategoryId !== item.categoryId,
        )
        .map((item) => ({
          userId,
          merchant,
          itemName: item.name,
          aiCategoryId: item.aiCategoryId,
          finalCategoryId: item.categoryId,
        }));
      if (overrides.length > 0) {
        await tx.itemCategoryOverride.createMany({ data: overrides });
      }

      await recomputeMonthlySummary(tx, userId, periodMonth);
      await invalidateMonthComparisons(tx, userId, [periodMonth]);

      return order.id;
    });

    return { orderId };
  } catch (error) {
    // Two concurrent confirms both pass the CONFIRMABLE_STATUSES check above and race into
    // order.create; Order.receiptId's unique index rejects the loser. That loser didn't fail —
    // it lost a race against a request that did the exact same thing, so the correct response is
    // the order the winner created, not a 500 (confirmation must be idempotent, CLAUDE.md/§13).
    if (isUniqueConstraintViolation(error)) {
      const existingOrder = await prisma.order.findFirst({ where: { receiptId, userId } });
      if (existingOrder) {
        return { orderId: existingOrder.id };
      }
    }
    throw error;
  }
}
