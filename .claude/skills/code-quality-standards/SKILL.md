---
name: code-quality-standards
description: The clean-code standards for this repo — layering, naming, error handling, testing, and the TypeScript and Swift rules. Use when writing or reviewing any code in apps/web or apps/ios.
allowed-tools: Read, Grep, Glob
---

# Code Quality Standards

## Layering (apps/web)
`app/api/**` transport only: auth, Zod parse, call a service, map errors to the envelope.
`lib/services/**` all business logic; pure where possible; takes primitives and returns domain types.
`lib/db/**` Prisma access; the only place `@prisma/client` is imported.
`lib/claude/**` model calls, prompts, and output schemas; never called directly from a route handler.
Enforced by `eslint-plugin-boundaries` — a violation fails CI, not just review.

## Functions and files
- Function does one thing, is under 40 lines, has at most 3 parameters (else pass an object).
- File under 300 lines. A file over 300 is a missing module.
- Max 3 levels of nesting. Guard-clause and return early instead of `else`.
- No boolean parameters that select behavior — write two functions.

## Naming
Domain language: `periodMonth`, `lineTotal`, `parsedPayload`, `confirmReceipt`.
Booleans read as predicates: `isConfirmed`, `hasUnreadableItems`.
No `data`, `info`, `obj`, `tmp`, `handleStuff`, `utils.ts` as a dumping ground.

## Errors
Throw typed `AppError(code, message, httpStatus, details?)`. One central mapper produces the
`{ error }` envelope. Never swallow an error; never `catch {}`. Log with `requestId` and `userId`,
never with receipt contents. External calls (Claude, blob, DB) get an explicit timeout.

## Types
`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
No `any`, no non-null `!`, no unchecked `as`. Parse unknown input with Zod; don't cast it.
Derive types from Zod schemas and Prisma, don't hand-write duplicates.

## Money and dates
`Decimal` end to end, strings on the wire, 2 decimals. `periodMonth` is always the first day of the
month at UTC midnight — use `toPeriodMonth()`; never construct it inline.

## Tests
New business logic ships with tests. Test behavior through the service boundary, not internals.
Required coverage on `lib/services` and `lib/claude`: 80% lines, 75% branches.
Table-driven tests for the aggregation and month-normalization math.
No network in unit tests — the Claude client is mocked from recorded fixtures.

## Swift
No force unwrap, `try!`, or `as!` outside tests. Views are dumb: no networking, no formatting logic,
no aggregation. ViewModels are `@MainActor` and expose one state enum, not five loose booleans.
`Decimal` for money, `FormatStyle` for display. SwiftLint + SwiftFormat run in CI.

## Always
Prefer deleting code over adding a flag. Leave the file cleaner than you found it, but never mix a
refactor into a feature PR.
