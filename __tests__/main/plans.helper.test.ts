import { describe, expect, test } from "vitest";

import toPlanOffers from "../../lib/main/plans.helper";

describe("plans.helper", () => {
  test("should keep the plans this version sells, monthly first", () => {
    const plans = [
      {
        interval: "yearly",
        priceKurus: 149_900,
        currency: "TRY",
        available: true,
      },
      { interval: "lifetime", priceKurus: 1, currency: "TRY", available: true },
      {
        interval: "monthly",
        priceKurus: 14_990,
        currency: "TRY",
        available: false,
      },
    ];
    expect(toPlanOffers(plans)).toEqual([
      {
        interval: "monthly",
        priceKurus: 14_990,
        currency: "TRY",
        isAvailable: false,
      },
      {
        interval: "yearly",
        priceKurus: 149_900,
        currency: "TRY",
        isAvailable: true,
      },
    ]);
  });

  test("should answer an empty list for a program without plans", () => {
    expect(toPlanOffers([])).toEqual([]);
  });
});
