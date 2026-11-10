// The shared entry: constants, the state guard and types. No Node, no Electron, no Zod, so it
// loads in main, in a sandboxed preload and in the page alike.
export { default as isSubscriptionState } from "./shared/is-subscription-state";
export { default as SUBSCRIPTION_CHANNELS } from "./shared/subscription-channels.constants";
export {
  PLAN_INTERVALS,
  PLANS_STATUSES,
  SUBSCRIPTION_STATUSES,
  UNAVAILABLE_REASONS,
} from "./shared/subscription-state.constants";
export { default as withSubscriptionChannels } from "./shared/with-subscription-channels";

export type { WithSubscriptionChannels } from "./shared/with-subscription-channels";
export type {
  BoundDevice,
  ChannelList,
  PendingPurchase,
  PlanInterval,
  PlanOffer,
  PurchaseRequest,
  SubscriptionActivity,
  SubscriptionContext,
  SubscriptionContract,
  SubscriptionPlans,
  SubscriptionState,
  SubscriptionStatus,
  UnavailableReason,
  Unsubscribe,
} from "./types";
