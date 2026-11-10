import { describe, expect, test } from "vitest";

import SUBSCRIPTION_CHANNELS from "../../lib/shared/subscription-channels.constants";
import withSubscriptionChannels from "../../lib/shared/with-subscription-channels";

describe("withSubscriptionChannels", () => {
  test("should add the subscription's channels to the program's", () => {
    const channels = withSubscriptionChannels({
      invoke: { "notes:list": true },
      events: { "notes:changed": true },
    });
    expect(channels).toEqual({
      invoke: { "notes:list": true, ...SUBSCRIPTION_CHANNELS.invoke },
      events: { "notes:changed": true, ...SUBSCRIPTION_CHANNELS.events },
    });
  });

  test("should compose with the helpers of the other packages", () => {
    const withOther = <C extends { invoke: object; events: object }>(
      list: C
    ) => ({
      invoke: { ...list.invoke, "update:check": true },
      events: { ...list.events },
    });
    const channels = withOther(
      withSubscriptionChannels({ invoke: {}, events: {} })
    );
    expect(Object.keys(channels.invoke)).toContain("subscription:purchase");
    expect(Object.keys(channels.invoke)).toContain("update:check");
  });

  test("should refuse a list that already has one of its channels", () => {
    expect(() =>
      withSubscriptionChannels({
        invoke: { "subscription:refresh": true },
        events: {},
      })
    ).toThrow(
      'withSubscriptionChannels: channel "subscription:refresh" is already in the list; the "subscription:" area belongs to @handijit/subscription'
    );
    expect(() =>
      withSubscriptionChannels({
        invoke: {},
        events: { "subscription:state-changed": true },
      })
    ).toThrow(TypeError);
  });
});
