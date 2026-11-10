import type { Auth } from "@handijit/auth/main";
import type { ApiClient } from "@handijit/core";
import type {
  EventPayload,
  InvokeArgs,
  InvokeResult,
} from "@handijit/electron";
import type { Logger, SecretStore } from "@handijit/electron/main";
import { describe, expectTypeOf, test, vi } from "vitest";

import type subscriptionContract from "../lib/main/subscription-contract";
import type { Subscription, SubscriptionOptions } from "../lib/main/types";
import type { UseSubscriptionResult } from "../lib/react/use-subscription";
import type { SubscriptionClient } from "../lib/renderer/create-subscription-client";
import type {
  PlanInterval,
  SubscriptionContract,
  SubscriptionState,
  SubscriptionStatus,
} from "../lib/types";

vi.mock("electron", () => ({}));

describe("the options", () => {
  test("should take the instances of @handijit/auth and @handijit/electron as they are", () => {
    expectTypeOf<Auth>().toExtend<SubscriptionOptions["auth"]>();
    expectTypeOf<Logger>().toExtend<
      NonNullable<SubscriptionOptions["logger"]>
    >();
    expectTypeOf<SecretStore>().toExtend<
      NonNullable<SubscriptionOptions["secretStore"]>
    >();
    expectTypeOf<Pick<ApiClient, "request" | "issueLicense">>().toExtend<
      SubscriptionOptions["auth"]["client"]
    >();
  });

  test("should need only the product and the auth instance", () => {
    expectTypeOf<
      Pick<SubscriptionOptions, "product" | "auth">
    >().toExtend<SubscriptionOptions>();
  });
});

describe("the state", () => {
  test("should narrow by status", () => {
    type Of<S extends SubscriptionStatus> = Extract<
      SubscriptionState,
      { status: S }
    >;
    expectTypeOf<Of<"trial">["trialEndsAt"]>().toEqualTypeOf<number>();
    expectTypeOf<Of<"subscribed">["plan"]>().toEqualTypeOf<PlanInterval>();
    expectTypeOf<Of<"trial-expired">["trialEndedAt"]>().toEqualTypeOf<
      number | null
    >();
    expectTypeOf<Of<"device-mismatch">["boundDevice"]["name"]>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<Of<"loading">["limits"]>().toEqualTypeOf<
      Readonly<Record<string, number>>
    >();
  });
});

describe("the contract", () => {
  test("should type every channel on both sides", () => {
    type C = typeof subscriptionContract;
    expectTypeOf<C>().toEqualTypeOf<SubscriptionContract>();
    expectTypeOf<InvokeArgs<C, "subscription:purchase">>().toEqualTypeOf<
      [{ readonly interval: PlanInterval }]
    >();
    expectTypeOf<
      InvokeResult<C, "subscription:manage">
    >().toEqualTypeOf<boolean>();
    expectTypeOf<
      EventPayload<C, "subscription:state-changed">
    >().toEqualTypeOf<SubscriptionState>();
  });
});

describe("the page", () => {
  test("should give the hook the client's actions", () => {
    expectTypeOf<UseSubscriptionResult["purchase"]>().toEqualTypeOf<
      SubscriptionClient["purchase"]
    >();
    expectTypeOf<Subscription["purchase"]>()
      .parameter(0)
      .toEqualTypeOf<PlanInterval>();
  });
});
