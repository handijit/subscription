// The renderer entry: the page's client over the bridge. No React, no Node, no Electron.
export {
  default as createSubscriptionClient,
  subscriptionClient,
} from "./renderer/create-subscription-client";
export { default as isSubscriptionState } from "./shared/is-subscription-state";

export type { SubscriptionClient } from "./renderer/create-subscription-client";
export type {
  BoundDevice,
  PendingPurchase,
  PlanInterval,
  PlanOffer,
  SubscriptionPlans,
  SubscriptionState,
  SubscriptionStatus,
  UnavailableReason,
  Unsubscribe,
} from "./types";
