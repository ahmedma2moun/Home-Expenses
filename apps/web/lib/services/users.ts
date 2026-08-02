import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";

/**
 * The app has no multi-currency support (analytics aggregates `MonthlySummary` with no currency
 * dimension — see PROJECT_SPEC.md's data model), so every order a user saves must be in their one
 * configured `User.currency`. This is the single read path for that value: order writes validate
 * against it (`orders.ts`, `orderManagement.ts`) and analytics reads expose it so clients can stop
 * hardcoding a currency literal.
 */
export async function getUserCurrency(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
  if (!user) {
    throw new AppError("NOT_FOUND", "User not found.", 404);
  }
  return user.currency;
}

/** Throws a field-level 400 when `currency` doesn't match the user's configured currency. */
export function assertCurrencyMatches(userCurrency: string, orderCurrency: string): void {
  if (orderCurrency !== userCurrency) {
    throw new AppError(
      "VALIDATION_ERROR",
      `This account is set to ${userCurrency}; an order in ${orderCurrency} can't be saved. ` +
        `Multi-currency isn't supported yet — every order must be in ${userCurrency}.`,
      400,
      { issues: [{ path: "currency", message: `Must be ${userCurrency}.` }] },
    );
  }
}
