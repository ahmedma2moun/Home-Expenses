import { PrismaClient } from "@prisma/client";

declare global {
  var prismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaClient = prisma;
}

// Other layers must not import "@prisma/client" directly (lint-enforced) — re-export what they
// need from here instead. `Prisma` is a value export (Prisma.Decimal, Prisma.TransactionClient, …).
export { Prisma } from "@prisma/client";
export type { ReceiptStatus } from "@prisma/client";

import { Prisma as PrismaNamespace } from "@prisma/client";

/**
 * True for a unique-constraint conflict (P2002) — the "lost a race against an identical concurrent
 * request" case services use to fall back to reading the row the winner created, rather than
 * erroring (CLAUDE.md rule 8's transactional writes still need to stay idempotent under retries).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === "P2002";
}
