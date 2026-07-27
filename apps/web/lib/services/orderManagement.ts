import { prisma, Prisma } from "@/lib/db/prisma";
import { AppError, type ValidationDetails } from "@/lib/api/envelope";
import { formatMonthLabel, parseMonthLabel } from "@/lib/services/period";
import { recomputeMonthlySummary, invalidateMonthComparisons } from "@/lib/services/monthlySummary";
import { UNKNOWN_MERCHANT } from "@/lib/services/orders";
import type { OrderItemInput, OrderListQuery, OrderUpdateRequest } from "@/lib/api/schemas/orders";

/**
 * Reading and maintaining orders that already exist (BR-4: list a month, move an order to another
 * month, correct it, delete it). Creating one from a confirmed receipt lives in `orders.ts`.
 */

export interface OrderItemDto {
  id: string;
  name: string;
  /** A count or weight, not an amount — a JSON number here, unlike the money fields. */
  quantity: number;
  unit: string | null;
  unitPrice: string | null;
  lineTotal: string;
  categoryId: string;
  aiCategoryId: string | null;
  position: number;
}

export interface OrderSummaryDto {
  id: string;
  merchant: string;
  purchasedAt: string | null;
  periodMonth: string;
  currency: string;
  total: string;
  itemCount: number;
  source: string;
  createdAt: string;
}

export interface OrderDto extends OrderSummaryDto {
  receiptId: string | null;
  subtotal: string;
  tax: string;
  discount: string;
  notes: string | null;
  updatedAt: string;
  items: OrderItemDto[];
}

export interface OrderListPage {
  orders: OrderSummaryDto[];
  /** Pass back as `?cursor=` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
type OrderWithItemCount = Prisma.OrderGetPayload<{
  include: { _count: { select: { items: true } } };
}>;

export async function listOrders(userId: string, query: OrderListQuery): Promise<OrderListPage> {
  const rows = await prisma.order.findMany({
    where: { userId, ...(query.month && { periodMonth: parseMonthLabel(query.month) }) },
    // Newest purchase first is what the user is looking for; orders with no readable receipt date
    // sink to the bottom rather than jumping the list. `id` breaks ties so the cursor is stable.
    orderBy: [{ purchasedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    include: { _count: { select: { items: true } } },
  });

  const page = rows.slice(0, query.limit);
  return {
    orders: page.map(toOrderSummary),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function getOrder(userId: string, orderId: string): Promise<OrderDto> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!order) {
    throw orderNotFound();
  }
  return toOrderDto(order);
}

/**
 * Applies the user's edits. Moving an order between months recomputes **both** months' summaries
 * and drops any cached AI comparison touching either one (PROJECT_SPEC.md §12) — all inside the
 * write's own transaction (CLAUDE.md rule 8).
 */
export async function updateOrder(
  userId: string,
  orderId: string,
  input: OrderUpdateRequest,
): Promise<OrderDto> {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { periodMonth: true },
  });
  if (!existing) {
    throw orderNotFound();
  }

  if (input.items) {
    await assertCategoriesExist(input.items);
  }

  const nextPeriodMonth = input.periodMonth ? parseMonthLabel(input.periodMonth) : null;
  const affectedMonths = monthsToRecompute(existing.periodMonth, nextPeriodMonth);

  const updated = await prisma.$transaction(async (tx) => {
    if (input.items) {
      await tx.orderItem.deleteMany({ where: { orderId, order: { userId } } });
    }

    const order = await tx.order.update({
      where: { id: orderId, userId },
      data: {
        ...scalarUpdates(input, nextPeriodMonth),
        ...(input.items && { items: { create: input.items.map(toItemCreate) } }),
      },
      include: { items: { orderBy: { position: "asc" } } },
    });

    for (const month of affectedMonths) {
      await recomputeMonthlySummary(tx, userId, month);
    }
    await invalidateMonthComparisons(tx, userId, affectedMonths);

    return order;
  });

  return toOrderDto(updated);
}

