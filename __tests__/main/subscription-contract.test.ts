import { channelsOf } from "@handijit/electron";
import { describe, expect, test, vi } from "vitest";

import subscriptionContract, {
  purchaseRequestSchema,
  subscriptionStateSchema,
} from "../../lib/main/subscription-contract";
import isSubscriptionState from "../../lib/shared/is-subscription-state";
import SUBSCRIPTION_CHANNELS from "../../lib/shared/subscription-channels.constants";
import {
  INVALID_STATES,
  VALID_STATES,
} from "../shared/subscription-state.fixture";

vi.mock("electron", () => ({}));

describe("subscriptionContract", () => {
  test("should have exactly the channels the preload exposes", () => {
    expect(channelsOf(subscriptionContract)).toEqual(SUBSCRIPTION_CHANNELS);
  });

  test("should take an argument only on purchase: the plan, and nothing else", () => {
    const withInput = Object.entries(subscriptionContract.invoke)
      .filter(([, definition]) => "input" in definition)
      .map(([name]) => name);
    expect(withInput).toEqual(["subscription:purchase"]);
    expect(
      purchaseRequestSchema.safeParse({ interval: "yearly" }).success
    ).toBe(true);
    for (const value of [
      { interval: "weekly" },
      { interval: "monthly", url: "https://evil.example" },
      "monthly",
      {},
    ]) {
      expect(purchaseRequestSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("subscriptionStateSchema", () => {
  test("should accept a state of every status, unchanged", () => {
    for (const state of VALID_STATES) {
      expect(subscriptionStateSchema.parse(state)).toEqual(state);
    }
  });

  test("should agree with the page's guard", () => {
    for (const [name, value] of INVALID_STATES) {
      expect([name, subscriptionStateSchema.safeParse(value).success]).toEqual([
        name,
        false,
      ]);
      expect([name, isSubscriptionState(value)]).toEqual([name, false]);
    }
  });

  test("should refuse a field main was not supposed to send", () => {
    const [loading] = VALID_STATES;
    expect(
      subscriptionStateSchema.safeParse({ ...loading, license: "a.b.c" })
        .success
    ).toBe(false);
  });
});
