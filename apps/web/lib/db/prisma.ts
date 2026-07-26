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
