---
name: recurring-review-findings
description: Backend review issues seen in apps/web that are easy to miss and worth checking first in every diff (lenient model schemas reused on the wire, unbounded Int inputs, test casts)
metadata:
  type: feedback
---

Check these first in every apps/web backend review. All were found in the 2026-09-27 review of on-device extraction (the `clientParsedPayload` change).

1. **An AI-model-output schema reused as a client wire contract.** `ParsedReceiptSchema` uses `moneyFromModelSchema`, which accepts JSON numbers and runs strings through `Number(...).toFixed(2)`. That leniency makes sense for LLM output. On a client request body, though, it means money arrives as a float and gets silently re-rounded. It also has no length or count bounds.
   **Why:** CLAUDE.md rule 1 says money is strings on the wire and never a float.
   **How to apply:** whenever a request schema reuses an extraction/model schema, ask for a strict wire variant built on `moneySchema`/`nonNegativeMoneySchema`, with `.max()` on strings and arrays.

2. **Unbounded numeric or string inputs that reach Prisma.** An example is `z.number().int().min(0)` with no `.max()` going into an `Int` column. `withApi.mapError` logs `error.message` and `error.stack` through `console.error`. Prisma validation errors render the full call arguments, and those can include `parsedPayload`, merchant, and item names. So an overflow input can become a PII leak into the logs, as well as a 500.
   **Why:** CLAUDE.md rule 6 treats receipts as PII.
   **How to apply:** give every numeric input a `.max()` that fits its column type (int4 is at most 2147483647).

3. **`as` casts in `*.test.ts` files.** Lint does not catch them, even though CLAUDE.md rule 10 forbids them everywhere in apps/web. Flag them anyway.

Related context: `withApi` currently hardcodes `userId: DEV_USER_ID`. There is no JWT verification yet, so "userId from the verified session" is not actually true anywhere. Mention this when auth comes up, but it is outside a feature diff's scope.
