import { describe, expect, it } from "vitest";
import {
  formatMonthLabel,
  isPeriodMonth,
  parseMonthLabel,
  suggestPeriodMonth,
  toPeriodMonth,
} from "./period";

describe("toPeriodMonth", () => {
  const cases: { name: string; input: Date; expected: string }[] = [
    {
      name: "mid-month date",
      input: new Date("2026-07-14T18:32:00Z"),
      expected: "2026-07-01T00:00:00.000Z",
    },
    {
      name: "first of month",
      input: new Date("2026-01-01T00:00:00Z"),
      expected: "2026-01-01T00:00:00.000Z",
    },
    {
      name: "last day of month",
      input: new Date("2026-01-31T23:59:59Z"),
      expected: "2026-01-01T00:00:00.000Z",
    },
    {
      name: "December rolls to next year cleanly",
      input: new Date("2025-12-31T23:59:59Z"),
      expected: "2025-12-01T00:00:00.000Z",
    },
    {
      name: "leap-year February",
      input: new Date("2028-02-29T12:00:00Z"),
      expected: "2028-02-01T00:00:00.000Z",
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(toPeriodMonth(input).toISOString()).toBe(expected);
  });
});

describe("suggestPeriodMonth", () => {
  const now = new Date("2026-07-26T12:00:00Z");

  it("uses the receipt date when available", () => {
    const purchasedAt = new Date("2026-05-03T09:00:00Z");
    expect(suggestPeriodMonth(purchasedAt, now).toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("falls back to the current month when no receipt date was extracted", () => {
    expect(suggestPeriodMonth(null, now).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("parseMonthLabel", () => {
  const cases: { label: string; expected: string }[] = [
    { label: "2026-07", expected: "2026-07-01T00:00:00.000Z" },
    { label: "2099-12", expected: "2099-12-01T00:00:00.000Z" },
    { label: "1999-01", expected: "1999-01-01T00:00:00.000Z" },
  ];

  it.each(cases)(
    "parses $label to the first of the month at UTC midnight",
    ({ label, expected }) => {
      expect(parseMonthLabel(label).toISOString()).toBe(expected);
    },
  );

  it("round-trips through formatMonthLabel", () => {
    expect(formatMonthLabel(parseMonthLabel("2026-12"))).toBe("2026-12");
  });
});

describe("isPeriodMonth", () => {
  it("accepts a normalized month", () => {
    expect(isPeriodMonth(new Date("2026-07-01T00:00:00.000Z"))).toBe(true);
  });

  it("rejects a non-normalized date", () => {
    expect(isPeriodMonth(new Date("2026-07-14T00:00:00.000Z"))).toBe(false);
  });
});
