import { defineContract } from "@handijit/electron";
import { z } from "zod";

import {
  PLAN_INTERVALS,
  PLANS_STATUSES,
  UNAVAILABLE_REASONS,
} from "../shared/subscription-state.constants";
import type {
  PurchaseRequest,
  SubscriptionContract,
  SubscriptionState,
} from "../types";

const count = z.number().nonnegative();
const interval = z.enum(PLAN_INTERVALS);

// The fields every status carries.
const context = {
  revision: count,
  isSignedIn: z.boolean(),
  isOffline: z.boolean(),
  isRefreshing: z.boolean(),
  checkedAt: count.nullable(),
  limits: z.record(z.string(), z.number().int()),
  plans: z.strictObject({
    status: z.enum(PLANS_STATUSES),
    offers: z.array(
      z.strictObject({
        interval,
        priceKurus: z.number().int().nonnegative(),
        currency: z.string(),
        isAvailable: z.boolean(),
      })
    ),
  }),
  purchase: z
    .strictObject({ interval, startedAt: count, expiresAt: count })
    .nullable(),
};

/** The schema of the state as it crosses IPC. Strict: an unknown field is a bug in main. */
const subscriptionStateSchema: z.ZodType<SubscriptionState, SubscriptionState> =
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("loading"), ...context }),
    z.strictObject({
      status: z.literal("trial"),
      trialEndsAt: count,
      licenseExpiresAt: count,
      ...context,
    }),
    z.strictObject({
      status: z.literal("subscribed"),
      plan: interval,
      licenseExpiresAt: count,
      ...context,
    }),
    z.strictObject({
      status: z.literal("trial-expired"),
      trialEndedAt: count.nullable(),
      ...context,
    }),
    z.strictObject({ status: z.literal("subscription-required"), ...context }),
    z.strictObject({
      status: z.literal("device-mismatch"),
      boundDevice: z.strictObject({
        name: z.string().nullable(),
        os: z.string().nullable(),
      }),
      ...context,
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      reason: z.enum(UNAVAILABLE_REASONS),
      ...context,
    }),
  ]);

/** What the renderer may ask to buy: one of the two plans, nothing else. */
const purchaseRequestSchema: z.ZodType<PurchaseRequest, PurchaseRequest> =
  z.strictObject({ interval });

/**
 * The IPC contract of the subscription, for `@handijit/electron`. Main validates what the page
 * sends (the plan of a purchase) and what it sends back (every state) against it. The decision
 * itself never travels from the page to main.
 */
const subscriptionContract: SubscriptionContract = defineContract({
  invoke: {
    "subscription:get-state": { output: subscriptionStateSchema },
    "subscription:refresh": { output: subscriptionStateSchema },
    "subscription:load-plans": { output: subscriptionStateSchema },
    "subscription:purchase": {
      input: purchaseRequestSchema,
      output: z.boolean(),
    },
    "subscription:cancel-purchase": { output: subscriptionStateSchema },
    "subscription:manage": { output: z.boolean() },
  },
  events: {
    "subscription:state-changed": subscriptionStateSchema,
  },
});

export { purchaseRequestSchema, subscriptionStateSchema };
export default subscriptionContract;
