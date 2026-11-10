import { describe, expect, test } from "vitest";

import isSubscriptionState from "../../lib/shared/is-subscription-state";
import { SUBSCRIPTION_STATUSES } from "../../lib/shared/subscription-state.constants";
import { INVALID_STATES, VALID_STATES } from "./subscription-state.fixture";

describe("isSubscriptionState", () => {
  test("should accept a state of every status", () => {
    expect(
      [...new Set(VALID_STATES.map((state) => state.status))].sort()
    ).toEqual([...SUBSCRIPTION_STATUSES].sort());
    for (const state of VALID_STATES) {
      expect([state.status, isSubscriptionState(state)]).toEqual([
        state.status,
        true,
      ]);
    }
  });

  test("should refuse what only looks like a state", () => {
    for (const [name, value] of INVALID_STATES) {
      expect([name, isSubscriptionState(value)]).toEqual([name, false]);
    }
  });
});
