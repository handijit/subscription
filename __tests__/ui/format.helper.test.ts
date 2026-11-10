import { describe, expect, test } from "vitest";

import {
  daysUntil,
  formatDate,
  formatPrice,
  yearlySaving,
} from "../../lib/ui/format.helper";

const offer = (
  interval: "monthly" | "yearly",
  priceKurus: number,
  currency = "TRY"
) => ({
  interval,
  priceKurus,
  currency,
  isAvailable: true,
});

describe("format.helper", () => {
  test("should write prices as Turkish reads them", () => {
    expect(formatPrice(offer("monthly", 14_990))).toBe("₺149,90");
    expect(formatPrice(offer("yearly", 149_900))).toBe("₺1.499");
    expect(formatPrice(offer("yearly", 100_050))).toBe("₺1.000,50");
  });

  test("should write a day in Turkish", () => {
    expect(formatDate(Date.UTC(2026, 10, 12, 12))).toBe("12 Kasım 2026");
  });

  test("should count the days a person counts, and the last day as 0", () => {
    expect(daysUntil(7 * 86_400_000 - 5, 0)).toBe(7);
    expect(daysUntil(86_400_000, 0)).toBe(1);
    expect(daysUntil(86_399_999, 0)).toBe(0);
    expect(daysUntil(0, 5)).toBe(0);
  });

  test("should measure the yearly saving only when it is real", () => {
    expect(
      yearlySaving([offer("monthly", 10_000), offer("yearly", 100_000)])
    ).toBe(16);
    expect(
      yearlySaving([offer("monthly", 10_000), offer("yearly", 119_900)])
    ).toBeNull();
    expect(yearlySaving([offer("monthly", 10_000)])).toBeNull();
    expect(yearlySaving([offer("yearly", 10_000)])).toBeNull();
    expect(yearlySaving([offer("monthly", 0), offer("yearly", 1)])).toBeNull();
    expect(
      yearlySaving([offer("monthly", 10_000), offer("yearly", 1, "EUR")])
    ).toBeNull();
  });
});
