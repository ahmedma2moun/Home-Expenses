import { prisma, Prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";
import { parseMonthLabel } from "@/lib/services/period";
import {
  toOrderDto,
  toOrderSummary,
  toCategoryOrderGroup,
  type OrderDto,
  type OrderListPage,
  type CategoryItemsPage,
} from "@/lib/services/orderDtos";
import type { OrderItemsByCategoryQuery, OrderListQuery } from "@/lib/api/schemas/orders";

/**
 * Reading orders that already exist (BR-4: list a month, drill into a category, look one up).
 * Writing them — create, edit, delete — lives in `orders.ts` / `orderManagement.ts`; this file is
 * read-only on purpose, split out so neither half of "orders" grows past CLAUDE.md's file-size rule.
 */

export async function listOrders(userId: string, query: OrderListQuery): Promise<OrderListPage> {
  const after = query.cursor ? await keysetAfter(userId, query.cursor) : null;

  const rows = await prisma.order.findMany({
    where: {
      userId,
      ...(query.month && { periodMonth: parseMonthLabel(query.month) }),
      ...(after && { OR: after }),
    },
    // Newest saved order first. `id` breaks ties so paging is deterministic.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: { _count: { select: { items: true } } },
  });

  const page = rows.slice(0, query.limit);
  return {
    orders: page.map(toOrderSummary),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * The keyset predicate for "everything after the cursor row" in the list's sort order.
 *
 * Prisma's own `cursor` option is deliberately not used: it looks the anchor row up by primary key
 * with no `userId` predicate, so another user's id would position this user's page.
 */
async function keysetAfter(userId: string, cursor: string): Promise<Prisma.OrderWhereInput[]> {
  const anchor = await prisma.order.findFirst({
    where: { id: cursor, userId },
    select: { id: true, createdAt: true },
  });
  if (!anchor) {
    throw new AppError("VALIDATION_ERROR", "Unknown cursor.", 400);
  }

  return [
    { createdAt: { lt: anchor.createdAt } },
    { createdAt: anchor.createdAt, id: { lt: anchor.id } },
  ];
}

/**
 * The Home screen's "expand a category" drill-down: every item in one month that falls under one
 * category, grouped by the order it was bought in (newest order first, same ordering as
 * `listOrders`). This is a targeted `OrderItem` read, not an analytics one — PROJECT_SPEC.md §12
 * only bars `OrderItem` scans from the aggregate endpoints, which have `MonthlySummary` to read
 * instead. There is no materialized per-item view for this, so this queries the source rows.
 */
export async function listOrderItemsByCategory(
  userId: string,
  query: OrderItemsByCategoryQuery,
): Promise<CategoryItemsPage> {
  const periodMonth = parseMonthLabel(query.month);

  const orders = await prisma.order.findMany({
    where: {
      userId,
      periodMonth,
      items: { some: { categoryId: query.categoryId } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      items: {
        where: { categoryId: query.categoryId },
        orderBy: { position: "asc" },
      },
    },
  });

  return {
    month: query.month,
    categoryId: query.categoryId,
    orders: orders.map(toCategoryOrderGroup),
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

/** 404 rather than 403 for another user's order — never leak that the id exists (docs/api.md). */
export function orderNotFound(): AppError {
  return new AppError("NOT_FOUND", "Order not found.", 404);
}