export async function deleteOrder(userId: string, orderId: string): Promise<{ id: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { periodMonth: true, receiptId: true },
  });
  if (!order) {
    throw orderNotFound();
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.delete({ where: { id: orderId, userId } });

    if (order.receiptId) {
      // `Order.receiptId` is unique, so a receipt left at CONFIRMED with its order gone could
      // never produce one again. Releasing it back to PARSED keeps the parse recoverable —
      // `parsedPayload` is still on the row, so the review screen can re-confirm it.
      await tx.receipt.updateMany({
        where: { id: order.receiptId, userId },
        data: { status: "PARSED" },
      });
    }

    await recomputeMonthlySummary(tx, userId, order.periodMonth);
    await invalidateMonthComparisons(tx, userId, [order.periodMonth]);
  });

  return { id: orderId };
}

/** 404 rather than 403 for another user's order — never leak that the id exists (docs/api.md). */
function orderNotFound(): AppError {
  return new AppError("NOT_FOUND", "Order not found.", 404);
}

function monthsToRecompute(current: Date, next: Date | null): Date[] {
  if (!next || next.getTime() === current.getTime()) {
    return [current];
  }
  return [current, next];
}

/**
 * `OrderItem.categoryId` is a foreign key, so an unknown slug would surface as an opaque 500.
 * Checking it up front turns that into a field-level 400 the client can point at.
 */
async function assertCategoriesExist(items: OrderItemInput[]): Promise<void> {
  const requested = [...new Set(items.map((item) => item.categoryId))];
  const known = await prisma.category.findMany({
    where: { id: { in: requested } },
    select: { id: true },
  });
  const knownIds = new Set(known.map((category) => category.id));

  const issues = items.flatMap((item, index) =>
    knownIds.has(item.categoryId)
      ? []
      : [{ path: `items.${index}.categoryId`, message: `Unknown category "${item.categoryId}".` }],
  );
  if (issues.length > 0) {
    const details: ValidationDetails = { issues };
    throw new AppError("VALIDATION_ERROR", "Request failed validation.", 400, details);
  }
}

function scalarUpdates(
  input: OrderUpdateRequest,
  periodMonth: Date | null,
): Prisma.OrderUpdateInput {
  return {
    ...(input.merchant !== undefined && { merchant: input.merchant.trim() || UNKNOWN_MERCHANT }),
    ...(input.purchasedAt !== undefined && {
      purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
    }),
    ...(periodMonth && { periodMonth }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.subtotal !== undefined && { subtotal: input.subtotal }),
    ...(input.tax !== undefined && { tax: input.tax }),
    ...(input.discount !== undefined && { discount: input.discount }),
    ...(input.total !== undefined && { total: input.total }),
    ...(input.notes !== undefined && { notes: input.notes }),
  };
}

function toItemCreate(item: OrderItemInput): Prisma.OrderItemCreateWithoutOrderInput {
  return {
    name: item.name,
    normalizedName: item.name.trim().toLowerCase(),
    quantity: item.quantity,
    unit: item.unit ?? null,
    unitPrice: item.unitPrice ?? null,
    lineTotal: item.lineTotal,
    category: { connect: { id: item.categoryId } },
    aiCategoryId: item.aiCategoryId ?? null,
    position: item.position,
  };
}

function toOrderSummary(order: OrderWithItemCount): OrderSummaryDto {
  return {
    id: order.id,
    merchant: order.merchant,
    purchasedAt: order.purchasedAt?.toISOString() ?? null,
    periodMonth: formatMonthLabel(order.periodMonth),
    currency: order.currency,
    total: order.total.toFixed(2),
    itemCount: order._count.items,
    source: order.source,
    createdAt: order.createdAt.toISOString(),
  };
}

function toOrderDto(order: OrderWithItems): OrderDto {
  return {
    id: order.id,
    receiptId: order.receiptId,
    merchant: order.merchant,
    purchasedAt: order.purchasedAt?.toISOString() ?? null,
    periodMonth: formatMonthLabel(order.periodMonth),
    currency: order.currency,
    subtotal: order.subtotal.toFixed(2),
    tax: order.tax.toFixed(2),
    discount: order.discount.toFixed(2),
    total: order.total.toFixed(2),
    notes: order.notes,
    source: order.source,
    itemCount: order.items.length,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(toOrderItemDto),
  };
}

function toOrderItemDto(item: OrderWithItems["items"][number]): OrderItemDto {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity.toNumber(),
    unit: item.unit,
    unitPrice: item.unitPrice?.toFixed(2) ?? null,
    lineTotal: item.lineTotal.toFixed(2),
    categoryId: item.categoryId,
    aiCategoryId: item.aiCategoryId,
    position: item.position,
  };
}
