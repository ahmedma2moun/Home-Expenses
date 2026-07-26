import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";
import { parseMonthLabel } from "@/lib/services/period";
import { recomputeMonthlySummary, invalidateMonthComparisons } from "@/lib/services/monthlySummary";
import type { ConfirmReceiptRequest } from "@/lib/api/schemas/receipts";

const CONFIRMABLE_STATUSES = new Set(["PARSED", "FAILED"]);

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
    const existingOrder = await prisma.order.findUnique({ where: { receiptId } });
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

  const periodMonth = parseMonthLabel(input.periodMonth);

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        receiptId: receipt.id,
        merchant: input.merchant,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
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
            normalizedName: item.name.trim().toLowerCase(),
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

    await tx.receipt.update({ where: { id: receipt.id }, data: { status: "CONFIRMED" } });

    const overrides = input.items
      .filter(
        (item): item is typeof item & { aiCategoryId: string } =>
          !!item.aiCategoryId && item.aiCategoryId !== item.categoryId,
      )
      .map((item) => ({
        userId,
        merchant: input.merchant,
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
}
